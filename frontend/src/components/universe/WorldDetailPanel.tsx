'use client'

import type { Book, Tier, World } from '../../types/hoshirube'
import { TIER_LABEL } from '../../lib/recommendations'
import { libraryBookKey, type LibraryState } from '../../lib/library-store'
import type { BookWarning } from '../../lib/api/discovery'
import { WORLDS } from '../../data/worlds'
import BookCard from './BookCard'

interface Props {
  world: World
  root: World
  kids: World[]
  tier: Tier
  tierLabel?: string
  books: Book[]
  recs?: Book[]
  warnings: BookWarning[]
  loading: boolean
  error: string | null
  onRetry: () => void
  apiMode: boolean
  library: LibraryState
  open: boolean
  onToggleSave: (book: Book) => void
  onRead?: (book: Book) => void
  readIds?: ReadonlySet<string>
  otherWorld?: { worldId: string; book: Book } | null
  onPick: (id: string) => void
  onClose: () => void
  onExplore: () => void
}

export default function WorldDetailPanel({
  world,
  root,
  kids,
  tier,
  tierLabel,
  books,
  recs = [],
  warnings,
  loading,
  error,
  onRetry,
  apiMode,
  library,
  open,
  onToggleSave,
  onRead,
  readIds,
  otherWorld = null,
  onPick,
  onClose,
  onExplore,
}: Props) {
  const isRead = (book: Book) =>
    library[libraryBookKey(book)]?.status === 'read' ||
    (book.source === 'local_demo' && Boolean(readIds?.has(book.id)))

  const hasReadInWorld = books.some(isRead)
  const recommendedKeys = new Set(
    hasReadInWorld ? recs.map(libraryBookKey) : [],
  )
  const otherBooks = books.filter(
    (book) => !recommendedKeys.has(libraryBookKey(book)),
  )

  const renderBooks = (items: Book[]) => (
    <ul>
      {items.map((book) => {
        const key = libraryBookKey(book)
        return (
          <BookCard
            key={key}
            book={book}
            saved={Boolean(library[key])}
            onToggleSave={() => onToggleSave(book)}
            read={isRead(book)}
            onRead={onRead}
          />
        )
      })}
    </ul>
  )

  return (
    <aside className={`panel${open ? '' : ' off'}`}>
      <button type="button" className="x" aria-label="閉じる" onClick={onClose}>
        ×
      </button>

      <div className="ph">
        <div>
          <h3>{world.name}</h3>
          <p>{world.description}</p>
          <span className={`tg t${tier}`}>
            {tierLabel ?? TIER_LABEL[tier]}
          </span>
        </div>
      </div>

      <h4>この星につながる本</h4>

      {loading && (
        <p className="book-state" role="status" aria-live="polite">
          この星につながる本を探しています…
        </p>
      )}

      {error && (
        <div className="book-error" role="alert">
          <p>{error}</p>
          <button type="button" onClick={onRetry}>
            もう一度試す
          </button>
        </div>
      )}

      {warnings.length > 0 && (
        <ul className="book-warnings" aria-label="書籍取得時の注意">
          {warnings.map((warning, index) => (
            <li key={`${warning.code}-${index}`}>
              {warning.message}
            </li>
          ))}
        </ul>
      )}

      {!loading && !error && apiMode && books.length === 0 && (
        <p className="book-state">
          この星で見つかった本はありません。別の星も探してみましょう。
        </p>
      )}

      {!loading && renderBooks(otherBooks)}

      {!loading && !error && hasReadInWorld && (
        <>
          {recs.length > 0 ? (
            <>
              <h4>✨ 次におすすめの本</h4>
              {renderBooks(recs)}
            </>
          ) : !apiMode && (
            <>
              <p>🎉 この星の本はすべて読了しました！</p>
              {otherWorld && (
                <section className="other-world">
                  <h4>✨ こちらの世界もいかがですか？</h4>
                  <ul>
                    <BookCard
                      book={otherWorld.book}
                      saved={Boolean(
                        library[libraryBookKey(otherWorld.book)],
                      )}
                      onToggleSave={() => onToggleSave(otherWorld.book)}
                      read={isRead(otherWorld.book)}
                      onRead={onRead}
                      onExplore={() => onPick(otherWorld.worldId)}
                      exploreLabel={`${
                        WORLDS.find((w) => w.id === otherWorld.worldId)
                          ?.name ?? 'この'
                      }の星へ →`}
                    />
                  </ul>
                </section>
              )}
            </>
          )}
        </>
      )}

      {kids.length > 0 && (
        <>
          <h4>{root.name}の中ジャンル</h4>
          <div className="chips">
            {world.id !== root.id && (
              <button type="button" onClick={() => onPick(root.id)}>
                ← {root.name}
              </button>
            )}
            {kids.map((kid) => (
              <button
                type="button"
                key={kid.id}
                className={kid.id === world.id ? 'on' : ''}
                onClick={() => onPick(kid.id)}
              >
                {kid.name}
              </button>
            ))}
          </div>
        </>
      )}

      <button type="button" className="pill" onClick={onExplore}>
        この星を探索する →
      </button>
    </aside>
  )
}
