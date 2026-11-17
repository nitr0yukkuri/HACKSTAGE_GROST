'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import QuestionCard from '../../components/onboarding/QuestionCard'
import { encodeAnswers } from '../../lib/recommendations'
import type { OnboardingAnswers, Question } from '../../types/hoshirube'

const BASE_QUESTIONS: Question[] = [
  { kind: 'single', answerKey: 'q1', title: ['いま、どんなことに', 'ちょっと興味がある？'], options: [
    { icon: 'lap', label: '何かをつくる・つくってみたい', value: 0 }, { icon: 'bk', label: '考える・深く知りたい', value: 1 },
    { icon: 'cmp', label: '知らない世界をのぞきたい', value: 2 }, { icon: 'usr', label: '人や社会のことを知りたい', value: 3 },
    { icon: 'spk', label: '特にない・なんとなく', value: 4 }] },
  { kind: 'genres', title: ['気になるテーマを', 'いくつか選んでみてください'], subtitle: '（あとで変更できます）' },
  { kind: 'single', answerKey: 'q3', title: ['テーマを知るなら、', 'どんなきっかけがいい？'], options: [
    { icon: 'mtn', label: '新しい見方に出会う', value: 0 }, { icon: 'bulb', label: '知らないことを知る', value: 1 },
    { icon: 'spk', label: '考えを深める', value: 2 }, { icon: 'bk', label: '物語から知る', value: 3 },
    { icon: 'spk', label: 'まだわからない', value: 4 }] },
]

const TOPIC_PROMPTS: Record<string, string> = {
  phi: '「当たり前」って、どうして当たり前に見える？',
  his: '昔の出来事は、今にどうつながっている？',
  soc: '人や社会のルールは、どうして生まれる？',
  sci: '宇宙や自然は、どんな仕組みで動いている？',
  tec: 'コンピュータや技術は、どう動いている？',
  mon: 'アイデアを形にするには、何が必要？',
  art: '音楽や絵で、どうして気持ちが動く？',
  lan: '言葉が違うと、世界の見え方はどう変わる？',
  lit: '物語は、どうして心に残る？',
}

function makeFollowUp(answers: OnboardingAnswers): Question | null {
  if (answers.omakase) {
    return {
      kind: 'single',
      answerKey: 'q4Novelty',
      title: ['どれくらい意外なテーマに', '出会いたい？'],
      subtitle: 'おまかせする範囲を選べます',
      options: [
        { icon: 'usr', label: '今の気分に近いテーマ', value: 0 },
        { icon: 'spk', label: '少し意外なテーマ', value: 1 },
        { icon: 'cmp', label: 'まったく知らない世界', value: 2 },
      ],
    }
  }

  if (answers.q1 === 4) {
    return {
      kind: 'single',
      answerKey: 'q4Topic',
      title: ['どの「なんで？」が', 'ちょっと気になる？'],
      subtitle: '選んだテーマから、ひとつ選んでみてください',
      options: [
        ...answers.q2
          .filter((id) => TOPIC_PROMPTS[id])
          .map((id) => ({ icon: id, label: TOPIC_PROMPTS[id], value: id })),
        { icon: 'spk', label: 'まだ決められない', value: 'skip' },
      ],
    }
  }

  return null
}

export default function OnboardingPage() {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState<OnboardingAnswers>({ q1: null, q2: [], omakase: false, q3: null, q4Topic: null, q4Novelty: null })

  const followUp = makeFollowUp(answers)
  const questions = followUp
    ? [...BASE_QUESTIONS.slice(0, 2), followUp, BASE_QUESTIONS[2]]
    : BASE_QUESTIONS
  const question = questions[step]

  const select = (value: string | number) => {
    if (step === 0) {
      setAnswers((a) => ({ ...a, q1: Number(value), q4Topic: null, q4Novelty: null }))
      setTimeout(() => setStep(1), 220)
      return
    }

    if (question.kind === 'genres') {
      setAnswers((a) => value === 'omakase'
        ? { ...a, omakase: !a.omakase, q2: [], q4Topic: null, q4Novelty: null }
        : {
            ...a,
            omakase: false,
            q2: a.q2.includes(String(value)) ? a.q2.filter((id) => id !== value) : [...a.q2, String(value)],
            q4Topic: null,
            q4Novelty: null,
          })
      return
    }

    if (question.answerKey === 'q4Topic') setAnswers((a) => ({ ...a, q4Topic: String(value) }))
    else if (question.answerKey === 'q4Novelty') setAnswers((a) => ({ ...a, q4Novelty: Number(value) }))
    else if (question.answerKey === 'q3') setAnswers((a) => ({ ...a, q3: Number(value) }))
  }

  const next = () => {
    if (step < questions.length - 1) setStep(step + 1)
    else router.push(`/universe?${encodeAnswers(answers)}`)
  }
  const back = () => (step === 0 ? router.push('/') : setStep(step - 1))
  const progressTotal = questions.length

  return (
    <section className="scr">
      <QuestionCard step={step} total={progressTotal} isLastStep={step === questions.length - 1} question={question} answers={answers} onSelect={select} onNext={next} onBack={back} />
    </section>
  )
}
