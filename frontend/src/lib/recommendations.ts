import type { Book, OnboardingAnswers, Scores, Tier } from '../types/hoshirube'
import { GENRES, WORLDS } from '../data/worlds'
import { BOOKS } from '../data/books'

type Boost = Scores | 'all' | 'none'
const Q1_BOOST: Boost[] = [
  { mon: 2, tec: 2, art: 1 }, { phi: 2, sci: 1, his: 1 }, { lan: 1, sci: 1, art: 1, lit: 1 }, { soc: 2, his: 1, phi: 1 }, 'all',
]
const Q3_BOOST: Boost[] = [
  { phi: 1, soc: 1, art: 1 }, { sci: 1, his: 1, tec: 1 }, { phi: 2, soc: 1 }, { lit: 2, lan: 1, art: 1 }, 'none',
]

export const TIER_LABEL = ['まだ未知の領域', '少し気になる', '興味が強い'] as const
export const tierOf = (v: number): Tier => (v >= 3 ? 2 : v >= 1 ? 1 : 0)

export function calcScores(a: OnboardingAnswers): Scores {
  const s: Scores = Object.fromEntries(GENRES.map((g) => [g.id, 0]))
  const genreIds = new Set(GENRES.map((g) => g.id))
  const add = (m: Boost) => {
    if (m === 'all') GENRES.forEach((g) => (s[g.id] += 0.5))
    else if (m !== 'none') Object.entries(m).forEach(([k, v]) => (s[k] += v))
  }
  const validQ1 = Number.isInteger(a.q1) && a.q1 !== null && a.q1 >= 0 && a.q1 < Q1_BOOST.length
  const validQ3 = Number.isInteger(a.q3) && a.q3 !== null && a.q3 >= 0 && a.q3 < Q3_BOOST.length
  if (validQ1) add(Q1_BOOST[a.q1!])
  if (validQ3) add(Q3_BOOST[a.q3!])

  if (a.omakase) {
    GENRES.forEach((g) => (s[g.id] += 1))
  } else {
    a.q2.forEach((k) => { if (genreIds.has(k)) s[k] += 3 })
    if (a.q1 === 4 && a.q4Topic && a.q4Topic !== 'skip' && a.q2.includes(a.q4Topic) && genreIds.has(a.q4Topic)) {
      s[a.q4Topic] += 2
    }
  }
  return s
}

/** 全ワールドの明るさ。中ジャンルは親と同じ */
export function tiersFor(scores: Scores): Record<string, Tier> {
  const t: Record<string, Tier> = {}
  GENRES.forEach((g) => (t[g.id] = tierOf(scores[g.id] ?? 0)))
  WORLDS.filter((w) => w.parentId).forEach((w) => (t[w.id] = t[w.parentId!]))
  return t
}

export function initialWorldId(s: Scores, novelty: number | null): string {
  const ranked = Object.entries(s).sort((a, b) => b[1] - a[1])
  const index = novelty === 2 ? ranked.length - 1 : novelty === 1 ? Math.min(1, ranked.length - 1) : 0
  return ranked[index]?.[0] ?? GENRES[0].id
}

export const booksForWorld = (id: string): Book[] => {
  const ids = [id, ...WORLDS.filter((w) => w.parentId === id).map((w) => w.id)]
  return BOOKS.filter((b) => b.worldIds.some((worldId) => ids.includes(worldId)))
}

/** オンボーディング結果をURLで /universe に渡す */
export function encodeAnswers(a: OnboardingAnswers): string {
  const p = new URLSearchParams()
  const genreIds = new Set(GENRES.map((g) => g.id))
  if (a.q1 !== null) p.set('q1', String(a.q1))
  if (a.q3 !== null) p.set('q3', String(a.q3))
  if (a.omakase) {
    p.set('om', '1')
    if (a.q4Novelty !== null && Number.isInteger(a.q4Novelty) && a.q4Novelty >= 0 && a.q4Novelty <= 2) {
      p.set('q4n', String(a.q4Novelty))
    }
  } else {
    p.set('q2', a.q2.join(','))
    if (a.q1 === 4 && a.q4Topic && a.q4Topic !== 'skip' && genreIds.has(a.q4Topic) && a.q2.includes(a.q4Topic)) {
      p.set('q4t', a.q4Topic)
    }
  }
  return p.toString()
}
export function decodeAnswers(qs: string): OnboardingAnswers {
  const p = new URLSearchParams(qs)
  const choice = (key: string, count: number) => {
    const raw = p.get(key)
    if (raw === null || !/^\d+$/.test(raw)) return null
    const value = Number(raw)
    return Number.isInteger(value) && value < count ? value : null
  }
  const genreIds = new Set(GENRES.map((g) => g.id))
  const q2 = [...new Set((p.get('q2') ?? '').split(',').filter((id) => genreIds.has(id)))]
  const omakase = p.get('om') === '1'
  const topic = p.get('q4t')
  const q1 = choice('q1', Q1_BOOST.length)
  const q4Topic = q1 === 4 && !omakase && topic && genreIds.has(topic) && q2.includes(topic) ? topic : null
  return {
    q1,
    q3: choice('q3', Q3_BOOST.length),
    omakase,
    q2,
    q4Topic,
    q4Novelty: omakase ? choice('q4n', 3) : null,
  }
}

/* ---------- 読書履歴 ---------- */
export type ReadEntry = { bookId: string; readAt: number }

const READ_POINT = 2   // 1冊読んだときの加点（初期値1.5 + 2 = 3.5 → tier 2）
const DECAY = 0.6      // 1冊古くなるごとの重み。1にすると減衰なし（過去の星も光り続ける）

const WORLD_BY_ID = new Map(WORLDS.map((w) => [w.id, w]))
export const genreOfWorld = (id: string): string => WORLD_BY_ID.get(id)?.parentId ?? id
const genresOfBook = (b: Book): string[] => [...new Set(b.worldIds.map(genreOfWorld))]
const bookById = new Map(BOOKS.map((b) => [b.id, b]))

/** 履歴を古い順に並べ、新しい読書ほど強く効かせてスコアに加算 */
export function applyReadHistory(base: Scores, history: ReadEntry[]): Scores {
  const scores: Scores = { ...base }
  const readIds = new Set<string>()

  for (const entry of history) {
    if (readIds.has(entry.bookId)) continue
    readIds.add(entry.bookId)

    const book = bookById.get(entry.bookId)
    if (!book) continue

    const genres = genresOfBook(book)

    for (const genre of genres) {
      if (genre in scores) {
        scores[genre] += READ_POINT / genres.length
      }
    }
  }

  return scores
}

/** 直近に読んだ本のジャンル（推薦の軸と「ピカッ」演出に使う） */
export function lastReadGenres(history: ReadEntry[]): string[] {
  const last = [...history].sort((a, b) => b.readAt - a.readAt)[0]
  const book = last && bookById.get(last.bookId)
  return book ? genresOfBook(book) : []
}

/** 読んだ直後は、そのジャンルの本を最優先で推薦 */
export function recommendBooks(
  history: ReadEntry[],
  scores: Scores,
  limit = 5,
  pool: Book[] = BOOKS,            // 将来Google Books等の結果をここに渡す
): Book[] {
  const read = new Set(history.map((h) => h.bookId))
  const focus = new Set(lastReadGenres(history))
  const lastWorlds = new Set(
    (bookById.get([...history].sort((a, b) => b.readAt - a.readAt)[0]?.bookId ?? '')?.worldIds) ?? [],
  )
  return pool
    .filter((b) => !read.has(b.id))
    .map((b) => {
      const gs = genresOfBook(b)
      const base = Math.max(...gs.map((g) => scores[g] ?? 0))
      const focusBonus = gs.some((g) => focus.has(g)) ? 3 : 0
      const sameWorldBonus = b.worldIds.some((w) => lastWorlds.has(w)) ? 1.5 : 0
      return { b, score: base + focusBonus + sameWorldBonus }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.b)
}

/** tier（3段階）とは別に、WebGLに渡す連続値の明るさ 0〜1 */
export function glowsFor(scores: Scores): Record<string, number> {
  const g: Record<string, number> = {}
  GENRES.forEach((x) => (g[x.id] = Math.min(1, Math.max(0, (scores[x.id] ?? 0) / 5)) ** 1.5))
  WORLDS.filter((w) => w.parentId).forEach((w) => (g[w.id] = g[w.parentId!]))
  return g
}

/** URL用（既存の encode/decode と同じく、存在するIDだけ通す） */
export const encodeHistory = (h: ReadEntry[]) => h.map((x) => x.bookId).join(',')
export function decodeHistory(raw: string | null): ReadEntry[] {
  const now = Date.now()
  return (raw ?? '').split(',').filter((id) => bookById.has(id)).map((bookId, i) => ({ bookId, readAt: now + i }))
}

export function recommendNextInWorld(worldId: string, history: ReadEntry[], limit = 1): Book[] {
  const readIds = new Set(history.map((h) => h.bookId))
  return booksForWorld(worldId).filter((b) => !readIds.has(b.id)).slice(0, limit)
}

export function recommendOtherWorld(
  currentWorldId: string,
  history: ReadEntry[],
): { worldId: string; book: Book } | null {
  const readIds = new Set(history.map((h) => h.bookId))
  const current = WORLDS.find((w) => w.id === currentWorldId)
  const currentRootId = current?.parentId ?? currentWorldId

  for (const genre of GENRES) {
    if (genre.id === currentRootId) continue

    const book = booksForWorld(genre.id).find(
      (b) => !readIds.has(b.id),
    )

    if (book) {
      return { worldId: genre.id, book }
    }
  }

  return null
}