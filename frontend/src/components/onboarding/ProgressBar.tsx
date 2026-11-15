export default function ProgressBar({ step, total }: { step: number; total: number }) {
  return (
    <div className="pg">
      <span>質問 {step + 1} / {total}</span>
      <i><b style={{ width: `${((step + 1) / total) * 100}%` }} /></i>
    </div>
  )
}
