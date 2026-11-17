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
  isLastStep: boolean
  question: Question
  answers: OnboardingAnswers
  onSelect: (v: string | number) => void
  onNext: () => void
  onBack: () => void
}

export default function QuestionCard({ step, total, isLastStep, question, answers, onSelect, onNext, onBack }: Props) {
  const selectedValue = question.answerKey ? answers[question.answerKey] : null
  const canNext = question.kind === 'genres'
    ? answers.omakase || answers.q2.length > 0
    : question.answerKey === 'q1' ? false : selectedValue !== null
  return (
    <div className={`card${question.kind === 'genres' ? ' genre-card' : ''}`}>
      <ProgressBar step={step} total={total} />
      <h2>{question.title.map((t, i) => <span key={i}>{i > 0 && <br />}{t}</span>)}</h2>
      {question.subtitle && <p className="sub">{question.subtitle}</p>}
      {question.kind === 'genres' ? (
        <div className="opts grid genre-grid">
          {GENRES.map((g) => (
            <button key={g.id} type="button" className={`o${answers.q2.includes(g.id) ? ' on' : ''}`} aria-pressed={answers.q2.includes(g.id)} onClick={() => onSelect(g.id)}>
              <Icon name={g.id} />{g.name}
            </button>
          ))}
          <button type="button" className={`o${answers.omakase ? ' on' : ''}`} aria-pressed={answers.omakase} onClick={() => onSelect('omakase')}>
            <Icon name="spk" />おまかせ
          </button>
        </div>
      ) : (
        <div className="opts">
          {question.options!.map((o) => (
            <button key={String(o.value)} type="button" className={`o${selectedValue === o.value ? ' on' : ''}`} aria-pressed={selectedValue === o.value} onClick={() => onSelect(o.value)}>
              <Icon name={o.icon} />{o.label}
            </button>
          ))}
        </div>
      )}
      <div className="ft">
        {step > 0 && <button className="pill" disabled={!canNext} onClick={onNext}>{isLastStep ? '星座をつくる ✦' : 'つぎへ →'}</button>}
        <button className="bk" onClick={onBack}>← 戻る</button>
      </div>
    </div>
  )
}
