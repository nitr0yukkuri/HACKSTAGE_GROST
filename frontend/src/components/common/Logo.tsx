export default function Logo({ size = 34, stroke = 4, label = false }: { size?: number; stroke?: number; label?: boolean }) {
  return (
    <>
      <svg width={size} height={size * 0.82} viewBox="0 0 76 62" fill="none" stroke="#fff" strokeWidth={stroke} strokeLinejoin="round" aria-hidden="true">
        <path d="M38 12C28 5 14 4 4 7v44c10-3 24-2 34 5 10-7 24-8 34-5V7C62 4 48 5 38 12zM38 12v44" />
      </svg>
      {label && <span>ほしるべ</span>}
    </>
  )
}
