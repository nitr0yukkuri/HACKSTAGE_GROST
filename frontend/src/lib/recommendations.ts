import type { Book, OnboardingAnswers, Scores, Tier } from '../types/hoshirube'
import { GENRES, WORLDS } from '../data/worlds'
import { BOOKS } from '../data/books'

type Boost = Scores | 'all'
const Q1_BOOST: Boost[] = [
  { mon: 2, tec: 2, art: 1 }, { phi: 2, sci: 1, his: 1 }, { lan: 1, sci: 1, art: 1, lit: 1 }, { soc: 2, his: 1, phi: 1 }, 'all',
]
const Q3_BOOST: Boost[] = [
  { phi: 1, soc: 1, art: 1 }, { sci: 1, his: 1, tec: 1 }, { phi: 2, soc: 1 }, { lit: 2, lan: 1, art: 1 },
]

export const TIER_LABEL = ['まだ未知の領域', '少し気になる', '興味が強い'] as const
export const tierOf = (v: number): Tier => (v >= 3 ? 2 : v >= 1 ? 1 : 0)

export function calcScores(a: OnboardingAnswers): Scores {
  const s: Scores = Object.fromEntries(GENRES.map((g) => [g.id, 0]))
  const genreIds = new Set(GENRES.map((g) => g.id))
  const add = (m: Boost) =>
    m === 'all' ? GENRES.forEach((g) => (s[g.id] += 0.5)) : Object.entries(m).forEach(([k, v]) => (s[k] += v))
  const validQ1 = Number.isInteger(a.q1) && a.q1 !== null && a.q1 >= 0 && a.q1 < Q1_BOOST.length
  const validQ3 = Number.isInteger(a.q3) && a.q3 !== null && a.q3 >= 0 && a.q3 < Q3_BOOST.length
  if (validQ1) add(Q1_BOOST[a.q1!])
  if (validQ3) add(Q3_BOOST[a.q3!])

  if (a.omakase) {
    GENRES.forEach((g) => (s[g.id] += 1))
  } else {
    a.q2.forEach((k) => { if (genreIds.has(k)) s[k] += 3 })
    if (a.q4Topic && a.q4Topic !== 'skip' && a.q2.includes(a.q4Topic) && genreIds.has(a.q4Topic)) {
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
export const booksForWorld = (id: string): Book[] => BOOKS.filter((b) => b.worldIds.includes(id))

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
    if (a.q4Topic && a.q4Topic !== 'skip' && genreIds.has(a.q4Topic) && a.q2.includes(a.q4Topic)) {
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
  const q4Topic = !omakase && topic && genreIds.has(topic) && q2.includes(topic) ? topic : null
  return {
    q1: choice('q1', Q1_BOOST.length),
    q3: choice('q3', Q3_BOOST.length),
    omakase,
    q2,
    q4Topic,
    q4Novelty: omakase ? choice('q4n', 3) : null,
  }
}
