'use client'

import { useState } from 'react'
import type { CSSProperties } from 'react'
import Link from 'next/link'
import AppHeader from '../../components/common/AppHeader'
import useLibrary from '../../lib/useLibrary'
import type { Book } from '../../types/hoshirube'

type LibraryFilter = 'all' | 'to_read' | 'read'

function LibraryCover({ book }: { book: Book }) {
  const hue = (book.title.charCodeAt(0) * 37) % 360
  return book.coverUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img className="library-book__cover" src={book.coverUrl} alt="" />
  ) : (
    <span className="library-book__cover" style={{ '--cover-hue': hue } as CSSProperties} aria-hidden="true">
      {book.title.slice(0, 1)}
    </span>
  )
}

export default function LibraryClient() {
  const { entries, ready, setReadStatus, remove } = useLibrary()
  const [filter, setFilter] = useState<LibraryFilter>('all')

  const savedBooks = Object.entries(entries)
    .map(([key, entry]) => ({ key, ...entry }))
    .sort((a, b) => b.savedAt - a.savedAt)
  const readCount = savedBooks.filter((item) => item.status === 'read').length
  const toReadCount = savedBooks.length - readCount
  const visibleBooks = filter === 'all' ? savedBooks : savedBooks.filter((item) => item.status === filter)

  return (
    <section className="scr library-shell">
      <AppHeader active="library" />
      <main className="library-main">
        <section className="library-card" aria-labelledby="library-title">
          <p className="library-eyebrow">ライブラリ</p>
          <h1 id="library-title" className="library-title">本棚</h1>
          <p className="library-description">気になった本を、読んだ記録と一緒に残しておこう。</p>

          <div className="library-summary" role="group" aria-label="本棚の冊数">
            <span>保存した本 <strong>{ready ? savedBooks.length : '—'}</strong></span>
            <span>読了 <strong>{ready ? readCount : '—'}</strong></span>
          </div>

          <div className="library-filters" role="group" aria-label="本の表示を絞り込む">
            <button type="button" className={filter === 'all' ? 'is-active' : ''} aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
              すべて <span>{ready ? savedBooks.length : '—'}</span>
            </button>
            <button type="button" className={filter === 'to_read' ? 'is-active' : ''} aria-pressed={filter === 'to_read'} onClick={() => setFilter('to_read')}>
              これから読む <span>{ready ? toReadCount : '—'}</span>
            </button>
            <button type="button" className={filter === 'read' ? 'is-active' : ''} aria-pressed={filter === 'read'} onClick={() => setFilter('read')}>
              読了 <span>{ready ? readCount : '—'}</span>
            </button>
          </div>

          {!ready ? (
            <div className="library-empty library-empty--compact" role="status" aria-live="polite">本棚を読み込んでいます…</div>
          ) : savedBooks.length === 0 ? (
            <div className="library-empty">
              <span className="library-empty__mark" aria-hidden="true">✦</span>
              <h2>本棚はまだ空です</h2>
              <p>星座図で気になる本を見つけたら、ここに保存できます。</p>
              <Link href="/universe" className="library-empty__link">星座図から本を見つける</Link>
            </div>
          ) : visibleBooks.length === 0 ? (
            <div className="library-empty library-empty--compact" role="status">
              <h2>この状態の本はありません</h2>
              <p>別の絞り込みを選ぶか、すべての本を表示してください。</p>
              <button type="button" className="library-empty__link" onClick={() => setFilter('all')}>すべての本を表示</button>
            </div>
          ) : (
            <ul className="library-list" aria-label="保存した本">
              {visibleBooks.map(({ key, book, status }) => (
                <li className="library-book" key={key}>
                  <div className="library-book__identity">
                    <LibraryCover book={book} />
                    <div className="library-book__meta">
                      <h2>{book.title}</h2>
                      <p>{book.authors.length ? book.authors.join('、') : '著者情報なし'}</p>
                    </div>
                  </div>
                  <span className={`library-book__status${status === 'read' ? ' is-read' : ''}`}>
                    {status === 'read' ? '読了' : 'これから読む'}
                  </span>
                  <div className="library-book__actions">
                    <button type="button" aria-label={status === 'read' ? `${book.title}の読了を取り消す` : `${book.title}を読了にする`}
                      onClick={() => setReadStatus(key, status === 'read' ? 'to_read' : 'read')}>
                      {status === 'read' ? '読了を取り消す' : '読了にする'}
                    </button>
                    <span aria-hidden="true" />
                    <button type="button" onClick={() => remove(key)} aria-label={`${book.title}を本棚から解除`}>
                      保存を解除
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </section>
  )
}
