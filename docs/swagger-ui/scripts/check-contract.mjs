#!/usr/bin/env node
/**
 * ほしるべ API 契約の静的検証（ドキュメント用途）。
 * 1. 星・質問ID・enum・選択数・版が contracts/ と docs/swagger-ui/openapi.yaml で一致するか
 * 2. seed 本文と GET ヘッダーの回答例が質問の一意性・必須・排他・v2分岐を満たすか
 * 3. seed の出力例が大ジャンル3件・一意・検索語条件を満たすか
 * 4. GET が本文を持たず、q と X-Discovery-Context を必須にしているか
 * 5. 旧パス・不正な例を、壊したコピーで検出できるか
 * OpenAPI の構造・example の検証は Redocly lint が担当する。本番バリデータではない。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'
const docsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.resolve(docsDir, '..', '..')
const spec = YAML.parse(fs.readFileSync(path.join(docsDir, 'openapi.yaml'), 'utf8'))
const themes = JSON.parse(fs.readFileSync(path.join(repoRoot, 'contracts/themes.json'), 'utf8')).themes
const questionnaireEntries = fs
  .readdirSync(path.join(repoRoot, 'contracts/questionnaires'))
  .filter((name) => name.endsWith('.json'))
  .sort()
  .map((name) => ({
    name,
    data: JSON.parse(fs.readFileSync(path.join(repoRoot, 'contracts/questionnaires', name), 'utf8')),
  }))
const versionKeys = questionnaireEntries.map(({ data }) => data.version)
assert.equal(new Set(versionKeys).size, versionKeys.length, '質問票の版が重複しています')
const byVersion = new Map(questionnaireEntries.map(({ data }) => [data.version, data]))
const themeIds = themes.map((theme) => theme.id)
const level1Ids = themes.filter((theme) => theme.parentId === null).map((theme) => theme.id)
const SEED_PATH = '/v1/discovery/seed'
const BOOKS_PATH = '/v1/themes/{themeId}/books'
const OLD_PATH = '/v1/books/recommendations'
const SEED_EXAMPLE_NAMES = ['v1-normal', 'v1-none', 'v2-curiosity', 'v2-no-curiosity']
const SEED_STATUSES = ['200', '400', '413', '415', '422', '429', '500', '502', '503', '504']
const BOOKS_STATUSES = ['200', '400', '422', '429', '431', '500', '502', '504']

const sameSet = (a, b) =>
  Array.isArray(a) && Array.isArray(b) && new Set(a).size === new Set(b).size && [...new Set(a)].every((v) => new Set(b).has(v))
const sameArray = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i])
function resolve(root, node) {
  if (!node?.$ref) return node
  return node.$ref.replace(/^#\//, '').split('/').reduce((current, part) => current?.[part], root)
}
function seedRequestVariants(specValue) {
  const schema = resolve(
    specValue,
    specValue.paths?.[SEED_PATH]?.post?.requestBody?.content?.['application/json']?.schema,
  )
  return (schema?.oneOf ?? []).map((node) => resolve(specValue, node))
}
function seedRequestExamples(specValue) {
  return specValue.paths?.[SEED_PATH]?.post?.requestBody?.content?.['application/json']?.examples ?? {}
}
function booksParameters(specValue) {
  return specValue.paths?.[BOOKS_PATH]?.get?.parameters ?? []
}
function findParameter(parameters, location, name) {
  return parameters.find((parameter) => parameter?.in === location && parameter?.name === name)
}
/** seed の出力例が 3件・大ジャンル・一意・検索語条件を満たすか。schema では表せない条件だけを見る。 */
function seedResponseProblems(response) {
  const problems = []
  if (!response || typeof response !== 'object') return ['seed応答がオブジェクトではありません']
  if (typeof response.requestId !== 'string' || response.requestId.length === 0) {
    problems.push('seed応答の requestId が空です')
  }
  if (!Array.isArray(response.themes)) return [...problems, 'themes が配列ではありません']
  if (response.themes.length !== 3) problems.push('themes は3件である必要があります')
  const ids = response.themes.map((theme) => theme?.themeId)
  if (new Set(ids).size !== ids.length) problems.push('themes の themeId が重複しています')
  for (const theme of response.themes) {
    if (!level1Ids.includes(theme?.themeId)) problems.push(`大ジャンルIDではありません: ${theme?.themeId}`)
    const query = theme?.searchQuery
    if (typeof query !== 'string' || query.trim() === '') {
      problems.push(`searchQuery が空です: ${theme?.themeId}`)
    } else {
      if (query !== query.trim()) problems.push(`searchQuery の前後に空白があります: ${theme?.themeId}`)
      if ([...query].length > 128) problems.push(`searchQuery が128文字を超えています: ${theme?.themeId}`)
    }
  }
  return problems
}
/** 回答の意味条件だけを見る。スキーマの型検証は Redocly に任せる。 */
function validateRequest(request) {
  const codes = []
  if (!request || typeof request !== 'object' || !Array.isArray(request.answers)) return ['INVALID_REQUEST_SHAPE']
  const allowedKeys = new Set(['questionnaireVersion', 'answers'])
  if (Object.keys(request).some((key) => !allowedKeys.has(key))) codes.push('INVALID_REQUEST_SHAPE')
  const catalog = byVersion.get(request.questionnaireVersion)
  if (!catalog) return [...codes, 'UNSUPPORTED_QUESTIONNAIRE_VERSION']
  if (
    request.answers.length < catalog.answerLimits.minItems ||
    request.answers.length > catalog.answerLimits.maxItems
  ) {
    codes.push('ANSWERS_COUNT_OUT_OF_RANGE')
  }

  const questions = new Map(catalog.questions.map((question) => [question.id, question]))
  const answered = new Map()
  for (const answer of request.answers) {
    if (!answer || typeof answer.questionId !== 'string' || !Array.isArray(answer.selectedOptionIds)) {
      codes.push('INVALID_REQUEST_SHAPE')
      continue
    }
    const question = questions.get(answer.questionId)
    if (!question) {
      codes.push('UNKNOWN_QUESTION_ID')
      continue
    }
    if (answered.has(question.id)) codes.push('DUPLICATE_QUESTION_ID')
    answered.set(question.id, answer)
    const selected = answer.selectedOptionIds
    if (selected.length === 0) codes.push('EMPTY_SELECTION')
    if (selected.length < question.selection.min || selected.length > question.selection.max) {
      codes.push('SELECTION_COUNT_OUT_OF_RANGE')
    }
    if (new Set(selected).size !== selected.length) codes.push('DUPLICATE_OPTION_ID')
    const optionIds = new Set(question.options.map((option) => option.id))
    if (selected.some((optionId) => !optionIds.has(optionId))) codes.push('UNKNOWN_OPTION_ID')
    if ((question.exclusiveOptionIds ?? []).some((optionId) => selected.includes(optionId)) && selected.length > 1) {
      codes.push('EXCLUSIVE_OPTION_CONFLICT')
    }
  }

  for (const question of catalog.questions) {
    if (question.required?.type === 'always' && !answered.has(question.id)) codes.push('MISSING_REQUIRED_QUESTION')
  }
  for (const rule of catalog.conditionalRules ?? []) {
    const source = answered.get(rule.when?.questionId)
    if (!source) continue
    const selected = source.selectedOptionIds
    const matched = rule.when.includesOptionId
      ? selected.includes(rule.when.includesOptionId)
      : !selected.includes(rule.when.excludesOptionId)
    if (!matched) continue
    if (rule.then?.requireQuestion && !answered.has(rule.then.requireQuestion)) codes.push('MISSING_REQUIRED_QUESTION')
    if (rule.then?.forbidQuestion && answered.has(rule.then.forbidQuestion)) codes.push('FORBIDDEN_QUESTION')
  }
  return codes
}
/** OpenAPI とカタログの不一致、新ルートの必須条件の欠落を列挙する。壊したコピーの検出にも使う。 */
function consistencyProblems(specValue, themeList, catalogEntries) {
  const problems = []
  const expect = (condition, message) => {
    if (!condition) problems.push(message)
  }
  const ids = themeList.map((theme) => theme.id)
  const level1 = themeList.filter((theme) => theme.parentId === null).map((theme) => theme.id)
  const catalogs = new Map(catalogEntries.map(({ data }) => [data.version, data]))
  const paths = specValue.paths ?? {}

  expect(specValue.info?.version === '2.0.0', 'info.version が 2.0.0 ではありません')
  expect(!paths[OLD_PATH], '旧パス /v1/books/recommendations が残っています')
  expect(paths[SEED_PATH]?.post, 'POST /v1/discovery/seed がありません')
  expect(paths[BOOKS_PATH]?.get, 'GET /v1/themes/{themeId}/books がありません')
  expect(paths['/health']?.get, 'GET /health がありません')
  expect(Array.isArray(specValue.security) && specValue.security.length === 0, 'security が空ではありません')

  expect(sameSet(specValue.components?.schemas?.ThemeId?.enum, ids), 'ThemeId の enum が星カタログと一致しません')
  expect(
    sameSet(specValue.components?.schemas?.Level1ThemeId?.enum, level1),
    'Level1ThemeId の enum が大ジャンルと一致しません',
  )

  const variants = seedRequestVariants(specValue)
  expect(variants.length === 2, 'seed のリクエストが v1/v2 の2つの oneOf になっていません')
  expect(
    sameSet(variants.map((variant) => variant?.['x-contract-questionnaire-version']), [...catalogs.keys()]),
    'seed の版が質問票カタログと一致しません',
  )
  for (const variant of variants) {
    const version = variant?.['x-contract-questionnaire-version']
    const catalog = catalogs.get(version)
    if (!catalog) {
      problems.push(`${version}: カタログにない版です`)
      continue
    }
    expect(
      !Object.prototype.hasOwnProperty.call(variant?.properties ?? {}, 'themeId'),
      `${version}: seed の本文に themeId があります`,
    )
    expect(!(variant?.required ?? []).includes('themeId'), `${version}: seed の必須項目に themeId があります`)
    expect(sameArray(variant.properties?.questionnaireVersion?.enum, [version]), `${version}: 版の enum が一致しません`)
    const answers = variant.properties?.answers
    expect(
      answers?.minItems === catalog.answerLimits.minItems && answers?.maxItems === catalog.answerLimits.maxItems,
      `${version}: answers の minItems/maxItems がカタログと一致しません`,
    )

    const answerSchemas = (answers?.items?.oneOf ?? []).map((node) => resolve(specValue, node))
    expect(
      sameSet(answerSchemas.map((schema) => schema?.['x-contract-question-id']), catalog.questions.map((q) => q.id)),
      `${version}: 質問スキーマがカタログの質問と一致しません`,
    )
    for (const schema of answerSchemas) {
      const question = catalog.questions.find((candidate) => candidate.id === schema?.['x-contract-question-id'])
      if (!question) continue
      const selection = schema.properties?.selectedOptionIds
      expect(sameArray(schema.properties?.questionId?.enum, [question.id]), `${version}/${question.id}: questionId が一致しません`)
      expect(sameSet(selection?.items?.enum, question.options.map((option) => option.id)), `${version}/${question.id}: 選択肢 enum が一致しません`)
      expect(
        selection?.minItems === question.selection.min && selection?.maxItems === question.selection.max,
        `${version}/${question.id}: 選択数がカタログと一致しません`,
      )
    }

    const themesQuestion = catalog.questions.find((question) => question.id === 'themes')
    if (themesQuestion) {
      expect(
        sameSet(themesQuestion.options.map((option) => option.id), [...level1, 'omakase']),
        `${version}: themes の選択肢が大ジャンル＋omakase と一致しません`,
      )
    }
  }

  const seedResponse = specValue.components?.schemas?.SeedResponse
  const seedThemes = seedResponse?.properties?.themes
  expect(seedThemes?.minItems === 3 && seedThemes?.maxItems === 3, 'SeedResponse.themes が必ず3件ではありません')
  const seedTheme = resolve(specValue, seedThemes?.items)
  expect(seedTheme?.properties?.themeId?.$ref === '#/components/schemas/Level1ThemeId', 'SeedTheme.themeId が大ジャンル参照ではありません')
  expect(
    seedTheme?.properties?.searchQuery?.minLength === 1 && seedTheme?.properties?.searchQuery?.maxLength === 128,
    'SeedTheme.searchQuery の長さ条件が一致しません',
  )
  const seedSuccess = specValue.paths?.[SEED_PATH]?.post?.responses?.['200']?.content?.['application/json']?.examples?.success?.value
  if (!seedSuccess) {
    problems.push('seed の成功例がありません')
  } else {
    problems.push(...seedResponseProblems(seedSuccess))
  }

  const parameters = booksParameters(specValue)
  const themeIdParam = findParameter(parameters, 'path', 'themeId')
  expect(themeIdParam?.required === true, 'GET の themeId が必須ではありません')
  expect(
    themeIdParam?.schema?.$ref === '#/components/schemas/ThemeId',
    'GET の themeId が ThemeId を参照していません',
  )
  const qParam = findParameter(parameters, 'query', 'q')
  expect(qParam?.required === true, 'GET の q が必須ではありません')
  expect(qParam?.schema?.type === 'string', 'GET の q が文字列ではありません')
  expect(qParam?.schema?.minLength === 1 && qParam?.schema?.maxLength === 128, 'GET の q の長さ条件が一致しません')
  const queryNames = parameters.filter((parameter) => parameter?.in === 'query').map((parameter) => parameter?.name)
  expect(sameArray(queryNames, ['q']), 'GET のクエリが q だけではありません')

  const contextParam = findParameter(parameters, 'header', 'X-Discovery-Context')
  expect(contextParam?.required === true, 'GET の X-Discovery-Context が必須ではありません')
  expect(contextParam?.schema?.type === 'string', 'X-Discovery-Context の schema が string ではありません')
  expect(
    contextParam?.['x-parsed-schema'] === '#/components/schemas/SeedRequest',
    'X-Discovery-Context の解析後スキーマが seed 本文と一致しません',
  )
  expect(contextParam?.['x-max-bytes'] === 4096, 'X-Discovery-Context の上限が 4 KiB ではありません')
  expect(!specValue.paths?.[BOOKS_PATH]?.get?.requestBody, 'GET が本文を持っています')

  const seedExamples = seedRequestExamples(specValue)
  const contextExamples = contextParam?.examples ?? {}
  expect(sameSet(Object.keys(contextExamples), Object.keys(seedExamples)), 'GET の回答例が seed 本文の例と対応していません')
  for (const [name, example] of Object.entries(seedExamples)) {
    const context = contextExamples[name]
    if (!context) {
      problems.push(`${name}: GET の回答例がありません`)
      continue
    }
    if (typeof context.value !== 'string') {
      problems.push(`${name}: GET の回答例が JSON 文字列ではありません`)
      continue
    }
    let parsed
    try {
      parsed = JSON.parse(context.value)
    } catch {
      problems.push(`${name}: GET の回答例を JSON として解析できません`)
      continue
    }
    if (!sameArray(validateRequest(parsed), [])) {
      problems.push(`${name}: GET の回答例が回答条件を満たしません`)
    }
    try {
      assert.deepEqual(parsed, example.value)
    } catch {
      problems.push(`${name}: GET の回答例が seed 本文の例と一致しません`)
    }
  }
  return problems
}

const failures = []
let checks = 0
function test(name, fn) {
  checks += 1
  try {
    fn()
  } catch (error) {
    failures.push(`${name}: ${error.message}`)
  }
}

test('星カタログの基本形', () => {
  assert.equal(themes.length, 15, '星は15件である必要があります')
  assert.equal(new Set(themeIds).size, 15, '星IDが重複しています')
  assert.equal(level1Ids.length, 9, '大ジャンルは9件である必要があります')
  assert.equal(themes.filter((theme) => theme.parentId !== null).length, 6, '中ジャンルは6件である必要があります')
  for (const theme of themes) {
    assert.ok(theme.parentId === null || themeIds.includes(theme.parentId), `${theme.id}: 親IDが存在しません`)
  }
})

test('質問票カタログの基本形', () => {
  for (const { name, data } of questionnaireEntries) {
    assert.equal(`${data.version}.json`, name, `${name}: version とファイル名が一致しません`)
    const questionIds = data.questions.map((question) => question.id)
    assert.equal(new Set(questionIds).size, questionIds.length, `${name}: 質問IDが重複しています`)
    for (const question of data.questions) {
      const optionIds = question.options.map((option) => option.id)
      assert.equal(new Set(optionIds).size, optionIds.length, `${name}/${question.id}: 選択肢IDが重複しています`)
      for (const exclusive of question.exclusiveOptionIds ?? []) {
        assert.ok(optionIds.includes(exclusive), `${name}/${question.id}: 排他選択肢 ${exclusive} が選択肢にありません`)
      }
    }
  }
})

test('質問票の版とv2分岐', () => {
  assert.deepEqual([...byVersion.keys()].sort(), ['onboarding-v1', 'onboarding-v2'])
  const v1 = byVersion.get('onboarding-v1')
  assert.deepEqual(v1.questions.map((q) => q.id).sort(), ['interest', 'reading_experience', 'themes'])
  const curiosity = byVersion.get('onboarding-v2').questions.find((q) => q.id === 'curiosity')
  assert.deepEqual(curiosity.options.map((o) => o.id).sort(), ['city_origins', 'music_emotions', 'space_mysteries'])
  assert.equal(curiosity.requiredWhen.includesOptionId, 'none')
  assert.equal(curiosity.forbiddenWhen.excludesOptionId, 'none')
})

test('OpenAPIとカタログの一致・新ルート要件', () => {
  const problems = consistencyProblems(spec, themes, questionnaireEntries)
  assert.deepEqual(problems, [], problems.join(' / '))
})

test('旧パスが存在しない', () => {
  assert.equal(spec.paths[OLD_PATH], undefined)
})

test('seedの定義済みステータス', () => {
  const seed = spec.paths[SEED_PATH].post
  assert.deepEqual(Object.keys(seed.responses).sort(), [...SEED_STATUSES].sort(), 'seedのレスポンスステータスが契約と一致しません')
})

test('GETの定義済みステータス（503なし）', () => {
  const get = spec.paths[BOOKS_PATH].get
  assert.deepEqual(Object.keys(get.responses).sort(), [...BOOKS_STATUSES].sort(), 'GETのレスポンスステータスが契約と一致しません')
  assert.equal(get.responses['503'], undefined, 'GET が 503 を定義しています')
})

const seedPost = spec.paths[SEED_PATH].post
const seedExamples = seedPost.requestBody.content['application/json'].examples
for (const name of SEED_EXAMPLE_NAMES) {
  test(`seed本文例 ${name}`, () => {
    assert.ok(seedExamples[name], '例がありません')
    assert.deepEqual(validateRequest(seedExamples[name].value), [])
  })
}

test('seed成功例の3星・一意・検索語', () => {
  const response = seedPost.responses['200'].content['application/json'].examples.success.value
  assert.deepEqual(seedResponseProblems(response), [])
})

for (const example of seedPost['x-invalid-request-examples'] ?? []) {
  test(`seed不正例 ${example.name}`, () => {
    const codes = validateRequest(example.value)
    assert.ok(codes.includes(example.expectError), `${example.expectError} を返しません: ${codes.join(',')}`)
  })
}

const booksGet = spec.paths[BOOKS_PATH].get
const contextParam = booksGet.parameters.find((parameter) => parameter.in === 'header' && parameter.name === 'X-Discovery-Context')
for (const name of SEED_EXAMPLE_NAMES) {
  test(`GET回答ヘッダー例 ${name}`, () => {
    const example = contextParam.examples[name]
    assert.ok(example, '例がありません')
    assert.equal(typeof example.value, 'string')
    assert.deepEqual(validateRequest(JSON.parse(example.value)), [])
    assert.deepEqual(JSON.parse(example.value), seedExamples[name].value)
  })
}

test('GETはqだけで本文なし', () => {
  assert.equal(booksGet.requestBody, undefined)
  assert.deepEqual(
    booksGet.parameters.filter((parameter) => parameter.in === 'query').map((parameter) => parameter.name),
    ['q'],
  )
})

test('GETの空q否定例', () => {
  const q = booksGet.parameters.find((parameter) => parameter.in === 'query' && parameter.name === 'q')
  assert.equal(q.schema.minLength, 1)
  const example = booksGet.responses['422'].content['application/json'].examples['invalid-query'].value
  assert.equal(example.error.code, 'VALIDATION_ERROR')
  assert.ok(example.error.details.some((detail) => detail.field === 'q'), '空qの詳細が q を指していません')
})

test('GETの欠落ヘッダー・未知星の否定例とErrorDetail enum', () => {
  const examples = booksGet.responses['422'].content['application/json'].examples
  const codes = spec.components.schemas.ErrorDetail.properties.code.enum
  assert.ok(codes.includes('UNKNOWN_THEME_ID'), 'ErrorDetail.code に UNKNOWN_THEME_ID がありません')
  const missingContext = examples['missing-context'].value.error
  assert.equal(missingContext.code, 'VALIDATION_ERROR')
  assert.deepEqual(missingContext.details[0], {
    field: 'X-Discovery-Context',
    code: 'INVALID_REQUEST_SHAPE',
  })
  const unknownTheme = examples['unknown-theme'].value.error
  assert.equal(unknownTheme.code, 'VALIDATION_ERROR')
  assert.deepEqual(unknownTheme.details[0], { field: 'themeId', code: 'UNKNOWN_THEME_ID' })
  for (const detail of [...missingContext.details, ...unknownTheme.details]) {
    assert.ok(codes.includes(detail.code), `${detail.code} が ErrorDetail.code の enum にありません`)
  }
})

test('変異: seed本文にthemeIdが入っていない', () => {
  for (const variant of seedRequestVariants(spec)) {
    assert.equal(variant.properties.themeId, undefined)
    assert.ok(!(variant.required ?? []).includes('themeId'))
  }
  const request = structuredClone(seedExamples['v1-normal'].value)
  request.themeId = 'tec'
  assert.ok(validateRequest(request).includes('INVALID_REQUEST_SHAPE'))
})

test('変異: 未知の星', () => {
  const broken = structuredClone(spec)
  broken.components.schemas.ThemeId.enum.push('fake-star')
  assert.notDeepEqual(consistencyProblems(broken, themes, questionnaireEntries), [])
})

test('変異: 未知の選択肢', () => {
  const broken = structuredClone(spec)
  broken.components.schemas.AnswerInterest.properties.selectedOptionIds.items.enum.push('fake_option')
  assert.notDeepEqual(consistencyProblems(broken, themes, questionnaireEntries), [])
})

test('変異: seedのanswers上限を変更', () => {
  const broken = structuredClone(spec)
  broken.components.schemas.SeedRequestV1.properties.answers.maxItems = 9
  assert.notDeepEqual(consistencyProblems(broken, themes, questionnaireEntries), [])
})

test('変異: seed応答の星が重複', () => {
  const broken = structuredClone(spec)
  const response = broken.paths[SEED_PATH].post.responses['200'].content['application/json'].examples.success.value
  response.themes[1].themeId = response.themes[0].themeId
  assert.notDeepEqual(consistencyProblems(broken, themes, questionnaireEntries), [])
})

test('変異: seed応答に中ジャンルが混ざる', () => {
  const broken = structuredClone(spec)
  const response = broken.paths[SEED_PATH].post.responses['200'].content['application/json'].examples.success.value
  response.themes[0].themeId = 'tec-prog'
  assert.notDeepEqual(seedResponseProblems(response), [])
})

test('変異: seed応答の検索語が空', () => {
  const broken = structuredClone(spec)
  const response = broken.paths[SEED_PATH].post.responses['200'].content['application/json'].examples.success.value
  response.themes[2].searchQuery = '   '
  assert.notDeepEqual(seedResponseProblems(response), [])
})

test('変異: seed応答が2件', () => {
  const broken = structuredClone(spec)
  const response = broken.paths[SEED_PATH].post.responses['200'].content['application/json'].examples.success.value
  response.themes.pop()
  assert.notDeepEqual(seedResponseProblems(response), [])
})

test('変異: GETに旧クエリ answers を追加', () => {
  const broken = structuredClone(spec)
  broken.paths[BOOKS_PATH].get.parameters.push({
    name: 'answers',
    in: 'query',
    required: false,
    schema: { type: 'string' },
  })
  assert.notDeepEqual(consistencyProblems(broken, themes, questionnaireEntries), [])
})

test('変異: GETに本文を追加', () => {
  const broken = structuredClone(spec)
  broken.paths[BOOKS_PATH].get.requestBody = {
    content: { 'application/json': { schema: { type: 'object' } } },
  }
  assert.notDeepEqual(consistencyProblems(broken, themes, questionnaireEntries), [])
})

test('変異: GETの回答ヘッダーを任意にする', () => {
  const broken = structuredClone(spec)
  broken.paths[BOOKS_PATH].get.parameters.find((parameter) => parameter.name === 'X-Discovery-Context').required = false
  assert.notDeepEqual(consistencyProblems(broken, themes, questionnaireEntries), [])
})

test('変異: 旧パスを戻す', () => {
  const broken = structuredClone(spec)
  broken.paths[OLD_PATH] = { post: { responses: {} } }
  assert.notDeepEqual(consistencyProblems(broken, themes, questionnaireEntries), [])
})

if (failures.length > 0) {
  console.error(`check-contract: FAIL (${failures.length}/${checks})`)
  for (const failure of failures) console.error(`- ${failure}`)
  process.exitCode = 1
} else {
  const invalidCount = (seedPost['x-invalid-request-examples'] ?? []).length
  console.log(`check-contract: PASS (${checks} checks)`)
  console.log(`- 星: ${themes.length}件（大${level1Ids.length}・中${themes.length - level1Ids.length}）`)
  console.log(`- 質問票: ${[...byVersion.keys()].join(', ')}`)
  console.log(`- seed本文例: ${SEED_EXAMPLE_NAMES.length}件 / 不正例: ${invalidCount}件 / GET回答ヘッダー例: ${SEED_EXAMPLE_NAMES.length}件`)
  console.log('- 対象: カタログとOpenAPIの一致、seed/GETの回答条件、seed応答の3星・検索語、GETの本文なし・必須条件、変異の検出')
  console.log('- 注記: Redocly が構造とexampleを検証する。本番バリデータではなく、APIの動作確認も行わない')
}
