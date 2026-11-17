export type WorldLevel = 1 | 2
export type Tier = 0 | 1 | 2 // 0:未知 1:少し気になる 2:興味が強い
export type Scores = Record<string, number>

export interface World {
  id: string
  name: string
  description: string
  level: WorldLevel
  parentId: string | null
  position: { x: number; y: number }
  color: string
}

export interface Book {
  id: string
  title: string
  author: string
  description: string
  coverUrl?: string
  worldIds: string[]
}

export interface OnboardingAnswers {
  q1: number | null
  q2: string[]
  omakase: boolean
  q3: number | null
  q4Topic: string | null
  q4Novelty: number | null
}

export type QuestionAnswerKey = 'q1' | 'q3' | 'q4Topic' | 'q4Novelty'

export interface Question {
  kind: 'single' | 'genres'
  title: string[]
  subtitle?: string
  answerKey?: QuestionAnswerKey
  options?: { icon: string; label: string; value: string | number }[]
}
