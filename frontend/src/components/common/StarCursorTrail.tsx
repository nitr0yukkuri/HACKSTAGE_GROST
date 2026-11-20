'use client'

import { useEffect, useRef } from 'react'

type Particle = {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  born: number
  life: number
  color: string
  rotation: number
}

const COLORS = ['#ffffff', '#cfe0ff', '#9cc4ff', '#ffb867']
const MAX_PARTICLES = 90

export default function StarCursorTrail() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const context = canvas.getContext('2d')
    if (!context) return

    const media = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    )
    const pointerMedia = window.matchMedia(
      '(hover: hover) and (pointer: fine)'
    )

    let particles: Particle[] = []
    let raf = 0
    let lastX: number | null = null
    let lastY: number | null = null
    let lastSpawn = 0
    let width = 0
    let height = 0
    let dpr = 1

    const enabled = () =>
      !media.matches && pointerMedia.matches && !document.hidden

    function resize() {
      if (!canvas || !context) return

      width = window.innerWidth
      height = window.innerHeight
      dpr = Math.min(window.devicePixelRatio || 1, 2)

      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    function addParticle(x: number, y: number, now: number) {
      particles.push({
        x: x + (Math.random() - 0.5) * 10,
        y: y + (Math.random() - 0.5) * 10,
        vx: (Math.random() - 0.5) * 22,
        vy: (Math.random() - 0.5) * 22,
        size: 1.5 + Math.random() * 3,
        born: now,
        life: 300 + Math.random() * 150,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        rotation: Math.random() * Math.PI,
      })

      if (particles.length > MAX_PARTICLES) {
        particles.splice(0, particles.length - MAX_PARTICLES)
      }
    }

    function drawStar(
      x: number,
      y: number,
      radius: number,
      rotation: number
    ) {
      if (!context) return

      context.beginPath()

      for (let i = 0; i < 8; i++) {
        const angle = rotation + (i * Math.PI) / 4
        const r = i % 2 === 0 ? radius : radius * 0.3
        const px = x + Math.cos(angle) * r
        const py = y + Math.sin(angle) * r

        if (i === 0) context.moveTo(px, py)
        else context.lineTo(px, py)
      }

      context.closePath()
      context.fill()
    }

    function frame(now: number) {
      if (!context) return

      context.clearRect(0, 0, width, height)

      particles = particles.filter(
        particle => now - particle.born < particle.life
      )

      for (const particle of particles) {
        const elapsed = now - particle.born
        const progress = elapsed / particle.life
        const opacity = (1 - progress) ** 1.5
        const seconds = elapsed / 1000

        const x = particle.x + particle.vx * seconds
        const y = particle.y + particle.vy * seconds

        context.save()
        context.globalAlpha = opacity
        context.fillStyle = particle.color
        context.shadowColor = particle.color
        context.shadowBlur = 9

        drawStar(
          x,
          y,
          particle.size * (1 - progress * 0.35),
          particle.rotation
        )

        context.restore()
      }

      if (particles.length > 0 && enabled()) {
        raf = requestAnimationFrame(frame)
      } else {
        raf = 0
      }
    }

    function onPointerMove(event: PointerEvent) {
      if (!enabled() || event.pointerType !== 'mouse') return

      const x = event.clientX
      const y = event.clientY
      const now = performance.now()

      if (lastX === null || lastY === null) {
        lastX = x
        lastY = y
        return
      }

      const distance = Math.hypot(x - lastX, y - lastY)

      if (distance < 4 || now - lastSpawn < 16) return

      const count = Math.min(5, Math.ceil(distance / 12))

      for (let i = 0; i < count; i++) {
        const ratio = (i + 1) / count

        addParticle(
          lastX + (x - lastX) * ratio,
          lastY + (y - lastY) * ratio,
          now
        )
      }

      lastX = x
      lastY = y
      lastSpawn = now

      if (!raf) raf = requestAnimationFrame(frame)
    }

    function reset() {
      particles = []
      lastX = null
      lastY = null

      if (raf) cancelAnimationFrame(raf)
      raf = 0

      context?.clearRect(0, 0, width, height)
    }

    function onVisibilityChange() {
      if (document.hidden) reset()
    }

    resize()

    window.addEventListener('resize', resize)
    window.addEventListener('pointermove', onPointerMove, {
      passive: true,
    })
    window.addEventListener('blur', reset)
    document.addEventListener('visibilitychange', onVisibilityChange)
    media.addEventListener('change', reset)
    pointerMedia.addEventListener('change', reset)

    return () => {
      reset()
      window.removeEventListener('resize', resize)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('blur', reset)
      document.removeEventListener(
        'visibilitychange',
        onVisibilityChange
      )
      media.removeEventListener('change', reset)
      pointerMedia.removeEventListener('change', reset)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="hoshirube-cursor-trail"
      aria-hidden="true"
    />
  )
}
