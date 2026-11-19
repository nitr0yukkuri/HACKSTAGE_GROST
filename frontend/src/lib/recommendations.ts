import type { Book, OnboardingAnswers, Scores, Tier } from '../types/hoshirube'
import { GENRES, WORLDS } from '../data/worlds'
import { BOOKS } from '../data/books'

type Boost = Partial<Scores> | 'all'

const INTEREST_BOOST: Record<NonNullable<OnboardingAnswers['interest']>, Boost> = {
  create: { mon: 2, tec: 2, art: 1 },
  think_deeply: { phi: 2, sci: 1, his: 1 },
  explore_unknown: { lan: 1, sci: 1, art: 1, lit: 1 },
  people_society: { soc: 2, his: 1, phi: 1 },
  none: 'all',
}
const READING_BOOST: Record<NonNullable<OnboardingAnswers['readingExperience']>, Boost> = {
  new_perspective: { phi: 1, soc: 1, art: 1 },
  learn_knowledge: { sci: 1, his: 1, tec: 1 },
  deepen_thought: { phi: 2, soc: 1 },
  immerse_story: { lit: 2, lan: 1, art: 1 },
}
// curiosityに対応する星がないため、API未接続のローカル推薦では近い大ジャンルへ配点する。
const CURIOSITY_BOOST: Record<OnboardingAnswers['curiosity'][number], Boost> = {
  music_emotions: { art: 2, soc: 1 },
  space_mysteries: { sci: 3 },
  city_origins: { his: 2, soc: 1 },
}

export const TIER_LABEL = ['まだ未知の領域', '少し気になる', '興味が強い'] as const
export const tierOf = (v: number): Tier => (v >= 3 ? 2 : v >= 1 ? 1 : 0)

export function calcScores(a: OnboardingAnswers): Scores {
  const s: Scores = Object.fromEntries(GENRES.map((g) => [g.id, 0]))
  const genreIds = new Set(GENRES.map((g) => g.id))
  const add = (m: Boost) => {
    if (m === 'all') GENRES.forEach((g) => (s[g.id] += 0.5))
    else Object.entries(m).forEach(([k, v]) => { if (genreIds.has(k) && typeof v === 'number') s[k] += v })
  }
  if (a.interest) add(INTEREST_BOOST[a.interest])
  if (a.readingExperience) add(READING_BOOST[a.readingExperience])
  a.curiosity.forEach((id) => add(CURIOSITY_BOOST[id]))

  if (a.themes.includes('omakase')) {
    GENRES.forEach((g) => (s[g.id] += 1))
  } else {
    a.themes.forEach((id) => { if (genreIds.has(id)) s[id] += 3 })
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

export function initialWorldId(s: Scores): string {
  const ranked = Object.entries(s).sort((a, b) => b[1] - a[1])
  return ranked[0]?.[0] ?? GENRES[0].id
}
export const booksForWorld = (id: string): Book[] => BOOKS.filter((b) => b.worldIds.includes(id))

export function emptyOnboardingAnswers(): OnboardingAnswers {
  return { interest: null, themes: [], curiosity: [], readingExperience: null }
}

/** 現在の質問票契約（onboarding-v2）と同じ形式でシリアライズする。 */
export function encodeAnswers(a: OnboardingAnswers): string {
  const answers: { questionId: string; selectedOptionIds: string[] }[] = []
  if (a.interest) answers.push({ questionId: 'interest', selectedOptionIds: [a.interest] })
  if (a.interest === 'none') answers.push({ questionId: 'curiosity', selectedOptionIds: a.curiosity })
  answers.push({ questionId: 'themes', selectedOptionIds: a.themes })
  if (a.readingExperience) {
    answers.push({ questionId: 'reading_experience', selectedOptionIds: [a.readingExperience] })
  }
  return JSON.stringify({ questionnaireVersion: 'onboarding-v2', answers })
}

const ANSWERS_STORAGE_KEY = 'hoshirube:onboarding-answers:v2'
let memoryAnswers: string | null = null

/** 回答はURLに含めず、同じタブ内だけで使う。sessionStorageが使えない場合はSPA遷移中だけメモリに保持する。 */
export function saveOnboardingAnswers(answers: OnboardingAnswers): void {
  const encoded = encodeAnswers(answers)
  memoryAnswers = encoded
  try {
    window.sessionStorage.setItem(ANSWERS_STORAGE_KEY, encoded)
  } catch {
    // メモリ上の値を使い、回答をURLへ出さない。
  }
}

export function loadOnboardingAnswers(): string {
  try {
    const stored = window.sessionStorage.getItem(ANSWERS_STORAGE_KEY)
    if (stored !== null) {
      memoryAnswers = stored
      return stored
    }
  } catch {
    // sessionStorageが使えない環境では、同じSPAセッションの値を使う。
  }
  return memoryAnswers ?? ''
}

export function decodeAnswers(raw: string): OnboardingAnswers {
  const empty = emptyOnboardingAnswers()
  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    return empty
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return empty

  const request = payload as Record<string, unknown>
  if (Object.keys(request).some((key) => key !== 'questionnaireVersion' && key !== 'answers')) return empty
  if (request.questionnaireVersion !== 'onboarding-v2' || !Array.isArray(request.answers)) return empty

  const byQuestion = new Map<string, string[]>()
  for (const answer of request.answers) {
    if (!answer || typeof answer !== 'object' || Array.isArray(answer)) return empty
    const item = answer as Record<string, unknown>
    if (Object.keys(item).some((key) => key !== 'questionId' && key !== 'selectedOptionIds')) return empty
    if (typeof item.questionId !== 'string' || byQuestion.has(item.questionId)) return empty
    if (!Array.isArray(item.selectedOptionIds) || !item.selectedOptionIds.every((id) => typeof id === 'string')) return empty
    byQuestion.set(item.questionId, item.selectedOptionIds)
  }

  const interestIds = new Set(['create', 'think_deeply', 'explore_unknown', 'people_society', 'none'])
  const curiosityIds = new Set(['music_emotions', 'space_mysteries', 'city_origins'])
  const readingIds = new Set(['new_perspective', 'learn_knowledge', 'deepen_thought', 'immerse_story'])
  const themeIds = new Set([...GENRES.map((genre) => genre.id), 'omakase'])
  const single = (id: string, allowed: Set<string>) => {
    const selected = byQuestion.get(id)
    return selected?.length === 1 && allowed.has(selected[0]) ? selected[0] : null
  }

  const interest = single('interest', interestIds)
  const readingExperience = single('reading_experience', readingIds)
  if (!interest || !readingExperience) return empty

  const themes = byQuestion.get('themes')
  if (!themes || themes.length < 1 || themes.length > 9 || new Set(themes).size !== themes.length) return empty
  if (themes.some((id) => !themeIds.has(id)) || (themes.includes('omakase') && themes.length !== 1)) return empty

  const curiosity = byQuestion.get('curiosity')
  if (interest === 'none') {
    if (!curiosity || curiosity.length < 1 || curiosity.length > 3 || new Set(curiosity).size !== curiosity.length) return empty
    if (curiosity.some((id) => !curiosityIds.has(id))) return empty
  } else if (curiosity) {
    return empty
  }

  const expectedQuestions = new Set(['interest', 'themes', 'reading_experience'])
  if (interest === 'none') expectedQuestions.add('curiosity')
  if (byQuestion.size !== expectedQuestions.size || [...byQuestion.keys()].some((id) => !expectedQuestions.has(id))) return empty

  return {
    interest: interest as NonNullable<OnboardingAnswers['interest']>,
    themes,
    curiosity: (curiosity ?? []) as OnboardingAnswers['curiosity'],
    readingExperience: readingExperience as NonNullable<OnboardingAnswers['readingExperience']>,
  }
}
