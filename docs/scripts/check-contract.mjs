#!/usr/bin/env node
/**
 * ほしるべ API 契約の静的検証（ドキュメント用途）。
 * 1. 星・質問ID・enum・選択数・版が contracts/ と docs/openapi.yaml で一致するか
 * 2. リクエスト例が質問の一意性・必須・排他・v2分岐を満たすか
 * 3. 未知の星・未知の選択肢・不正なv2分岐を、壊したコピーで検出できるか
 * OpenAPI の構造・example の検証は Redocly lint が担当する。本番バリデータではない。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'
const docsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.resolve(docsDir, '..')
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

const sameSet = (a, b) =>
  Array.isArray(a) && Array.isArray(b) && new Set(a).size === new Set(b).size && [...new Set(a)].every((v) => new Set(b).has(v))
const sameArray = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i])
function resolve(root, node) {
  if (!node?.$ref) return node
  return node.$ref.replace(/^#\//, '').split('/').reduce((current, part) => current?.[part], root)
}
function requestVariants(specValue) {
  const schema = resolve(
    specValue,
    specValue.paths?.['/v1/books/recommendations']?.post?.requestBody?.content?.['application/json']?.schema,
  )
  return (schema?.oneOf ?? []).map((node) => resolve(specValue, node))
}
/** OpenAPI とカタログの不一致を列挙する。壊したコピーの検出にも使う。 */
function consistencyProblems(specValue, themeList, catalogEntries) {
  const problems = []
  const expect = (condition, message) => {
    if (!condition) problems.push(message)
  }
  const ids = themeList.map((theme) => theme.id)
  const level1 = themeList.filter((theme) => theme.parentId === null).map((theme) => theme.id)
  const catalogs = new Map(catalogEntries.map(({ data }) => [data.version, data]))
  const variants = requestVariants(specValue)
  expect(sameSet(specValue.components?.schemas?.ThemeId?.enum, ids), 'ThemeId の enum が星カタログと一致しません')
  expect(variants.length === 2, 'リクエストが v1/v2 の2つの oneOf になっていません')
  expect(
    sameSet(variants.map((variant) => variant?.['x-contract-questionnaire-version']), [...catalogs.keys()]),
    'リクエストの版が質問票カタログと一致しません',
  )

  for (const variant of variants) {
    const version = variant?.['x-contract-questionnaire-version']
    const catalog = catalogs.get(version)
    if (!catalog) {
      problems.push(`${version}: カタログにない版です`)
      continue
    }
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
  return problems
}

/** 回答の意味条件だけを見る。スキーマの型検証は Redocly に任せる。 */
function validateRequest(request) {
  const codes = []
  if (!request || typeof request !== 'object' || !Array.isArray(request.answers)) return ['INVALID_REQUEST_SHAPE']
  if (!themeIds.includes(request.themeId)) codes.push('UNKNOWN_THEME_ID')
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

test('OpenAPIとカタログの一致', () => {
  const problems = consistencyProblems(spec, themes, questionnaireEntries)
  assert.deepEqual(problems, [], problems.join(' / '))
})

const post = spec.paths['/v1/books/recommendations'].post
test('POSTの定義済みステータス', () => {
  assert.deepEqual(
    Object.keys(post.responses).sort(),
    ['200', '400', '413', '415', '422', '429', '500', '502', '504'].sort(),
    'POSTのレスポンスステータスが契約と一致しません',
  )
})
const examples = post.requestBody.content['application/json'].examples
const validExampleNames = ['v1-normal', 'v1-none', 'v2-curiosity', 'v2-no-curiosity']
for (const name of validExampleNames) {
  test(`request例 ${name}`, () => {
    assert.ok(examples[name], '例がありません')
    assert.deepEqual(validateRequest(examples[name].value), [])
  })
}

for (const example of post['x-invalid-request-examples'] ?? []) {
  test(`不正例 ${example.name}`, () => {
    const codes = validateRequest(example.value)
    assert.ok(codes.includes(example.expectError), `${example.expectError} を返しません: ${codes.join(',')}`)
  })
}

test('変異: 未知の星', () => {
  const request = structuredClone(examples['v1-normal'].value)
  request.themeId = 'fake-star'
  assert.ok(validateRequest(request).includes('UNKNOWN_THEME_ID'))
})

test('変異: 未知の選択肢', () => {
  const request = structuredClone(examples['v1-normal'].value)
  request.answers[0].selectedOptionIds = ['fake_option']
  assert.ok(validateRequest(request).includes('UNKNOWN_OPTION_ID'))
})

test('変異: v2でcuriosity欠落', () => {
  const request = structuredClone(examples['v2-no-curiosity'].value)
  request.answers.find((answer) => answer.questionId === 'interest').selectedOptionIds = ['none']
  assert.ok(validateRequest(request).includes('MISSING_REQUIRED_QUESTION'))
})

test('変異: v2でcuriosityが禁止なのに送信', () => {
  const request = structuredClone(examples['v2-curiosity'].value)
  request.answers.find((answer) => answer.questionId === 'interest').selectedOptionIds = ['create']
  assert.ok(validateRequest(request).includes('FORBIDDEN_QUESTION'))
})

test('変異: OpenAPIに未知の星を追加', () => {
  const broken = structuredClone(spec)
  broken.components.schemas.ThemeId.enum.push('fake-star')
  assert.notDeepEqual(consistencyProblems(broken, themes, questionnaireEntries), [])
})

test('変異: OpenAPIに未知の選択肢を追加', () => {
  const broken = structuredClone(spec)
  broken.components.schemas.AnswerInterest.properties.selectedOptionIds.items.enum.push('fake_option')
  assert.notDeepEqual(consistencyProblems(broken, themes, questionnaireEntries), [])
})

test('変異: OpenAPIのanswers上限を変更', () => {
  const broken = structuredClone(spec)
  broken.components.schemas.RecommendationRequestV1.properties.answers.maxItems = 9
  assert.notDeepEqual(consistencyProblems(broken, themes, questionnaireEntries), [])
})

if (failures.length > 0) {
  console.error(`check-contract: FAIL (${failures.length}/${checks})`)
  for (const failure of failures) console.error(`- ${failure}`)
  process.exitCode = 1
} else {
  console.log(`check-contract: PASS (${checks} checks)`)
  console.log(`- 星: ${themes.length}件（大${level1Ids.length}・中${themes.length - level1Ids.length}）`)
  console.log(`- 質問票: ${[...byVersion.keys()].join(', ')}`)
  console.log(`- request例: ${validExampleNames.length}件 / 不正例: ${(post['x-invalid-request-examples'] ?? []).length}件`)
  console.log('- 対象: カタログとOpenAPIの一致、回答の意味条件、変異の検出')
  console.log('- 注記: Redocly が構造とexampleを検証する。本番バリデータではなく、APIの動作確認も行わない')
}
