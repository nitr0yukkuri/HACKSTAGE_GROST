'use client'
import type { OnboardingAnswers, Question } from '../../types/hoshirube'
import { GENRES } from '../../data/worlds'
import { ICON_PATHS } from '../../data/icons'
import ProgressBar from './ProgressBar'

function Icon({ name }: { name: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: ICON_PATHS[name] ?? '' }} />
  )
}

interface Props {
  step: number
  total: number
  question: Question
  answers: OnboardingAnswers
  onSelect: (v: string | number) => void
  onNext: () => void
  onBack: () => void
}

export default function QuestionCard({ step, total, question, answers, onSelect, onNext, onBack }: Props) {
  const cur = step === 0 ? answers.q1 : answers.q3
  const canNext = step === 0 ? false : step === 1 ? answers.omakase || answers.q2.length > 0 : answers.q3 !== null
  return (
    <div className="card">
      <ProgressBar step={step} total={total} />
      <h2>{question.title.map((t, i) => <span key={i}>{i > 0 && <br />}{t}</span>)}</h2>
      {question.subtitle && <p className="sub">{question.subtitle}</p>}
      <div className={`opts${question.kind === 'genres' ? ' grid' : ''}`}>
        {question.kind === 'genres' ? (
          <>
            {GENRES.map((g) => (
              <button key={g.id} className={`o${answers.q2.includes(g.id) ? ' on' : ''}`} onClick={() => onSelect(g.id)}>
                <Icon name={g.id} />{g.name}
              </button>
            ))}
            <button className={`o wide${answers.omakase ? ' on' : ''}`} onClick={() => onSelect('omakase')}>
              <Icon name="spk" />おまかせ
            </button>
          </>
        ) : (
          question.options!.map((o, i) => (
            <button key={o.label} className={`o${cur === i ? ' on' : ''}`} onClick={() => onSelect(i)}>
              <Icon name={o.icon} />{o.label}
            </button>
          ))
        )}
      </div>
      <div className="ft">
        {step > 0 && <button className="pill" disabled={!canNext} onClick={onNext}>{step === total - 1 ? '星座をつくる ✦' : 'つぎへ →'}</button>}
        <button className="bk" onClick={onBack}>← 戻る</button>
      </div>
    </div>
  )
}
