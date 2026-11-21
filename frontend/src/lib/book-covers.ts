import type { Book } from '../types/hoshirube'

const BOOK_COVER_HOSTS = new Set([
  'books.google.com',
  'books.google.co.jp',
  'books.googleusercontent.com',
  'www.shinchosha.co.jp',
  'b-bunshun.ismcdn.jp',
  'www.hayakawa-online.co.jp',
  'img.hanmoto.com',
  'dvs-cover.kodansha.co.jp',
  'www.oreilly.co.jp',
  'nhkbook.s3-ap-northeast-1.amazonaws.com',
  'www.kawade.co.jp',
])

const GOOGLE_BOOK_INFO_HOSTS = new Set(['books.google.com', 'books.google.co.jp'])

export function normalizeBookCoverUrl(value: string | null, source: Book['source']): string | null {
  if (value === null) return null
  if (source === 'local_demo' && /^\/(?![\\/])/.test(value)) return value

  try {
    const url = new URL(value)
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') ||
        !BOOK_COVER_HOSTS.has(url.hostname.toLowerCase()) ||
        url.username !== '' || url.password !== '' || url.port !== '') return null
    // Older Google Books responses can return HTTP thumbnails; HTTPS avoids mixed-content blocking.
    url.protocol = 'https:'
    return url.toString()
  } catch {
    return null
  }
}

export function googleBooksInfoUrl(book: Pick<Book, 'id' | 'source' | 'infoUrl'>): string | null {
  if (book.infoUrl) {
    try {
      const url = new URL(book.infoUrl)
      if (url.protocol === 'https:' && GOOGLE_BOOK_INFO_HOSTS.has(url.hostname.toLowerCase()) &&
          url.username === '' && url.password === '' && url.port === '') {
        return url.toString()
      }
    } catch {
      // Fall back to the volume ID when the optional link is malformed.
    }
  }

  if (book.source !== 'google_books') return null

  return `https://books.google.com/books?id=${encodeURIComponent(book.id)}`
}
