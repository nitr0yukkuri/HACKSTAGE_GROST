'use client'
import type { Book, Tier, World } from '../../types/hoshirube'
import { TIER_LABEL } from '../../lib/recommendations'
import { libraryBookKey, type LibraryState } from '../../lib/library-store'
import type { BookWarning } from '../../lib/api/discovery'
import BookCard from './BookCard'

interface Props {
  world: World
  root: World
  kids: World[]
  tier: Tier
  tierLabel?: string
  books: Book[]
  warnings: BookWarning[]
  loading: boolean
  error: string | null
  onRetry: () => void
  apiMode: boolean
  library: LibraryState
  open: boolean
  onToggleSave: (book: Book) => void
  onPick: (id: string) => void
  onClose: () => void
  onExplore: () => void
}

export default function WorldDetailPanel({ world, root, kids, tier, tierLabel, books, warnings, loading, error, onRetry, apiMode, library, open, onToggleSave, onPick, onClose, onExplore }: Props) {
  return (
    <aside className={`panel${open ? '' : ' off'}`}>
      <button className="x" aria-label="閉じる" onClick={onClose}>×</button>
      <div className="ph">
        <div>
          <h3>{world.name}</h3>
          <p>{world.description}</p>
          <span className={`tg t${tier}`}>{tierLabel ?? TIER_LABEL[tier]}</span>
        </div>
      </div>
      <h4>この星につながる本</h4>
      {loading && <p className="book-state" role="status" aria-live="polite">この星につながる本を探しています…</p>}
      {error && <div className="book-error" role="alert"><p>{error}</p><button type="button" onClick={onRetry}>もう一度試す</button></div>}
      {warnings.length > 0 && <ul className="book-warnings" aria-label="書籍取得時の注意">{warnings.map((warning, index) => <li key={`${warning.code}-${index}`}>{warning.message}</li>)}</ul>}
      {!loading && !error && apiMode && books.length === 0 && <p className="book-state">この星で見つかった本はありません。別の星も探してみましょう。</p>}
      {!loading && <ul>{books.map((book) => {
        const key = libraryBookKey(book)
        return <BookCard key={key} book={book} saved={Boolean(library[key])} onToggleSave={() => onToggleSave(book)} />
      })}</ul>}
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
