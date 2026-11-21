import { WORLDS } from '../../data/worlds'
import { encodeAnswers } from '../recommendations'
import { normalizeBookCoverUrl } from '../book-covers'
import type { Book, OnboardingAnswers } from '../../types/hoshirube'

export interface DiscoveryAnswer {
  questionId: string
  selectedOptionIds: string[]
}

export interface DiscoveryContext {
  questionnaireVersion: 'onboarding-v1' | 'onboarding-v2'
  answers: DiscoveryAnswer[]
}

export interface SeedTheme {
  themeId: string
  searchQuery: string
}

export interface DiscoverySeed {
  requestId: string
  themes: SeedTheme[]
}

export interface BookWarning {
  code: 'INSUFFICIENT_BOOK_METADATA' | 'RECOMMENDATION_REASON_UNAVAILABLE'
  message: string
}

export interface BookRecommendation {
  requestId: string
  themeId: string
  items: Book[]
  warnings: BookWarning[]
}

export interface DiscoverySession {
  context: DiscoveryContext
  seed: DiscoverySeed
  createdAt: number
}

export class DiscoveryApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly requestId: string | null = null,
    readonly details: { field: string; code: string }[] = [],
  ) {
    super(message)
    this.name = 'DiscoveryApiError'
  }
}

const SESSION_KEY = 'hoshirube:discovery-session:v1'
const REQUEST_TIMEOUT_MS = 30_000
const LEVEL_1_IDS = new Set(WORLDS.filter((world) => world.level === 1).map((world) => world.id))
let memorySession: DiscoverySession | null = null

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const hasOnlyKeys = (value: Record<string, unknown>, keys: string[]): boolean =>
  Object.keys(value).every((key) => keys.includes(key)) && keys.every((key) => Object.hasOwn(value, key))

const nonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

function configuredBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_API_BASE_URL?.trim()
  if (!raw) throw new DiscoveryApiError('APIの接続先が設定されていません。', 0, 'API_NOT_CONFIGURED')
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new DiscoveryApiError('APIの接続先URLを確認してください。', 0, 'INVALID_API_BASE_URL')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new DiscoveryApiError('APIの接続先にはHTTPまたはHTTPSのURLを指定してください。', 0, 'INVALID_API_BASE_URL')
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new DiscoveryApiError('APIの接続先URLに認証情報・クエリ・フラグメントは指定できません。', 0, 'INVALID_API_BASE_URL')
  }
  return url.toString().replace(/\/+$/, '')
}

export function isDiscoveryApiConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_API_BASE_URL?.trim())
}

export function createDiscoveryContext(answers: OnboardingAnswers): DiscoveryContext {
  return JSON.parse(encodeAnswers(answers)) as DiscoveryContext
}

function apiErrorFromPayload(status: number, payload: unknown): DiscoveryApiError {
  const root = isRecord(payload) ? payload : null
  const error = root && isRecord(root.error) ? root.error : null
  const requestId = root && nonEmptyString(root.requestId) ? root.requestId : null
  const details = error && Array.isArray(error.details)
    ? error.details.filter((item): item is { field: string; code: string } =>
        isRecord(item) && nonEmptyString(item.field) && nonEmptyString(item.code))
    : []
  const code = error && nonEmptyString(error.code) ? error.code : `HTTP_${status}`
  const message = error && nonEmptyString(error.message)
    ? error.message
    : status === 429
      ? 'アクセスが集中しています。少し待ってから再試行してください。'
      : 'APIから応答を受け取れませんでした。時間をおいて再試行してください。'
  return new DiscoveryApiError(message, status, code, requestId, details)
}

async function requestJson(path: string, init: RequestInit = {}, callerSignal?: AbortSignal): Promise<unknown> {
  const base = configuredBaseUrl()
  const controller = new AbortController()
  const onCallerAbort = () => controller.abort()
  if (callerSignal?.aborted) controller.abort()
  else callerSignal?.addEventListener('abort', onCallerAbort, { once: true })

  let timedOut = false
  const timer = window.setTimeout(() => {
    timedOut = true
    controller.abort()
  }, REQUEST_TIMEOUT_MS)

  try {
    let response: Response
    try {
      response = await fetch(new URL(path.replace(/^\//, ''), `${base}/`), {
        ...init,
        cache: 'no-store',
        signal: controller.signal,
      })
    } catch (error) {
      if (callerSignal?.aborted) throw error
      if (timedOut) throw new DiscoveryApiError('APIの応答が30秒以内に届きませんでした。', 504, 'UPSTREAM_TIMEOUT')
      throw new DiscoveryApiError('APIに接続できません。URLとCORS設定を確認してください。', 0, 'NETWORK_ERROR')
    }

    let payload: unknown
    try {
      payload = await response.json()
    } catch (error) {
      if (callerSignal?.aborted) throw error
      if (timedOut) throw new DiscoveryApiError('APIの応答が30秒以内に届きませんでした。', 504, 'UPSTREAM_TIMEOUT')
      if (!response.ok) throw apiErrorFromPayload(response.status, null)
      throw new DiscoveryApiError('APIの応答JSONを読み取れませんでした。', response.status, 'INVALID_API_RESPONSE')
    }
    if (!response.ok) throw apiErrorFromPayload(response.status, payload)
    return payload
  } finally {
    window.clearTimeout(timer)
    callerSignal?.removeEventListener('abort', onCallerAbort)
  }
}

function parseSeed(payload: unknown): DiscoverySeed {
  if (!isRecord(payload) || !hasOnlyKeys(payload, ['requestId', 'themes']) || !nonEmptyString(payload.requestId) ||
      !Array.isArray(payload.themes) || payload.themes.length !== 3) {
    throw new DiscoveryApiError('星の候補APIが契約と異なる応答を返しました。', 502, 'INVALID_API_RESPONSE')
  }
  const ids = new Set<string>()
  const themes = payload.themes.map((entry) => {
    if (!isRecord(entry) || !hasOnlyKeys(entry, ['themeId', 'searchQuery']) || typeof entry.themeId !== 'string' || !LEVEL_1_IDS.has(entry.themeId) ||
        !nonEmptyString(entry.searchQuery) || Array.from(entry.searchQuery.trim()).length > 128 || entry.searchQuery !== entry.searchQuery.trim()) {
      throw new DiscoveryApiError('星の候補APIが契約と異なる応答を返しました。', 502, 'INVALID_API_RESPONSE')
    }
    if (ids.has(entry.themeId)) {
      throw new DiscoveryApiError('星の候補APIが重複した星を返しました。', 502, 'INVALID_API_RESPONSE')
    }
    ids.add(entry.themeId)
    return { themeId: entry.themeId, searchQuery: entry.searchQuery }
  })
  return { requestId: payload.requestId, themes }
}

export async function createDiscoverySeed(context: DiscoveryContext): Promise<DiscoverySeed> {
  const payload = await requestJson('/v1/discovery/seed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(context),
  })
  return parseSeed(payload)
}

function parseBook(payload: unknown, themeId: string): BookRecommendation {
  if (!isRecord(payload) || !hasOnlyKeys(payload, ['requestId', 'themeId', 'items', 'warnings']) ||
      !nonEmptyString(payload.requestId) || payload.themeId !== themeId ||
      !Array.isArray(payload.items) || payload.items.length > 5 || !Array.isArray(payload.warnings) || payload.warnings.length > 2) {
    throw new DiscoveryApiError('書籍APIが契約と異なる応答を返しました。', 502, 'INVALID_API_RESPONSE')
  }

  const seenIds = new Set<string>()
  const items = payload.items.map((entry): Book => {
    if (!isRecord(entry) || !hasOnlyKeys(entry, ['id', 'source', 'title', 'authors', 'coverUrl', 'description', 'recommendationReason', 'infoUrl']) ||
        !nonEmptyString(entry.id) || entry.source !== 'google_books' ||
        !nonEmptyString(entry.title) || !Array.isArray(entry.authors) || !entry.authors.every(nonEmptyString) ||
        !(entry.coverUrl === null || typeof entry.coverUrl === 'string') ||
        !(entry.description === null || (nonEmptyString(entry.description) && Array.from(entry.description).length <= 1000)) ||
        !(entry.recommendationReason === null || (nonEmptyString(entry.recommendationReason) && Array.from(entry.recommendationReason).length <= 200)) ||
        !(entry.infoUrl === null || (typeof entry.infoUrl === 'string' && /^https:\/\/books\.google\.(com|co\.jp)\//.test(entry.infoUrl)))) {
      throw new DiscoveryApiError('書籍APIが契約と異なる書籍データを返しました。', 502, 'INVALID_API_RESPONSE')
    }
    if (seenIds.has(entry.id)) {
      throw new DiscoveryApiError('書籍APIが重複した本を返しました。', 502, 'INVALID_API_RESPONSE')
    }
    seenIds.add(entry.id)
    const book: Book = {
      id: entry.id,
      source: 'google_books',
      title: entry.title,
      authors: entry.authors,
      coverUrl: normalizeBookCoverUrl(typeof entry.coverUrl === 'string' ? entry.coverUrl : null, 'google_books'),
      description: entry.description,
      recommendationReason: entry.recommendationReason,
      infoUrl: entry.infoUrl,
      worldIds: [themeId],
    }

    return book
  })

  const warnings = payload.warnings.map((entry): BookWarning => {
    if (!isRecord(entry) || !hasOnlyKeys(entry, ['code', 'message']) || !nonEmptyString(entry.message) ||
        (entry.code !== 'INSUFFICIENT_BOOK_METADATA' && entry.code !== 'RECOMMENDATION_REASON_UNAVAILABLE')) {
      throw new DiscoveryApiError('書籍APIが契約と異なる警告を返しました。', 502, 'INVALID_API_RESPONSE')
    }
    return { code: entry.code, message: entry.message }
  })
  if (new Set(warnings.map((warning) => JSON.stringify(warning))).size !== warnings.length) {
    throw new DiscoveryApiError('書籍APIが重複した警告を返しました。', 502, 'INVALID_API_RESPONSE')
  }
  return { requestId: payload.requestId, themeId, items, warnings }
}

export async function getThemeBooks(themeId: string, searchQuery: string, context: DiscoveryContext, signal?: AbortSignal): Promise<BookRecommendation> {
  if (!WORLDS.some((world) => world.id === themeId)) {
    throw new DiscoveryApiError('指定された星がカタログにありません。', 422, 'UNKNOWN_THEME_ID')
  }
  if (!searchQuery.trim() || Array.from(searchQuery.trim()).length > 128 || searchQuery !== searchQuery.trim()) {
    throw new DiscoveryApiError('書籍検索語を確認してください。', 422, 'INVALID_SEARCH_QUERY')
  }
  const params = new URLSearchParams({ q: searchQuery })
  const contextHeader = JSON.stringify(context)
  if (new TextEncoder().encode(contextHeader).byteLength > 4096) {
    throw new DiscoveryApiError('回答データが送信上限を超えています。', 431, 'CONTEXT_TOO_LARGE')
  }
  const payload = await requestJson(`/v1/themes/${encodeURIComponent(themeId)}/books?${params}`, {
    method: 'GET',
    headers: { 'X-Discovery-Context': contextHeader },
  }, signal)
  return parseBook(payload, themeId)
}

export function saveDiscoverySession(session: Omit<DiscoverySession, 'createdAt'>): void {
  memorySession = { ...session, createdAt: Date.now() }
  try {
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(memorySession))
  } catch {
    // The in-memory session keeps SPA navigation usable when sessionStorage is blocked.
  }
}

export function loadDiscoverySession(): DiscoverySession | null {
  try {
    const stored = window.sessionStorage.getItem(SESSION_KEY)
    if (stored === null) return memorySession
    const parsed: unknown = JSON.parse(stored)
    if (!isRecord(parsed) || !isRecord(parsed.context) || !hasOnlyKeys(parsed.context, ['questionnaireVersion', 'answers']) ||
        !isRecord(parsed.seed) || !Array.isArray(parsed.context.answers)) return null
    const seed = parseSeed(parsed.seed)
    const context = parsed.context as unknown as DiscoveryContext
    if ((context.questionnaireVersion !== 'onboarding-v1' && context.questionnaireVersion !== 'onboarding-v2') ||
        !context.answers.every((answer) => isRecord(answer) && hasOnlyKeys(answer, ['questionId', 'selectedOptionIds']) &&
          nonEmptyString(answer.questionId) && Array.isArray(answer.selectedOptionIds) &&
          answer.selectedOptionIds.every(nonEmptyString))) return null
    const createdAt = typeof parsed.createdAt === 'number' && Number.isFinite(parsed.createdAt) ? parsed.createdAt : Date.now()
    memorySession = { context, seed, createdAt }
    return memorySession
  } catch {
    return memorySession
  }
}

export function clearDiscoverySession(): void {
  memorySession = null
  try {
    window.sessionStorage.removeItem(SESSION_KEY)
  } catch {
    // Nothing else to clear.
  }
}
