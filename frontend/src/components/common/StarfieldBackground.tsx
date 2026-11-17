'use client'
import { useEffect, useState } from 'react'

interface Star { left: number; top: number; size: number; opacity: number; delay: number }

export default function StarfieldBackground() {
  const [stars, setStars] = useState<Star[]>([])
  // 乱数はクライアントでのみ生成（hydration不一致の回避）
  useEffect(() => {
    setStars(Array.from({ length: 90 }, () => ({
      left: Math.random() * 100, top: Math.random() * 100, size: Math.random() * 2 + 1,
      opacity: 0.3 + Math.random() * 0.6, delay: Math.random() * 4,
    })))
  }, [])
  return (
    <>
      <div className="stars" aria-hidden="true">
        {stars.map((s, i) => (
          <div key={i} className="st" style={{ left: `${s.left}%`, top: `${s.top}%`, width: s.size, height: s.size, opacity: s.opacity, animationDelay: `${s.delay}s` }} />
        ))}
      </div>
      <div className="meteor" aria-hidden="true" />
    </>
  )
}
