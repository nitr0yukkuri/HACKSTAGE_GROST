import type { Book } from '../../types/hoshirube'
import BookCover from '../common/BookCover'

interface Props {
  book: Book
  read?: boolean
  onRead?: (book: Book) => void
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
  return (
    <li className="panel-book-item">
      <BookCover book={book} size="discovery" />

      <div className="panel-book-content">
        <div className="panel-book-meta">
          <b>{book.title}</b>
          <small>
            {book.authors.length
              ? book.authors.join('、')
              : '著者情報なし'}
          </small>

          <em>
            {book.recommendationReason ??
              'おすすめ理由はありません'}
          </em>

          {book.description && (
            <details className="book-description">
              <summary>内容紹介</summary>
              <p>{book.description}</p>
            </details>
          )}

          {book.infoUrl && (
            <a
              className="book-info-link"
              href={book.infoUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Google Booksで詳しく見る
            </a>
          )}

          <div className="book-actions">
            {onRead && (
              <button
                type="button"
                className={`read${read ? ' is-read' : ''}`}
                disabled={read}
                aria-label={
                  read
                    ? `${book.title}は読了済み`
                    : `${book.title}を読了にする`
                }
                onClick={() => onRead(book)}
              >
                完読
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
          </div>
        </div>
      </div>

    </li>
  )
}
