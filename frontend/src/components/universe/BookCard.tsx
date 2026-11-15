import type { CSSProperties } from 'react'
import type { Book } from '../../types/hoshirube'

export default function BookCard({ book }: { book: Book }) {
  const hue = (book.title.charCodeAt(0) * 37) % 360
  return (
    <li>
      {book.coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={book.coverUrl} alt="" width={42} height={58} style={{ flex: 'none', borderRadius: 4 }} />
      ) : (
        <i style={{ '--h': hue } as CSSProperties}>{book.title[0]}</i>
      )}
      <div><b>{book.title}</b><small>{book.author}</small><em>{book.description}</em></div>
    </li>
  )
}
