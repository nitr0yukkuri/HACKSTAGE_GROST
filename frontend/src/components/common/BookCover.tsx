'use client'

import { useState, type CSSProperties } from 'react'
import type { Book } from '../../types/hoshirube'
import { normalizeBookCoverUrl } from '../../lib/book-covers'

interface Props {
  book: Pick<Book, 'coverUrl' | 'source' | 'title'>
  size: 'discovery' | 'library'
}

export default function BookCover({ book, size }: Props) {
  const coverUrl = normalizeBookCoverUrl(book.coverUrl, book.source)
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const firstCharacter = Array.from(book.title.trim())[0] ?? '本'
  const hue = ((firstCharacter.codePointAt(0) ?? 0) * 37) % 360
  const style = { '--cover-hue': hue } as CSSProperties

  return (
    <span className={`book-cover book-cover--${size}`} style={style} aria-hidden="true">
      {coverUrl && failedUrl !== coverUrl ? (
        // Keep Google-hosted covers direct; the optimizer would fetch and transform third-party cover art.
        // eslint-disable-next-line @next/next/no-img-element
        <img className="book-cover__image" src={coverUrl} alt="" width={200} height={300}
          loading="lazy" decoding="async" referrerPolicy="no-referrer"
          onError={() => setFailedUrl(coverUrl)} />
      ) : (
        <span className="book-cover__placeholder">{firstCharacter}</span>
      )}
    </span>
  )
}
