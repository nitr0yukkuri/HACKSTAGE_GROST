const GOOGLE_BOOKS_ENDPOINT = 'https://www.googleapis.com/books/v1/volumes'
const REQUEST_TIMEOUT_MS = 8_000
const MAX_RESULTS = 12
const COVER_HOSTS = new Set(['books.google.com', 'books.google.co.jp', 'books.googleusercontent.com'])

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function safeCoverUrl(value: unknown): string | null {
  const raw = stringValue(value)
  if (!raw) return null

  try {
    const url = new URL(raw)
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') ||
        !COVER_HOSTS.has(url.hostname.toLowerCase()) || url.username || url.password || url.port) return null
    url.protocol = 'https:'
    return url.toString()
  } catch {
    return null
  }
}

function themeIdsForCategories(categories: string[]): string[] {
  const joined = categories.join(' ').toLocaleLowerCase()
  const rules: Array<[RegExp, string]> = [
    [/philosophy|religion|哲学|宗教/u, 'phi'],
    [/history|biography|geography|歴史|伝記|地理/u, 'his'],
    [/computer|programming|software|internet|technology|コンピュータ|プログラミング|ソフトウェア|技術/u, 'tec'],
    [/design|architecture|engineering|デザイン|建築|工学/u, 'mon'],
    [/\b(art|arts|music|photography|painting)\b|美術|芸術|音楽|写真/u, 'art'],
    [/language|linguistics|language arts|言語|言語学/u, 'lan'],
    [/fiction|literature|poetry|drama|comics|小説|文学|詩|演劇|漫画/u, 'lit'],
    [/social science|sociology|politics|economics|education|社会|政治|経済|教育/u, 'soc'],
    [/science|physics|astronomy|mathematics|biology|chemistry|科学|物理|天文|数学|生物|化学/u, 'sci'],
  ]

  const match = rules.find(([pattern]) => pattern.test(joined))
  return match ? [match[1]] : []
}

function toBook(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null
  const id = stringValue(value.id)
  const volumeInfo = isRecord(value.volumeInfo) ? value.volumeInfo : null
  const title = stringValue(volumeInfo?.title)
  if (!id || !title || !volumeInfo) return null

  const authors = Array.isArray(volumeInfo.authors)
    ? volumeInfo.authors.filter((author): author is string => typeof author === 'string' && author.trim().length > 0).slice(0, 8)
    : []
  const imageLinks = isRecord(volumeInfo.imageLinks) ? volumeInfo.imageLinks : null
  const description = stringValue(volumeInfo.description)?.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').slice(0, 1_000) ?? null
  const categories = Array.isArray(volumeInfo.categories)
    ? volumeInfo.categories.filter((category): category is string => typeof category === 'string')
    : []

  return {
    id,
    source: 'google_books',
    title,
    authors,
    coverUrl: safeCoverUrl(imageLinks?.thumbnail ?? imageLinks?.smallThumbnail),
    description,
    recommendationReason: null,
    infoUrl: `https://books.google.com/books?id=${encodeURIComponent(id)}`,
    worldIds: themeIdsForCategories(categories),
  }
}

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } })
}

export async function GET(request: Request): Promise<Response> {
  const query = new URL(request.url).searchParams.get('q')?.trim() ?? ''
  if (!query || Array.from(query).length > 128) {
    return jsonError('1〜128文字で検索してください。', 400)
  }

  const url = new URL(GOOGLE_BOOKS_ENDPOINT)
  url.searchParams.set('q', query)
  url.searchParams.set('maxResults', String(MAX_RESULTS))
  url.searchParams.set('printType', 'books')
  url.searchParams.set('orderBy', 'relevance')
  const apiKey = process.env.GOOGLE_BOOKS_API_KEY?.trim()
  if (!apiKey) {
    return jsonError('Google Books APIキーが設定されていません。サーバー側に GOOGLE_BOOKS_API_KEY を設定してください。', 503)
  }
  url.searchParams.set('key', apiKey)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(url, { cache: 'no-store', signal: controller.signal })
    if (!response.ok) {
      if (response.status === 429) return jsonError('検索が混み合っています。少し待ってからもう一度お試しください。', 429)
      return jsonError('Google Booksから検索結果を取得できませんでした。時間をおいて再試行してください。', 502)
    }

    const payload: unknown = await response.json()
    if (!isRecord(payload)) return jsonError('Google Booksの応答を読み取れませんでした。', 502)
    const rawItems = Array.isArray(payload.items) ? payload.items : []
    const seen = new Set<string>()
    const items = rawItems.flatMap((raw) => {
      const book = toBook(raw)
      if (!book || typeof book.id !== 'string' || seen.has(book.id)) return []
      seen.add(book.id)
      return [book]
    })
    const totalItems = typeof payload.totalItems === 'number' && Number.isFinite(payload.totalItems)
      ? Math.max(0, Math.floor(payload.totalItems))
      : items.length

    return Response.json({ items, totalItems }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    if (controller.signal.aborted) return jsonError('Google Booksの応答が遅れています。少し待ってから再試行してください。', 504)
    return jsonError('検索APIに接続できません。時間をおいて再試行してください。', 502)
  } finally {
    clearTimeout(timeout)
  }
}

