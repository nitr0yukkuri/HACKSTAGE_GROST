import http from 'k6/http'
import { check } from 'k6'

const BASE_URL = (__ENV.BASE_URL || 'http://127.0.0.1:8787').replace(/\/$/, '')
const LOAD_PROFILE = __ENV.K6_PROFILE === 'load'
const NORMAL_CONTEXT = {
  questionnaireVersion: 'onboarding-v2',
  answers: [
    { questionId: 'interest', selectedOptionIds: ['create'] },
    { questionId: 'themes', selectedOptionIds: ['tec', 'mon'] },
    { questionId: 'reading_experience', selectedOptionIds: ['learn_knowledge'] },
  ],
}
const NONE_CONTEXT = {
  questionnaireVersion: 'onboarding-v2',
  answers: [
    { questionId: 'interest', selectedOptionIds: ['none'] },
    { questionId: 'curiosity', selectedOptionIds: ['music_emotions', 'space_mysteries'] },
    { questionId: 'themes', selectedOptionIds: ['omakase'] },
    { questionId: 'reading_experience', selectedOptionIds: ['new_perspective'] },
  ],
}
const V1_CONTEXT = {
  questionnaireVersion: 'onboarding-v1',
  answers: [
    { questionId: 'interest', selectedOptionIds: ['people_society'] },
    { questionId: 'themes', selectedOptionIds: ['soc'] },
    { questionId: 'reading_experience', selectedOptionIds: ['deepen_thought'] },
  ],
}

export const options = LOAD_PROFILE
  ? {
      stages: [
        { duration: '10s', target: 1 },
        { duration: '20s', target: 5 },
        { duration: '20s', target: 5 },
        { duration: '10s', target: 0 },
      ],
      thresholds: {
        checks: ['rate==1'],
        http_req_failed: ['rate<0.01'],
        http_req_duration: ['p(95)<500', 'p(99)<1000'],
      },
    }
  : {
      vus: 1,
      iterations: 1,
      thresholds: {
        checks: ['rate==1'],
        http_req_failed: ['rate<0.01'],
      },
    }

export function setup() {
  const health = http.get(`${BASE_URL}/health`, { tags: { name: 'health' } })
  check(health, {
    'health responds 200': (response) => response.status === 200,
    'health is no-store': (response) => response.headers['Cache-Control'] === 'no-store',
    'health has only contract fields': (response) => {
      const payload = response.json()
      return payload.status === 'ok' && typeof payload.requestId === 'string' && Object.keys(payload).length === 2
    },
  })

  const preflight = http.options(`${BASE_URL}/v1/themes/tec/books`, {
    headers: {
      Origin: 'http://localhost:3000',
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'x-discovery-context',
    },
    tags: { name: 'cors-preflight' },
  })
  check(preflight, {
    'CORS preflight responds 204': (response) => response.status === 204,
    'CORS allows the configured origin': (response) => response.headers['Access-Control-Allow-Origin'] === (__ENV.MOCK_API_ALLOWED_ORIGIN || '*'),
    'CORS allows discovery context': (response) => String(response.headers['Access-Control-Allow-Headers'] ?? '').toLowerCase().includes('x-discovery-context'),
    'CORS allows GET and POST': (response) => String(response.headers['Access-Control-Allow-Methods'] ?? '').includes('GET') && String(response.headers['Access-Control-Allow-Methods'] ?? '').includes('POST'),
  })
}

function seed(context, tag, expectedStatus = 200) {
  const params = {
    headers: { 'Content-Type': 'application/json' },
    tags: { name: 'discovery-seed', case: tag },
  }
  if (expectedStatus !== 200) params.responseCallback = http.expectedStatuses(expectedStatus)
  return http.post(`${BASE_URL}/v1/discovery/seed`, JSON.stringify(context), params)
}

function books(themeId, q, context, tag, expectedStatus = 200, include = null) {
  const query = encodeURIComponent(q)
  const includeQuery = include === null ? '' : `&include=${encodeURIComponent(include)}`
  const params = {
    headers: { 'X-Discovery-Context': JSON.stringify(context) },
    tags: { name: 'theme-books', case: tag },
  }
  if (expectedStatus !== 200) params.responseCallback = http.expectedStatuses(expectedStatus)
  return http.get(`${BASE_URL}/v1/themes/${encodeURIComponent(themeId)}/books?q=${query}${includeQuery}`, params)
}

export default function () {
  const seeded = seed(NORMAL_CONTEXT, LOAD_PROFILE ? 'load-flow' : 'v2-normal')
  const seedOk = check(seeded, {
    'v2 seed responds 200': (response) => response.status === 200,
    'seed returns a request ID': (response) => Boolean(response.json('requestId')),
    'seed returns exactly three themes': (response) => response.json('themes')?.length === 3,
    'seed themes are distinct': (response) => {
      const themes = response.json('themes') ?? []
      return new Set(themes.map((theme) => theme.themeId)).size === 3
    },
    'seed search terms are nonempty': (response) => (response.json('themes') ?? []).every((theme) => typeof theme.searchQuery === 'string' && theme.searchQuery.length > 0),
  })
  if (seedOk && seeded.status === 200) {
    const firstTheme = seeded.json('themes')[0]
    const result = books(firstTheme.themeId, firstTheme.searchQuery, NORMAL_CONTEXT, 'v2-books', 200, 'selectedBy')
    check(result, {
      'books responds 200': (response) => response.status === 200,
      'books items is an array': (response) => Array.isArray(response.json('items')),
      'books returns at least one item': (response) => (response.json('items') ?? []).length >= 1,
      'books theme matches request': (response) => response.json('themeId') === firstTheme.themeId,
      'books stay within the 5 item limit': (response) => (response.json('items') ?? []).length <= 5,
      'book item has required contract fields': (response) => (response.json('items') ?? []).every((book) =>
        typeof book.id === 'string' && book.source === 'google_books' && typeof book.title === 'string' &&
        Array.isArray(book.authors) && Object.prototype.hasOwnProperty.call(book, 'coverUrl') &&
        Object.prototype.hasOwnProperty.call(book, 'description') &&
        Object.prototype.hasOwnProperty.call(book, 'recommendationReason') &&
        Object.prototype.hasOwnProperty.call(book, 'selectedBy') &&
        (book.selectedBy === 'ai' || book.selectedBy === 'search') &&
        Object.prototype.hasOwnProperty.call(book, 'infoUrl')),
      'book response is no-store': (response) => response.headers['Cache-Control'] === 'no-store',
    })

    const withoutInclude = books(firstTheme.themeId, firstTheme.searchQuery, NORMAL_CONTEXT, 'v2-books-no-include')
    check(withoutInclude, {
      'books without include responds 200': (response) => response.status === 200,
      'books without include items is an array': (response) => Array.isArray(response.json('items')),
      'books without include returns at least one item': (response) => (response.json('items') ?? []).length >= 1,
      'book item omits selectedBy without include': (response) => (response.json('items') ?? []).every((book) =>
        !Object.prototype.hasOwnProperty.call(book, 'selectedBy')),
    })
  }

  if (LOAD_PROFILE) return

  const noneSeed = seed(NONE_CONTEXT, 'v2-none-with-curiosity')
  check(noneSeed, {
    'v2 none plus curiosity is accepted': (response) => response.status === 200,
    'conditional seed still returns three themes': (response) => response.json('themes')?.length === 3,
  })

  const v1Seed = seed(V1_CONTEXT, 'v1-compatibility')
  check(v1Seed, { 'v1 seed is accepted': (response) => response.status === 200 })

  const invalidContext = {
    ...NORMAL_CONTEXT,
    answers: NORMAL_CONTEXT.answers.map((answer) => answer.questionId === 'themes'
      ? { ...answer, selectedOptionIds: ['omakase', 'tec'] }
      : answer),
  }
  const invalidSeed = seed(invalidContext, 'invalid-exclusive-options', 422)
  check(invalidSeed, {
    'invalid seed responds 422': (response) => response.status === 422,
    'invalid seed uses standard error envelope': (response) => Boolean(response.json('requestId') && response.json('error.code') === 'VALIDATION_ERROR' && Array.isArray(response.json('error.details'))),
  })

  const invalidCases = [
    ['request shape', { ...NORMAL_CONTEXT, unexpected: true }, 'INVALID_REQUEST_SHAPE'],
    ['answer count', { ...NORMAL_CONTEXT, answers: NORMAL_CONTEXT.answers.slice(0, 2) }, 'ANSWERS_COUNT_OUT_OF_RANGE'],
    ['unknown question', { ...NORMAL_CONTEXT, answers: NORMAL_CONTEXT.answers.map((answer) => answer.questionId === 'reading_experience' ? { ...answer, questionId: 'unknown' } : answer) }, 'UNKNOWN_QUESTION_ID'],
    ['duplicate question', { ...NORMAL_CONTEXT, answers: [...NORMAL_CONTEXT.answers.slice(0, 2), NORMAL_CONTEXT.answers[0]] }, 'DUPLICATE_QUESTION_ID'],
    ['empty selection', { ...NORMAL_CONTEXT, answers: NORMAL_CONTEXT.answers.map((answer) => answer.questionId === 'themes' ? { ...answer, selectedOptionIds: [] } : answer) }, 'EMPTY_SELECTION'],
    ['duplicate option', { ...NORMAL_CONTEXT, answers: NORMAL_CONTEXT.answers.map((answer) => answer.questionId === 'themes' ? { ...answer, selectedOptionIds: ['tec', 'tec'] } : answer) }, 'DUPLICATE_OPTION_ID'],
    ['unknown option', { ...NORMAL_CONTEXT, answers: NORMAL_CONTEXT.answers.map((answer) => answer.questionId === 'themes' ? { ...answer, selectedOptionIds: ['unknown'] } : answer) }, 'UNKNOWN_OPTION_ID'],
    ['selection count', { ...NORMAL_CONTEXT, answers: NORMAL_CONTEXT.answers.map((answer) => answer.questionId === 'interest' ? { ...answer, selectedOptionIds: ['create', 'none'] } : answer) }, 'SELECTION_COUNT_OUT_OF_RANGE'],
  ]
  for (const [name, context, expectedCode] of invalidCases) {
    const response = seed(context, `validation-${name.replace(/\s+/g, '-')}`, 422)
    check(response, {
      [`${name} is rejected with its contract code`]: (result) => result.status === 422 &&
        result.json('error.details')?.some((item) => item.code === expectedCode),
    })
  }

  const missingContext = http.get(`${BASE_URL}/v1/themes/tec/books?q=${encodeURIComponent('プログラミング')}`, {
    responseCallback: http.expectedStatuses(422),
    tags: { name: 'theme-books', case: 'missing-context' },
  })
  check(missingContext, {
    'missing context responds 422': (response) => response.status === 422,
    'missing context identifies its field': (response) => response.json('error.details.0.field') === 'X-Discovery-Context',
  })

  const emptyResult = books('tec', '__empty__', NORMAL_CONTEXT, 'empty-books')
  check(emptyResult, {
    'empty search responds 200': (response) => response.status === 200,
    'empty search returns an empty array': (response) => response.json('items')?.length === 0,
  })

  const warningResult = books('tec', '__warning__', NORMAL_CONTEXT, 'partial-warning')
  check(warningResult, {
    'partial metadata remains a successful response': (response) => response.status === 200,
    'partial metadata includes a warning': (response) => response.json('warnings')?.some((warning) => warning.code === 'RECOMMENDATION_REASON_UNAVAILABLE'),
    'missing description is reported separately': (response) => response.json('warnings')?.some((warning) => warning.code === 'INSUFFICIENT_BOOK_METADATA'),
  })

  const missingCuriosity = { ...NONE_CONTEXT, answers: NONE_CONTEXT.answers.filter((answer) => answer.questionId !== 'curiosity') }
  const missingCuriosityResult = seed(missingCuriosity, 'v2-missing-conditional-answer', 422)
  check(missingCuriosityResult, {
    'v2 none requires its conditional question': (response) => response.json('error.details')?.some((item) => item.code === 'MISSING_REQUIRED_QUESTION'),
  })

  const forbiddenCuriosity = {
    ...NORMAL_CONTEXT,
    answers: [
      { questionId: 'interest', selectedOptionIds: ['explore_unknown'] },
      { questionId: 'curiosity', selectedOptionIds: ['city_origins'] },
      { questionId: 'themes', selectedOptionIds: ['lit'] },
      { questionId: 'reading_experience', selectedOptionIds: ['immerse_story'] },
    ],
  }
  const forbiddenCuriosityResult = seed(forbiddenCuriosity, 'v2-forbidden-conditional-answer', 422)
  check(forbiddenCuriosityResult, {
    'v2 forbids its conditional question outside none': (response) => response.json('error.details')?.some((item) => item.code === 'FORBIDDEN_QUESTION'),
  })

  const v1WithCuriosity = { ...V1_CONTEXT, answers: [...V1_CONTEXT.answers, { questionId: 'curiosity', selectedOptionIds: ['music_emotions'] }] }
  const v1CuriosityResult = seed(v1WithCuriosity, 'v1-unknown-question', 422)
  check(v1CuriosityResult, {
    'v1 rejects the v2-only question ID': (response) => response.json('error.details.0.code') === 'UNKNOWN_QUESTION_ID',
  })

  const unsupported = seed({ ...NORMAL_CONTEXT, questionnaireVersion: 'onboarding-v99' }, 'unsupported-version', 422)
  check(unsupported, {
    'unsupported questionnaire version is explicit': (response) => response.json('error.code') === 'UNSUPPORTED_QUESTIONNAIRE_VERSION',
  })

  const invalidJson = http.post(`${BASE_URL}/v1/discovery/seed`, '{', {
    headers: { 'Content-Type': 'application/json' }, responseCallback: http.expectedStatuses(400),
    tags: { name: 'discovery-seed', case: 'invalid-json' },
  })
  check(invalidJson, { 'invalid JSON uses the error envelope': (response) => response.json('error.code') === 'INVALID_JSON' })

  const unsupportedMedia = http.post(`${BASE_URL}/v1/discovery/seed`, 'data', {
    headers: { 'Content-Type': 'text/plain' }, responseCallback: http.expectedStatuses(415),
    tags: { name: 'discovery-seed', case: 'unsupported-media-type' },
  })
  check(unsupportedMedia, { 'unsupported content type is rejected': (response) => response.json('error.code') === 'UNSUPPORTED_MEDIA_TYPE' })

  const oversizedPayload = http.post(`${BASE_URL}/v1/discovery/seed`, JSON.stringify({ ...NORMAL_CONTEXT, extra: 'x'.repeat(9000) }), {
    headers: { 'Content-Type': 'application/json' }, responseCallback: http.expectedStatuses(413),
    tags: { name: 'discovery-seed', case: 'payload-too-large' },
  })
  check(oversizedPayload, { 'payload byte limit is enforced': (response) => response.json('error.code') === 'PAYLOAD_TOO_LARGE' })

  const invalidQuery = books('tec', '   ', NORMAL_CONTEXT, 'empty-query', 422)
  check(invalidQuery, { 'blank q returns a validation error': (response) => response.json('error.details.0.field') === 'q' })

  const maxCodePointQuery = books('tec', '😀'.repeat(128), NORMAL_CONTEXT, 'max-code-point-query')
  if (maxCodePointQuery.status !== 200) console.log(`128-code-point q returned ${maxCodePointQuery.status}: ${maxCodePointQuery.body}`)
  check(maxCodePointQuery, { '128 Unicode code points are accepted for q': (response) => response.status === 200 })
  const tooLongCodePointQuery = books('tec', '😀'.repeat(129), NORMAL_CONTEXT, 'too-long-code-point-query', 422)
  check(tooLongCodePointQuery, { '129 Unicode code points are rejected for q': (response) => response.status === 422 })

  const unknownTheme = books('not-a-theme', 'test', NORMAL_CONTEXT, 'unknown-theme', 422)
  check(unknownTheme, { 'unknown theme ID is rejected': (response) => response.json('error.details.0.code') === 'UNKNOWN_THEME_ID' })

  const badContext = http.get(`${BASE_URL}/v1/themes/tec/books?q=test`, {
    headers: { 'X-Discovery-Context': '{' }, responseCallback: http.expectedStatuses(400),
    tags: { name: 'theme-books', case: 'malformed-context-json' },
  })
  check(badContext, { 'malformed context header has a specific error': (response) => response.json('error.code') === 'INVALID_CONTEXT_JSON' })

  const oversizedContext = http.get(`${BASE_URL}/v1/themes/tec/books?q=test`, {
    headers: { 'X-Discovery-Context': 'x'.repeat(4097) }, responseCallback: http.expectedStatuses(431),
    tags: { name: 'theme-books', case: 'context-too-large' },
  })
  check(oversizedContext, { 'context byte limit is enforced': (response) => response.json('error.code') === 'CONTEXT_TOO_LARGE' })
}
