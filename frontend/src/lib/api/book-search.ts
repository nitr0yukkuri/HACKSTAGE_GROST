import type { Book } from '../../types/hoshirube'

export interface BookSearchResult {
  items: Book[]
  totalItems: number
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

function isBook(value: unknown): value is Book {
  return isRecord(value) && typeof value.id === 'string' && value.id.length > 0 &&
    value.source === 'google_books' && typeof value.title === 'string' && value.title.length > 0 &&
    Array.isArray(value.authors) && value.authors.every((author) => typeof author === 'string') &&
    (value.coverUrl === null || typeof value.coverUrl === 'string') &&
    (value.description === null || typeof value.description === 'string') &&
    (value.recommendationReason === null || typeof value.recommendationReason === 'string') &&
    (value.infoUrl === null || typeof value.infoUrl === 'string') &&
    Array.isArray(value.worldIds) && value.worldIds.every((id) => typeof id === 'string')
}

export async function searchGoogleBooks(query: string, signal?: AbortSignal): Promise<BookSearchResult> {
  let response: Response
  try {
    response = await fetch(`/api/books/search?q=${encodeURIComponent(query)}`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal,
    })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new Error('検索APIに接続できません。ネットワークを確認してください。')
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new Error('検索APIの応答を読み取れませんでした。')
  }

  if (!response.ok) {
    const message = isRecord(payload) && typeof payload.error === 'string'
      ? payload.error
      : '検索に失敗しました。時間をおいて再試行してください。'
    throw new Error(message)
  }
  if (!isRecord(payload) || !Array.isArray(payload.items) || typeof payload.totalItems !== 'number' ||
      !Number.isFinite(payload.totalItems) || !payload.items.every(isBook)) {
    throw new Error('検索APIが正しい形式の結果を返しませんでした。')
  }

  return { items: payload.items, totalItems: payload.totalItems }
}

