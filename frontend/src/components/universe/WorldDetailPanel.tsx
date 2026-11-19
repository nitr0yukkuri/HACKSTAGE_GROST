'use client'
import type { Book, Tier, World } from '../../types/hoshirube'
import { TIER_LABEL } from '../../lib/recommendations'
import BookCard from './BookCard'

interface Props {
  world: World
  tier: Tier
  books: Book[]
  recs: Book[]
  open: boolean
  readIds: Set<string>
  onClose: () => void
  onExplore: () => void
  onRead: (bookId: string) => void
}

export default function WorldDetailPanel({
  world,
  tier,
  books,
  recs,
  open,
  readIds,
  onClose,
  onExplore,
  onRead,
}: Props) {
  const hasReadInWorld = books.some((book) => readIds.has(book.id))
  const recommendedIds = new Set(hasReadInWorld ? recs.map((book) => book.id) : [])
  const otherBooks = books.filter((book) => !recommendedIds.has(book.id))
  const renderBooks = (items: Book[]) => (
    <ul>
      {items.map((book) => (
        <BookCard
          key={book.id}
          book={book}
          read={readIds.has(book.id)}
          onRead={onRead}
        />
      ))}
    </ul>
  )

  return (
    <aside className={`panel${open ? '' : ' off'}`}>
      <button className="x" aria-label="閉じる" onClick={onClose}>×</button>
      <div className="ph">
        <div>
          <h3>{world.name}</h3>
          <p>{world.description}</p>
          <span className={`tg t${tier}`}>{TIER_LABEL[tier]}</span>
        </div>
      </div>
      <h4>この星につながる本</h4>
      {renderBooks(otherBooks)}

      {hasReadInWorld && (
        recs.length > 0 ? (
          <>
            <h4>次の一冊</h4>
            {renderBooks(recs)}
          </>
        ) : (
          <span className="tg world-complete" role="status" aria-label="この星の本をすべて読了">完読</span>
        )
      )}

      <button className="pill" onClick={onExplore}>この星を探索する →</button>
    </aside>
  )
}
