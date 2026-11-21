'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

export default function StartRocketButton() {
  const router = useRouter()
  const [launching, setLaunching] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  function launch() {
    if (launching) return

    const reducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches

    if (reducedMotion) {
      router.push('/onboarding')
      return
    }

    setLaunching(true)
    timerRef.current = setTimeout(() => {
      router.push('/onboarding')
    }, 650)
  }

  return (
    <button
      type="button"
      className={`hoshirube-rocket-button${launching ? ' is-launching' : ''}`}
      onClick={launch}
      disabled={launching}
    >
      <span className="hoshirube-rocket-button__shine" aria-hidden="true" />

      <span className="hoshirube-rocket-button__label">
        冒険をはじめる
      </span>

      <span className="hoshirube-rocket-button__icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none">
          <path
            d="M8 15.5 5 12.5l3-2 5.5 5.5-2 3-3.5-3.5Z"
            fill="currentColor"
            opacity=".65"
          />
          <path
            d="M9 14c2.5-6 6-9 12-11-1 6-5 10-11 12l-1-1Z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <circle cx="16" cy="8" r="1.6" fill="currentColor" />
        </svg>
      </span>
    </button>
  )
}
