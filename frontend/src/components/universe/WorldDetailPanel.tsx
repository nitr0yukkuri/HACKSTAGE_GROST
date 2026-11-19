'use client'
import type { Book, Tier, World } from '../../types/hoshirube'
import { TIER_LABEL } from '../../lib/recommendations'
import BookCard from './BookCard'
import { WORLDS } from '../../data/worlds'

interface Props {
  world: World
  root: World
  kids: World[]
  tier: Tier
  books: Book[]
  recs: Book[]
  open: boolean
  readIds: Set<string>
  onPick: (id: string) => void
  onClose: () => void
  onExplore: () => void
  onRead: (bookId: string) => void
  lastReadId: string | null
  otherWorld: { worldId: string; book: Book } | null
}

export default function WorldDetailPanel({
  world,
  root,
  kids,
  tier,
  books,
  recs,
  otherWorld,
  open,
  readIds,
  lastReadId,
  onPick,
  onClose,
  onExplore,
  onRead,
}: Props) {
  const hasReadInWorld = books.some((b) => readIds.has(b.id))
  const recommendedIds = new Set(hasReadInWorld ? recs.map((b) => b.id) : [])
  const otherBooks = books.filter((b) => !recommendedIds.has(b.id))
  const renderBooks = (items: Book[]) => <ul>{items.map((b) => <BookCard key={b.id} book={b} read={readIds.has(b.id)} onRead={onRead} />)}</ul>

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
  <>
    {recs.length > 0 ? (
      <>
        <h4>✨ 次におすすめの本</h4>
        {renderBooks(recs)}
      </>
    ) : (
      <>
        <p>🎉 この星の本はすべて読了しました！</p>

        {otherWorld && (
          <section className="other-world">
            <h4>✨ こちらの世界もいかがですか？</h4>

            <ul>
              <BookCard
                book={otherWorld.book}
                onExplore={() => onPick(otherWorld.worldId)}
                exploreLabel={`${WORLDS.find((w) => w.id === otherWorld.worldId)?.name ?? 'この'}の星へ →`}
              />
            </ul>
          </section>
        )}
      </>
    )}
  </>
)}
      <button className="pill" onClick={onExplore}>この星を探索する →</button>
    </aside>
  )
}
