'use client'

import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import AppHeader from '../../components/common/AppHeader'
import { WORLDS } from '../../data/worlds'
import { searchGoogleBooks } from '../../lib/api/book-search'
import { libraryBookKey } from '../../lib/library-store'
import useLibrary from '../../lib/useLibrary'
import type { Book } from '../../types/hoshirube'

const worldById = new Map(WORLDS.map((world) => [world.id, world]))

function ExploreBookCover({ book }: { book: Book }) {
  const [failed, setFailed] = useState(false)
  const initial = Array.from(book.title.trim())[0] ?? '本'
  const hue = ((initial.codePointAt(0) ?? 0) * 37) % 360
  const style = { '--cover-hue': hue } as CSSProperties

  return (
    <span className="explore-result__cover" style={style} aria-hidden="true">
      {book.coverUrl && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={book.coverUrl} alt="" width="104" height="156" loading="lazy" decoding="async"
          referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      ) : (
        <span>{initial}</span>
      )}
    </span>
  )
}

function normalize(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().trim()
}

function primaryWorldName(book: Book): string {
  for (const id of book.worldIds) {
    const world = worldById.get(id)
    if (!world) continue
    return world.parentId ? worldById.get(world.parentId)?.name ?? world.name : world.name
  }
  return ''
}

export default function ExploreClient() {
  const [query, setQuery] = useState('')
  const [submittedQuery, setSubmittedQuery] = useState('')
  const [books, setBooks] = useState<Book[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  const [searchError, setSearchError] = useState('')
  const requestController = useRef<AbortController | null>(null)
  const { entries, ready, save, setReadStatus } = useLibrary()
  const hasCurrentSearch = Boolean(submittedQuery) && normalize(query) === normalize(submittedQuery)

  useEffect(() => () => requestController.current?.abort(), [])

  const submitSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const searchTerm = query.trim()
    requestController.current?.abort()
    requestController.current = null
    setSubmittedQuery(searchTerm)
    setBooks([])
    setHasSearched(false)
    setSearchError('')

    if (!searchTerm) {
      setIsLoading(false)
      return
    }

    const controller = new AbortController()
    requestController.current = controller
    setIsLoading(true)
    try {
      const result = await searchGoogleBooks(searchTerm, controller.signal)
      if (controller.signal.aborted) return
      setBooks(result.items)
      setHasSearched(true)
    } catch (error) {
      if (!controller.signal.aborted) {
        setSearchError(error instanceof Error ? error.message : '本を検索できませんでした。')
      }
    } finally {
      if (requestController.current === controller) {
        requestController.current = null
        setIsLoading(false)
      }
    }
  }

  const updateQuery = (nextQuery: string) => {
    setQuery(nextQuery)
    if (requestController.current) {
      requestController.current.abort()
      requestController.current = null
      setIsLoading(false)
    }
  }

  const markAsRead = (book: Book) => {
    const key = libraryBookKey(book)
    if (entries[key]?.status === 'read') return
    save(book, book.worldIds[0] ?? 'unclassified')
    setReadStatus(key, 'read')
  }

  return (
    <section className="scr uni explore-screen">
      <AppHeader active="explore" showReset={false} />
      <main className="explore-main">
        <section className={`explore-content${hasCurrentSearch ? ' has-results' : ''}`} aria-labelledby="explore-title">
          <h1 id="explore-title" className="explore-title">{hasCurrentSearch ? '検索結果' : '本を探す'}</h1>
          <form className="explore-search" role="search" onSubmit={submitSearch}>
            <label className="explore-sr-only" htmlFor="book-search">タイトル・著者名で探す</label>
            <input
              id="book-search"
              type="search"
              value={query}
              onChange={(event) => updateQuery(event.currentTarget.value)}
              placeholder="タイトル・著者名で探す"
              autoComplete="off"
              enterKeyHint="search"
            />
            <button type="submit" aria-label="本を検索" disabled={isLoading}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="10.8" cy="10.8" r="6.8" />
                <path d="m16 16 5 5" />
              </svg>
            </button>
          </form>

          {hasCurrentSearch && isLoading && <p className="explore-status" role="status" aria-busy="true">Google Booksで検索中…</p>}
          {hasCurrentSearch && searchError && <p className="explore-empty explore-empty--error" role="alert">{searchError}</p>}
          {hasCurrentSearch && hasSearched && !searchError && books.length === 0 && (
            <p className="explore-empty" role="status">本が見つかりませんでした</p>
          )}

          {hasCurrentSearch && books.length > 0 && (
            <>
              <p className="explore-result-count" role="status">{books.length}件を表示</p>
              <ul className="explore-results" aria-label={`${submittedQuery}の検索結果`}>
                {books.map((book) => {
                  const key = libraryBookKey(book)
                  const read = entries[key]?.status === 'read'
                  const genre = primaryWorldName(book)
                  return (
                    <li className="explore-result" key={key}>
                      <ExploreBookCover book={book} />
                      <div className="explore-result__meta">
                        <h2>{book.title}</h2>
                        <p>{book.authors.length ? book.authors.join('、') : '著者情報なし'}</p>
                        <span>{genre || '星座未分類'}</span>
                      </div>
                      <button
                        className={`explore-result__action${read ? ' is-read' : ''}`}
                        type="button"
                        aria-pressed={read}
                        disabled={!ready || read}
                        onClick={() => markAsRead(book)}
                      >
                        {read ? '読了済み' : '読了にする'}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </section>
      </main>
    </section>
  )
}
