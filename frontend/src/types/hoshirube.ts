export type WorldLevel = 1 | 2
export type Tier = 0 | 1 | 2 // 0:未知 1:少し気になる 2:興味が強い
export type Scores = Record<string, number>

export interface World {
  id: string
  name: string
  description: string
  searchQuery: string
  level: WorldLevel
  parentId: string | null
  position: { x: number; y: number }
  color: string
}

export interface Book {
  id: string
  source: 'google_books' | 'local_demo'
  title: string
  authors: string[]
  coverUrl: string | null
  description: string | null
  recommendationReason: string | null
  selectedBy?: 'ai' | 'search'
  infoUrl: string | null
  worldIds: string[]
}

export interface OnboardingAnswers {
  interest: 'create' | 'think_deeply' | 'explore_unknown' | 'people_society' | 'none' | null
  themes: string[]
  curiosity: ('music_emotions' | 'space_mysteries' | 'city_origins')[]
  readingExperience: 'new_perspective' | 'learn_knowledge' | 'deepen_thought' | 'immerse_story' | null
}

export type QuestionAnswerKey = 'interest' | 'readingExperience' | 'curiosity'

export interface Question {
  kind: 'single' | 'genres' | 'multi'
  title: string[]
  subtitle?: string
  answerKey?: QuestionAnswerKey
  options?: { icon: string; label: string; value: string | number }[]
}
