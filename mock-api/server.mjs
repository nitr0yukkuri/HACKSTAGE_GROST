import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const readJson = async (path) => JSON.parse(await readFile(fileURLToPath(new URL(path, import.meta.url)), 'utf8'))
const [themeCatalog, questionnaires] = await Promise.all([
  readJson('../contracts/themes.json'),
  Promise.all(['onboarding-v1', 'onboarding-v2'].map((version) => readJson(`../contracts/questionnaires/${version}.json`))),
])
const themesById = new Map(themeCatalog.themes.map((theme) => [theme.id, theme]))
const questionnaireByVersion = new Map(questionnaires.map((questionnaire) => [questionnaire.version, questionnaire]))
const MAX_BODY_BYTES = 8 * 1024
const MAX_CONTEXT_BYTES = 4 * 1024
const port = Number.parseInt(process.env.MOCK_API_PORT ?? '8787', 10)
const host = process.env.MOCK_API_HOST ?? '127.0.0.1'
const allowedOrigin = process.env.MOCK_API_ALLOWED_ORIGIN ?? '*'
const delayMs = Math.max(0, Number.parseInt(process.env.MOCK_API_DELAY_MS ?? '0', 10) || 0)

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const hasOnlyKeys = (value, keys) => Object.keys(value).every((key) => keys.includes(key))
const detail = (field, code) => ({ field, code })

function jsonResponse(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Discovery-Context',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  })
  response.end(JSON.stringify(body))
}

function errorResponse(response, requestId, status, code, message, details = []) {
  jsonResponse(response, status, { requestId, error: { code, message, details } })
}

function methodNotAllowed(response, allow) {
  response.writeHead(405, {
    Allow: allow,
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Discovery-Context',
    Vary: 'Origin',
  })
  response.end()
}

async function waitForConfiguredDelay() {
  if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs))
}

async function readJsonBody(request) {
  const chunks = []
  let bytes = 0
  let oversized = false
  for await (const chunk of request) {
    bytes += chunk.byteLength
    if (bytes > MAX_BODY_BYTES) {
      oversized = true
      continue
    }
    chunks.push(chunk)
  }
  if (oversized) {
    const error = new Error('Request body is too large.')
    error.status = 413
    throw error
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    const error = new Error('Request body is not valid JSON.')
    error.status = 400
    throw error
  }
}

function validateAnswersPayload(payload, prefix = '') {
  const problems = []
  if (!isRecord(payload) || !hasOnlyKeys(payload, ['questionnaireVersion', 'answers']) ||
      !Object.hasOwn(payload, 'questionnaireVersion') || !Object.hasOwn(payload, 'answers')) {
    return { status: 422, code: 'VALIDATION_ERROR', details: [detail(prefix || 'body', 'INVALID_REQUEST_SHAPE')] }
  }

  const questionnaire = questionnaireByVersion.get(payload.questionnaireVersion)
  if (!questionnaire) {
    return {
      status: 422,
      code: 'UNSUPPORTED_QUESTIONNAIRE_VERSION',
      details: [detail(prefix ? `${prefix}.questionnaireVersion` : 'questionnaireVersion', 'UNSUPPORTED_QUESTIONNAIRE_VERSION')],
    }
  }
  const answers = payload.answers
  const answerField = prefix ? `${prefix}.answers` : 'answers'
  if (!Array.isArray(answers)) {
    return { status: 422, code: 'VALIDATION_ERROR', details: [detail(answerField, 'ANSWERS_COUNT_OUT_OF_RANGE')] }
  }

  const questionsById = new Map(questionnaire.questions.map((question) => [question.id, question]))
  const seenQuestionIds = new Set()
  for (const [index, answer] of answers.entries()) {
    if (!isRecord(answer) || typeof answer.questionId !== 'string') continue
    const field = `${answerField}[${index}].questionId`
    if (!questionsById.has(answer.questionId)) {
      return { status: 422, code: 'VALIDATION_ERROR', details: [detail(field, 'UNKNOWN_QUESTION_ID')] }
    }
    if (seenQuestionIds.has(answer.questionId)) {
      return { status: 422, code: 'VALIDATION_ERROR', details: [detail(field, 'DUPLICATE_QUESTION_ID')] }
    }
    seenQuestionIds.add(answer.questionId)
  }
  if (answers.length < questionnaire.answerLimits.minItems || answers.length > questionnaire.answerLimits.maxItems) {
    return { status: 422, code: 'VALIDATION_ERROR', details: [detail(answerField, 'ANSWERS_COUNT_OUT_OF_RANGE')] }
  }

  const answersById = new Map()
  for (const [index, answer] of answers.entries()) {
    const field = `${answerField}[${index}]`
    if (!isRecord(answer) || !hasOnlyKeys(answer, ['questionId', 'selectedOptionIds']) ||
        !Object.hasOwn(answer, 'questionId') || !Object.hasOwn(answer, 'selectedOptionIds') ||
        typeof answer.questionId !== 'string' || !Array.isArray(answer.selectedOptionIds) ||
        !answer.selectedOptionIds.every((optionId) => typeof optionId === 'string')) {
      problems.push(detail(field, 'INVALID_REQUEST_SHAPE'))
      continue
    }
    if (answersById.has(answer.questionId)) {
      problems.push(detail(`${field}.questionId`, 'DUPLICATE_QUESTION_ID'))
      continue
    }
    const question = questionsById.get(answer.questionId)
    if (!question) {
      problems.push(detail(`${field}.questionId`, 'UNKNOWN_QUESTION_ID'))
      continue
    }
    answersById.set(answer.questionId, answer.selectedOptionIds)

    const { selectedOptionIds } = answer
    if (new Set(selectedOptionIds).size !== selectedOptionIds.length) {
      problems.push(detail(`${field}.selectedOptionIds`, 'DUPLICATE_OPTION_ID'))
    }
    if (selectedOptionIds.length === 0) {
      problems.push(detail(`${field}.selectedOptionIds`, 'EMPTY_SELECTION'))
    } else if (selectedOptionIds.length < question.selection.min || selectedOptionIds.length > question.selection.max) {
      problems.push(detail(`${field}.selectedOptionIds`, 'SELECTION_COUNT_OUT_OF_RANGE'))
    }
    const available = new Set((question.options ?? []).map((option) => option.id))
    if (question.optionSource === 'themes.level1') {
      themeCatalog.themes.filter((theme) => theme.parentId === null).forEach((theme) => available.add(theme.id))
    }
    selectedOptionIds.forEach((optionId) => {
      if (!available.has(optionId)) problems.push(detail(`${field}.selectedOptionIds`, 'UNKNOWN_OPTION_ID'))
    })
    if (question.exclusiveOptionIds?.some((optionId) => selectedOptionIds.includes(optionId)) && selectedOptionIds.length > 1) {
      problems.push(detail(`${field}.selectedOptionIds`, 'EXCLUSIVE_OPTION_CONFLICT'))
    }
  }

  for (const question of questionnaire.questions) {
    if (question.required?.type === 'always' && !answersById.has(question.id)) {
      problems.push(detail(answerField, 'MISSING_REQUIRED_QUESTION'))
    }
  }
  for (const rule of questionnaire.conditionalRules) {
    const whenIds = answersById.get(rule.when.questionId) ?? []
    const conditionMatched = rule.when.includesOptionId
      ? whenIds.includes(rule.when.includesOptionId)
      : rule.when.excludesOptionId
        ? !whenIds.includes(rule.when.excludesOptionId)
        : false
    if (!conditionMatched) continue
    if (rule.then.requireQuestion && !answersById.has(rule.then.requireQuestion)) {
      problems.push(detail(answerField, 'MISSING_REQUIRED_QUESTION'))
    }
    if (rule.then.forbidQuestion && answersById.has(rule.then.forbidQuestion)) {
      const index = answers.findIndex((answer) => answer?.questionId === rule.then.forbidQuestion)
      problems.push(detail(`${answerField}[${index}].questionId`, 'FORBIDDEN_QUESTION'))
    }
  }

  return problems.length > 0 ? { status: 422, code: 'VALIDATION_ERROR', details: problems } : null
}

function answerMap(answers) {
  return new Map(answers.map((answer) => [answer.questionId, answer.selectedOptionIds]))
}

function makeSeedThemes(answers) {
  const byQuestion = answerMap(answers)
  const interest = byQuestion.get('interest')?.[0]
  const selected = (byQuestion.get('themes') ?? []).filter((themeId) => themeId !== 'omakase')
  const interestOrder = {
    create: ['mon', 'tec', 'art'],
    think_deeply: ['phi', 'sci', 'his'],
    explore_unknown: ['lan', 'sci', 'art'],
    people_society: ['soc', 'his', 'phi'],
    none: ['sci', 'art', 'his'],
  }
  const curiosity = byQuestion.get('curiosity') ?? []
  const curiosityOrder = curiosity.flatMap((id) => ({
    music_emotions: ['art', 'soc'],
    space_mysteries: ['sci', 'phi'],
    city_origins: ['his', 'soc'],
  })[id] ?? [])
  const candidates = [...selected, ...curiosityOrder, ...(interestOrder[interest] ?? [])]
  for (const theme of themeCatalog.themes) if (theme.parentId === null) candidates.push(theme.id)
  const unique = [...new Set(candidates)].filter((themeId) => themesById.has(themeId)).slice(0, 3)
  return unique.map((themeId) => ({ themeId, searchQuery: themesById.get(themeId).searchQuery }))
}

const includesSelectedBy = (value) => {
  if (value === null) return false
  if ([...value].length > 200) return false
  return value.split(',').some((token) => token.trim() === 'selectedBy')
}

function mockBooks(themeId) {
  const theme = themesById.get(themeId)
  return [
    {
      id: `mock-${themeId}-001`, source: 'google_books', title: `${theme.name}を知るための一冊`,
      authors: ['ほしるべ モック著者'], coverUrl: null,
      description: `${theme.name}の基本的な考え方を、身近な例とともに紹介するモック書籍データです。`,
      recommendationReason: `回答した興味から${theme.name}の入口を探せるように用意した、モックのおすすめ理由です。`, infoUrl: null,
      selectedBy: 'ai',
    },
    {
      id: `mock-${themeId}-002`, source: 'google_books', title: `${theme.name}の見方が変わる本`,
      authors: [], coverUrl: null, description: null, recommendationReason: null, infoUrl: null,
      selectedBy: 'ai',
    },
    {
      id: `mock-${themeId}-003`, source: 'google_books', title: `はじめての${theme.name}`,
      authors: ['テスト 著者'], coverUrl: null,
      description: `${theme.name}を初めて学ぶ人向けのモック紹介文です。`,
      recommendationReason: null, infoUrl: null,
      selectedBy: 'search',
    },
  ]
}

const server = createServer(async (request, response) => {
  const startedAt = performance.now()
  const requestId = `mock-${randomUUID()}`
  const method = request.method ?? 'GET'
  const url = new URL(request.url ?? '/', `http://${host}:${port}`)
  let status = 500

  const finish = (nextStatus, body, isError = false) => {
    status = nextStatus
    if (isError) errorResponse(response, requestId, nextStatus, body.code, body.message, body.details)
    else jsonResponse(response, nextStatus, { requestId, ...body })
  }

  try {
    if (method === 'OPTIONS') {
      status = 204
      response.writeHead(204, {
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': allowedOrigin,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Discovery-Context',
        'Access-Control-Max-Age': '600',
        Vary: 'Origin',
      })
      response.end()
      return
    }
    await waitForConfiguredDelay()

    if (url.pathname === '/health' && method === 'GET') {
      finish(200, { status: 'ok' })
      return
    }

    if (url.pathname === '/v1/discovery/seed') {
      if (method !== 'POST') {
        status = 405
        methodNotAllowed(response, 'POST, OPTIONS')
        return
      }
      if (!String(request.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
        finish(415, { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'JSON形式で送信してください。', details: [] }, true)
        return
      }
      let payload
      try {
        payload = await readJsonBody(request)
      } catch (error) {
        const errorStatus = error.status ?? 400
        finish(errorStatus, {
          code: errorStatus === 413 ? 'PAYLOAD_TOO_LARGE' : 'INVALID_JSON',
          message: errorStatus === 413 ? '送信できるデータの大きさを超えています。' : 'リクエストのJSONを確認してください。',
          details: [],
        }, true)
        return
      }
      const invalid = validateAnswersPayload(payload)
      if (invalid) {
        finish(invalid.status, { code: invalid.code, message: '回答内容を確認してください。', details: invalid.details }, true)
        return
      }
      const themes = makeSeedThemes(payload.answers)
      finish(200, { themes })
      return
    }

    const booksMatch = url.pathname.match(/^\/v1\/themes\/([^/]+)\/books$/)
    if (booksMatch) {
      if (method !== 'GET') {
        status = 405
        methodNotAllowed(response, 'GET, OPTIONS')
        return
      }
      let themeId
      try {
        themeId = decodeURIComponent(booksMatch[1])
      } catch {
        finish(422, { code: 'VALIDATION_ERROR', message: '星の指定を確認してください。', details: [detail('themeId', 'UNKNOWN_THEME_ID')] }, true)
        return
      }
      if (!themesById.has(themeId)) {
        finish(422, { code: 'VALIDATION_ERROR', message: '星の指定を確認してください。', details: [detail('themeId', 'UNKNOWN_THEME_ID')] }, true)
        return
      }
      const searchQuery = url.searchParams.get('q')
      const includeValues = url.searchParams.getAll('include')
      const includeSelectedBy = includesSelectedBy(
        includeValues.length > 0 ? includeValues.join(',') : null,
      )
      if (searchQuery === null || searchQuery.trim().length === 0 || Array.from(searchQuery).length > 128 || searchQuery !== searchQuery.trim()) {
        finish(422, { code: 'VALIDATION_ERROR', message: '検索語を確認してください。', details: [detail('q', 'INVALID_REQUEST_SHAPE')] }, true)
        return
      }
      const contextHeader = request.headers['x-discovery-context']
      if (typeof contextHeader !== 'string' || contextHeader.length === 0) {
        finish(422, { code: 'VALIDATION_ERROR', message: 'リクエスト内容を確認してください。', details: [detail('X-Discovery-Context', 'INVALID_REQUEST_SHAPE')] }, true)
        return
      }
      if (Buffer.byteLength(contextHeader, 'utf8') > MAX_CONTEXT_BYTES) {
        finish(431, { code: 'CONTEXT_TOO_LARGE', message: '送信できる回答データの大きさを超えています。', details: [] }, true)
        return
      }
      if (!/^[\x00-\x7F]*$/.test(contextHeader)) {
        finish(422, { code: 'VALIDATION_ERROR', message: '回答の形式を確認してください。', details: [detail('X-Discovery-Context', 'INVALID_REQUEST_SHAPE')] }, true)
        return
      }
      let context
      try {
        context = JSON.parse(contextHeader)
      } catch {
        finish(400, { code: 'INVALID_CONTEXT_JSON', message: 'リクエストの形式を確認してください。', details: [] }, true)
        return
      }
      const invalid = validateAnswersPayload(context, 'X-Discovery-Context')
      if (invalid) {
        finish(invalid.status, { code: invalid.code, message: 'リクエスト内容を確認してください。', details: invalid.details }, true)
        return
      }

      const empty = searchQuery === '__empty__'
      const warn = searchQuery === '__warning__'
      const items = empty ? [] : mockBooks(themeId)
      const warnings = []
      if (!empty && items.some((item) => item.description === null)) {
        warnings.push({ code: 'INSUFFICIENT_BOOK_METADATA', message: '内容紹介がない本では、おすすめ理由の根拠が不足しています。' })
      }
      if (warn || (!empty && items.some((item) => item.recommendationReason === null && item.description !== null && item.selectedBy === 'ai'))) {
        warnings.push({ code: 'RECOMMENDATION_REASON_UNAVAILABLE', message: '一部の本では、回答に沿ったおすすめ理由を用意できませんでした。' })
      }
      const responseItems = includeSelectedBy
        ? items
        : items.map(({ selectedBy, ...rest }) => rest)
      finish(200, { themeId, items: responseItems, warnings })
      return
    }

    status = 404
    response.writeHead(404, {
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Discovery-Context',
      Vary: 'Origin',
    })
    response.end()
  } catch {
    if (!response.headersSent) {
      finish(500, { code: 'INTERNAL_ERROR', message: '処理に失敗しました。', details: [] }, true)
    } else if (!response.writableEnded) response.end()
  } finally {
    if (status !== 204) {
      const route = url.pathname
      process.stdout.write(`${new Date().toISOString()} ${method} ${route} ${status} ${Math.round(performance.now() - startedAt)}ms ${requestId}\n`)
    }
  }
})

server.listen(port, host, () => {
  process.stdout.write(`ほしるべ contract mock listening on http://${host}:${port}\n`)
  process.stdout.write('外部サービスには接続しません。\n')
})
