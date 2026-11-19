import type { CSSProperties } from 'react'
import type { Book } from '../../types/hoshirube'

export default function BookCard({ book, saved, onToggleSave }: { book: Book; saved: boolean; onToggleSave: () => void }) {
  const hue = (book.title.charCodeAt(0) * 37) % 360
  return (
    <li className="panel-book-item">
      {book.coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={book.coverUrl} alt="" width={42} height={58} style={{ flex: 'none', borderRadius: 4 }} />
      ) : (
        <i style={{ '--h': hue } as CSSProperties}>{book.title[0]}</i>
      )}
      <div className="panel-book-content">
        <div className="panel-book-meta">
          <b>{book.title}</b>
          <small>{book.authors.length ? book.authors.join('、') : '著者情報なし'}</small>
          <em>{book.recommendationReason ?? 'おすすめ理由はありません'}</em>
          {book.description && (
            <details className="book-description"><summary>内容紹介</summary><p>{book.description}</p></details>
          )}
          {book.infoUrl && <a className="book-info-link" href={book.infoUrl} target="_blank" rel="noopener noreferrer">Google Booksで詳しく見る</a>}
        </div>
        <button type="button" className={`book-save${saved ? ' is-saved' : ''}`} aria-pressed={saved}
          aria-label={saved ? `${book.title}の保存を解除` : `${book.title}を本棚に保存`} onClick={onToggleSave}>
          {saved ? '保存済み' : '本棚に保存'}
        </button>
      </div>
    </li>
  )
}
