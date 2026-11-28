'use client'

import { useState } from 'react'
import Link from 'next/link'
import AppHeader from '../../components/common/AppHeader'
import BookCover from '../../components/common/BookCover'
import useLibrary from '../../lib/useLibrary'

type LibraryFilter = 'all' | 'to_read' | 'read'


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
          <h1 id="library-title" className="library-title">本棚</h1>
          <p className="library-description">気になった本を、読んだ記録と一緒に残しておこう。</p>

          <div className="library-filters" role="group" aria-label="本の表示を絞り込む">
            <button type="button" className={filter === 'all' ? 'is-active' : ''} aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
              すべて <span className="library-filter__count">{ready ? savedBooks.length : '—'}</span>
            </button>
            <button type="button" className={filter === 'to_read' ? 'is-active' : ''} aria-pressed={filter === 'to_read'} onClick={() => setFilter('to_read')}>
              これから読む <span className="library-filter__count">{ready ? toReadCount : '—'}</span>
            </button>
            <button type="button" className={filter === 'read' ? 'is-active' : ''} aria-pressed={filter === 'read'} onClick={() => setFilter('read')}>
              読了 <span className="library-filter__count">{ready ? readCount : '—'}</span>
            </button>
          </div>

          {!ready ? (
            <div className="library-empty library-empty--compact" role="status" aria-live="polite">本棚を読み込んでいます…</div>
          ) : savedBooks.length === 0 ? (
            <div className="library-empty">
              <span className="library-empty__mark" aria-hidden="true">✦</span>
              <h2>まだ本がありません</h2>
              <p>星座図で気になる本を見つけたら、ここに追加できます。</p>
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
                <li className={`library-book${status === 'read' ? ' is-read' : ''}`} key={key}>
                  <div className="library-book__identity">
                    <BookCover book={book} size="library" />
                    <div className="library-book__meta">
                      <span className={`library-book__status${status === 'read' ? ' is-read' : ''}`}>
                        {status === 'read' ? '読了' : 'これから読む'}
                      </span>
                      <h2>{book.title}</h2>
                      <p>{book.authors.length ? book.authors.join('、') : '著者情報なし'}</p>
                    </div>
                  </div>
                  <div className="library-book__actions">
                    <button type="button" className="library-book__toggle" aria-label={status === 'read' ? `${book.title}の読了を取り消す` : `${book.title}を読了にする`}
                      onClick={() => setReadStatus(key, status === 'read' ? 'to_read' : 'read')}>
                      {status === 'read' ? '未読に戻す' : '読了にする'}
                    </button>
                    <button type="button" className="library-book__remove" onClick={() => remove(key)} title="本棚から削除" aria-label={`${book.title}を本棚から解除`}>
                      削除
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
