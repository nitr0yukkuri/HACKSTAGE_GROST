import type { CSSProperties } from 'react'
import type { Book } from '../../types/hoshirube'

interface Props {
  book: Book
  read?: boolean
  onRead?: (bookId: string) => void
  onExplore?: () => void
  exploreLabel?: string
}

export default function BookCard({
  book,
  read = false,
  onRead,
  onExplore,
  exploreLabel,
}: Props) {
  const hue = (book.title.charCodeAt(0) * 37) % 360

  return (
    <li className="book-row">
      {book.coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={book.coverUrl}
          alt=""
          width={42}
          height={58}
        />
      ) : (
        <i style={{ '--h': hue } as CSSProperties}>
          {book.title[0]}
        </i>
      )}

      <div className="book-text">
        <b>{book.title}</b>
        <small>{book.author}</small>
        <em>{book.description}</em>
      </div>

      {onRead && (
        <button
          type="button"
          className="read"
          disabled={read}
          onClick={() => onRead(book.id)}
        >
          {read ? '読了' : '読了にする'}
        </button>
      )}

      {onExplore && (
        <button
          type="button"
          className="explore-book"
          onClick={onExplore}
        >
          {exploreLabel ?? 'この星へ →'}
        </button>
      )}
    </li>
  )
}