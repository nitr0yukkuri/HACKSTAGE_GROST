export default function ProgressBar({ step, total }: { step: number; total: number }) {
  // `step` is the number of questions already answered, so the first question starts at 0%.
  const progress = total > 0 ? Math.min(100, Math.max(0, Math.round((step / total) * 100))) : 0

  return (
    <div className="pg">
      <div className="pg-head"><span>質問</span><strong>{progress}%</strong></div>
      <div
        className="pg-track"
        role="progressbar"
        aria-label="質問の進捗"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
        aria-valuetext={`${progress}%`}
      >
        <span className="pg-fill" style={{ width: `${progress}%` }} />
      </div>
    </div>
  )
}
