import type { Book } from '../../types/hoshirube'
import { WORLDS } from '../../data/worlds'
import { normalizeBookCoverUrl } from '../book-covers'
import { DiscoveryApiError, requestJson } from './discovery'

export interface BookSearchResult {
  items: Book[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const nonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

const WORLD_IDS = new Set(WORLDS.map((world) => world.id))

function isBook(value: unknown): value is Book {
  return isRecord(value) && nonEmptyString(value.id) && value.source === 'google_books' &&
    nonEmptyString(value.title) && Array.isArray(value.authors) && value.authors.every(nonEmptyString) &&
    (value.coverUrl === null || typeof value.coverUrl === 'string') &&
    (value.description === null || (nonEmptyString(value.description) && Array.from(value.description).length <= 1000)) &&
    value.recommendationReason === null &&
    (value.infoUrl === null || (typeof value.infoUrl === 'string' && /^https:\/\/books\.google\.(com|co\.jp)\//.test(value.infoUrl))) &&
    Array.isArray(value.worldIds) && value.worldIds.length <= 1 && value.worldIds.every((id) => typeof id === 'string' && WORLD_IDS.has(id)) &&
    Object.keys(value).every((key) => [
      'id', 'source', 'title', 'authors', 'coverUrl', 'description',
      'recommendationReason', 'infoUrl', 'worldIds',
    ].includes(key))
}

export async function searchGoogleBooks(query: string, signal?: AbortSignal): Promise<BookSearchResult> {
  const params = new URLSearchParams({ q: query })
  const payload = await requestJson(`/v1/books/search?${params}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  }, signal)

  if (!isRecord(payload) || !Object.keys(payload).every((key) => key === 'requestId' || key === 'items') ||
      !nonEmptyString(payload.requestId) || !Array.isArray(payload.items) ||
      payload.items.length > 12 || !payload.items.every(isBook)) {
    throw new DiscoveryApiError('本の検索APIが契約と異なる応答を返しました。', 502, 'INVALID_API_RESPONSE')
  }
  const ids = payload.items.map((item) => item.id)
  if (new Set(ids).size !== ids.length) {
    throw new DiscoveryApiError('本の検索APIが重複した本を返しました。', 502, 'INVALID_API_RESPONSE')
  }

  return {
    items: payload.items.map((book) => ({
      ...book,
      coverUrl: normalizeBookCoverUrl(book.coverUrl, book.source),
    })),
  }
}
