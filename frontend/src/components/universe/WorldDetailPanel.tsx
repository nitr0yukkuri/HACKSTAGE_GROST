'use client'
import type { Book, Tier, World } from '../../types/hoshirube'
import { TIER_LABEL } from '../../lib/recommendations'
import BookCard from './BookCard'

interface Props {
  world: World
  root: World
  kids: World[]
  tier: Tier
  books: Book[]
  open: boolean
  onPick: (id: string) => void
  onClose: () => void
  onExplore: () => void
}

export default function WorldDetailPanel({ world, root, kids, tier, books, open, onPick, onClose, onExplore }: Props) {
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
      <ul>{books.map((b) => <BookCard key={b.id} book={b} />)}</ul>
      {kids.length > 0 && (
        <>
          <h4>{root.name}の中ジャンル</h4>
          <div className="chips">
            {world.id !== root.id && <button onClick={() => onPick(root.id)}>← {root.name}</button>}
            {kids.map((k) => <button key={k.id} className={k.id === world.id ? 'on' : ''} onClick={() => onPick(k.id)}>{k.name}</button>)}
          </div>
        </>
      )}
      <button className="pill" onClick={onExplore}>この星を探索する →</button>
    </aside>
  )
}
