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
  const add = (m: Boost) =>
    m === 'all' ? GENRES.forEach((g) => (s[g.id] += 0.5)) : Object.entries(m).forEach(([k, v]) => (s[k] += v))
  if (a.q1 !== null) add(Q1_BOOST[a.q1])
  if (a.q3 !== null) add(Q3_BOOST[a.q3])
  if (a.omakase) GENRES.forEach((g) => (s[g.id] += 1))
  else a.q2.forEach((k) => (s[k] += 3))
  return s
}

/** 全ワールドの明るさ。中ジャンルは親と同じ */
export function tiersFor(scores: Scores): Record<string, Tier> {
  const t: Record<string, Tier> = {}
  GENRES.forEach((g) => (t[g.id] = tierOf(scores[g.id] ?? 0)))
  WORLDS.filter((w) => w.parentId).forEach((w) => (t[w.id] = t[w.parentId!]))
  return t
}

export const topWorldId = (s: Scores) => Object.entries(s).sort((a, b) => b[1] - a[1])[0][0]
export const booksForWorld = (id: string): Book[] => BOOKS.filter((b) => b.worldIds.includes(id))

/** オンボーディング結果をURLで /universe に渡す */
export function encodeAnswers(a: OnboardingAnswers): string {
  const p = new URLSearchParams()
  if (a.q1 !== null) p.set('q1', String(a.q1))
  if (a.q3 !== null) p.set('q3', String(a.q3))
  if (a.omakase) p.set('om', '1')
  else p.set('q2', a.q2.join(','))
  return p.toString()
}
export function decodeAnswers(qs: string): OnboardingAnswers {
  const p = new URLSearchParams(qs)
  const n = (k: string) => (p.get(k) === null ? null : Number(p.get(k)))
  return { q1: n('q1'), q3: n('q3'), omakase: p.get('om') === '1', q2: (p.get('q2') ?? '').split(',').filter(Boolean) }
}
