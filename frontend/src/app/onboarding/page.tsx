'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import QuestionCard from '../../components/onboarding/QuestionCard'
import { saveOnboardingAnswers } from '../../lib/recommendations'
import type { OnboardingAnswers, Question } from '../../types/hoshirube'

const INTEREST_QUESTION: Question = {
  kind: 'single',
  answerKey: 'interest',
  title: ['いま、どんなことに', 'ちょっと興味がある？'],
  options: [
    { icon: 'lap', label: '何かをつくる・つくってみたい', value: 'create' },
    { icon: 'bk', label: '考える・深く知りたい', value: 'think_deeply' },
    { icon: 'cmp', label: '知らない世界をのぞきたい', value: 'explore_unknown' },
    { icon: 'usr', label: '人や社会のことを知りたい', value: 'people_society' },
    { icon: 'spk', label: '特にない・なんとなく', value: 'none' },
  ],
}

const CURIOSITY_QUESTION: Question = {
  kind: 'multi',
  answerKey: 'curiosity',
  title: ['その中でも、', 'ちょっと気になるのはどれ？'],
  subtitle: '1〜3個選べます',
  options: [
    { icon: 'art', label: '音楽で気分が変わる理由', value: 'music_emotions' },
    { icon: 'sci', label: '宇宙の謎', value: 'space_mysteries' },
    { icon: 'his', label: '街が今の形になった理由', value: 'city_origins' },
  ],
}

const THEMES_QUESTION: Question = {
  kind: 'genres',
  title: ['気になるテーマを', 'いくつか選んでみてください'],
  subtitle: '（あとで変更できます）',
}

const READING_QUESTION: Question = {
  kind: 'single',
  answerKey: 'readingExperience',
  title: ['本を読むとき、', 'どんな体験が好き？'],
  options: [
    { icon: 'mtn', label: '新しい視点に出会う', value: 'new_perspective' },
    { icon: 'bulb', label: '知らない知識が増える', value: 'learn_knowledge' },
    { icon: 'spk', label: '考えが深まる・整理される', value: 'deepen_thought' },
    { icon: 'bk', label: '物語の世界に没頭する', value: 'immerse_story' },
  ],
}

export default function OnboardingPage() {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState<OnboardingAnswers>({ interest: null, themes: [], curiosity: [], readingExperience: null })

  const questions = [
    INTEREST_QUESTION,
    ...(answers.interest === 'none' ? [CURIOSITY_QUESTION] : []),
    THEMES_QUESTION,
    READING_QUESTION,
  ]
  const question = questions[step]

  const select = (value: string | number) => {
    if (question.answerKey === 'interest') {
      const interest = String(value) as NonNullable<OnboardingAnswers['interest']>
      setAnswers((a) => ({ ...a, interest, curiosity: interest === 'none' ? a.curiosity : [] }))
      setTimeout(() => setStep(1), 220)
      return
    }

    if (question.kind === 'genres') {
      const id = String(value)
      setAnswers((a) => {
        if (id === 'omakase') return { ...a, themes: a.themes.includes('omakase') ? [] : ['omakase'] }
        const selected = a.themes.filter((theme) => theme !== 'omakase')
        return { ...a, themes: selected.includes(id) ? selected.filter((theme) => theme !== id) : [...selected, id] }
      })
      return
    }

    if (question.kind === 'multi' && question.answerKey === 'curiosity') {
      const id = String(value) as OnboardingAnswers['curiosity'][number]
      setAnswers((a) => ({
        ...a,
        curiosity: a.curiosity.includes(id)
          ? a.curiosity.filter((selected) => selected !== id)
          : a.curiosity.length < 3 ? [...a.curiosity, id] : a.curiosity,
      }))
    } else if (question.answerKey === 'readingExperience') {
      setAnswers((a) => ({ ...a, readingExperience: String(value) as NonNullable<OnboardingAnswers['readingExperience']> }))
    }
  }

  const next = () => {
    if (step < questions.length - 1) setStep(step + 1)
    else {
      saveOnboardingAnswers(answers)
      router.push('/universe')
    }
  }
  const back = () => (step === 0 ? router.push('/') : setStep(step - 1))
  return (
    <section className="scr">
      <QuestionCard step={step} total={questions.length} isLastStep={step === questions.length - 1} question={question} answers={answers} onSelect={select} onNext={next} onBack={back} />
    </section>
  )
}
