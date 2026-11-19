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
  submitting?: boolean
  submitError?: string | null
}

export default function QuestionCard({ step, total, isLastStep, question, answers, onSelect, onNext, onBack, submitting = false, submitError = null }: Props) {
  const selectedValue = question.answerKey === 'interest'
    ? answers.interest
    : question.answerKey === 'readingExperience' ? answers.readingExperience : null
  const selectedMultiple = question.answerKey === 'curiosity' ? answers.curiosity : []
  const canNext = question.kind === 'genres'
    ? answers.themes.length > 0
    : question.kind === 'multi' ? selectedMultiple.length > 0 : selectedValue !== null
  return (
    <div className={`card${question.kind === 'genres' ? ' genre-card' : ''}`}>
      <ProgressBar step={step} total={total} />
      <h2>{question.title.map((t, i) => <span key={i}>{i > 0 && <br />}{t}</span>)}</h2>
      {question.subtitle && <p className="sub">{question.subtitle}</p>}
      {question.kind === 'genres' ? (
        <div className="opts grid genre-grid">
          {GENRES.map((g) => (
            <button key={g.id} type="button" disabled={submitting} className={`o${answers.themes.includes(g.id) ? ' on' : ''}`} aria-pressed={answers.themes.includes(g.id)} onClick={() => onSelect(g.id)}>
              <Icon name={g.id} />{g.name}
            </button>
          ))}
          <button type="button" disabled={submitting} className={`o${answers.themes.includes('omakase') ? ' on' : ''}`} aria-pressed={answers.themes.includes('omakase')} onClick={() => onSelect('omakase')}>
            <Icon name="spk" />おまかせ
          </button>
        </div>
      ) : (
        <div className="opts">
          {question.options!.map((o) => (
            <button key={String(o.value)} type="button"
              disabled={submitting}
              className={`o${(question.kind === 'multi' ? selectedMultiple.some((id) => id === String(o.value)) : selectedValue === o.value) ? ' on' : ''}`}
              aria-pressed={question.kind === 'multi' ? selectedMultiple.some((id) => id === String(o.value)) : selectedValue === o.value}
              onClick={() => onSelect(String(o.value))}>
              <Icon name={o.icon} />{o.label}
            </button>
          ))}
        </div>
      )}
      <div className="ft">
        {submitError && <p className="form-error" role="alert">{submitError}</p>}
        {step > 0 && <button className="pill" disabled={!canNext || submitting} onClick={onNext}>
          {submitting ? '星の候補を読み込んでいます…' : isLastStep ? '星座をつくる ✦' : 'つぎへ →'}
        </button>}
        <button className="bk" disabled={submitting} onClick={onBack}>← 戻る</button>
      </div>
    </div>
  )
}
