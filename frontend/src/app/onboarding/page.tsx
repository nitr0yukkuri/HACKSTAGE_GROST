'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import QuestionCard from '../../components/onboarding/QuestionCard'
import { encodeAnswers } from '../../lib/recommendations'
import type { OnboardingAnswers, Question } from '../../types/hoshirube'

const QUESTIONS: Question[] = [
  { kind: 'single', title: ['いま、どんなことに', 'ちょっと興味がある？'], options: [
    { icon: 'lap', label: '何かをつくる・つくってみたい' }, { icon: 'bk', label: '考える・深く知りたい' },
    { icon: 'cmp', label: '知らない世界をのぞきたい' }, { icon: 'usr', label: '人や社会のことを知りたい' },
    { icon: 'spk', label: '特にない・なんとなく' }] },
  { kind: 'genres', title: ['気になるテーマを', 'いくつか選んでみてください'], subtitle: '（あとで変更できます）' },
  { kind: 'single', title: ['本を読むとき、', 'どんな体験が好き？'], options: [
    { icon: 'mtn', label: '新しい視点に出会う' }, { icon: 'bulb', label: '知らない知識が増える' },
    { icon: 'spk', label: '考えが深まる・整理される' }, { icon: 'bk', label: '物語の世界に没頭する' }] },
]

export default function OnboardingPage() {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState<OnboardingAnswers>({ q1: null, q2: [], omakase: false, q3: null })

  const select = (v: string | number) => {
    if (step === 0) {
      setAnswers((a) => ({ ...a, q1: v as number }))
      setTimeout(() => setStep(1), 220)
    } else if (step === 1) {
      setAnswers((a) =>
        v === 'omakase' ? { ...a, omakase: !a.omakase, q2: [] }
          : { ...a, omakase: false, q2: a.q2.includes(v as string) ? a.q2.filter((x) => x !== v) : [...a.q2, v as string] })
    } else setAnswers((a) => ({ ...a, q3: v as number }))
  }
  const next = () => (step < 2 ? setStep(step + 1) : router.push(`/universe?${encodeAnswers(answers)}`))
  const back = () => (step === 0 ? router.push('/') : setStep(step - 1))

  return (
    <section className="scr">
      <QuestionCard step={step} total={QUESTIONS.length} question={QUESTIONS[step]} answers={answers} onSelect={select} onNext={next} onBack={back} />
    </section>
  )
}
