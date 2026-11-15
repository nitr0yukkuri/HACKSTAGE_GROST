'use client'
import { useEffect, useRef, useState } from 'react'
import type { Tier, World } from '../../types/hoshirube'
import { CONNECTIONS } from '../../data/connections'
import { createRenderer } from '../../lib/webgl/renderer'

export interface ViewState { x: number; y: number; z: number }
interface Props {
  worlds: World[]
  tiers: Record<string, Tier>
  selectedId: string | null
  target: ViewState
  panelOpen: boolean
  onPick: (id: string) => void
}

type RGB = [number, number, number]
const TIER_COLOR: RGB[] = [[0.45, 0.5, 0.68], [0.55, 0.66, 0.92], [0.78, 0.9, 1]]
const GOLD: RGB = [1, 0.72, 0.4]
const CHILD: RGB = [0.7, 0.95, 1]

/** WebGL2で星と星座線を描き、ラベル(button)をHTMLで重ねる。状態はpropsから受け取るだけ */
export default function UniverseCanvas(props: Props) {
  const { worlds, tiers, selectedId, onPick } = props
  const cv = useRef<HTMLCanvasElement>(null)
  const labels = useRef<Record<string, HTMLButtonElement | null>>({})
  const live = useRef(props)
  live.current = props
  const [noGl, setNoGl] = useState(false)
  const [glError, setGlError] = useState<string | null>(null)

  useEffect(() => {
    const canvas = cv.current!
    let renderer
    try {
      renderer = createRenderer(canvas)
    } catch (error) {
      console.error('Failed to initialize the WebGL renderer.', error)
      setGlError(error instanceof Error ? error.message : 'Unknown WebGL initialization error.')
      return
    }
    if (!renderer) { setNoGl(true); return }
    const bg = Array.from({ length: 130 }, () => [Math.random(), Math.random(), 2 + Math.random() * 5, 0.25 + Math.random() * 0.5, Math.random()])
    const k: Record<string, number> = {}
    const view = { x: 0, y: 0, z: 1 }
    const rm = matchMedia('(prefers-reduced-motion:reduce)').matches
    let raf = 0

    const frame = (ms: number) => {
      raf = requestAnimationFrame(frame)
      const { worlds, tiers, selectedId, target, panelOpen } = live.current
      const dp = devicePixelRatio || 1, W = canvas.clientWidth, H = canvas.clientHeight
      view.x += (target.x - view.x) * 0.09; view.y += (target.y - view.y) * 0.09; view.z += (target.z - view.z) * 0.09
      const wide = W > 760, avail = W - (wide && panelOpen ? 350 : 0)
      const cx = avail / 2, cy = H / 2, sx = Math.min(avail * 0.4, H * 0.62), sy = H * (wide ? 0.36 : 0.3)

      const pos = new Map<string, [number, number]>()
      worlds.forEach((w) => {
        k[w.id] = Math.min(1, (k[w.id] ?? (w.level === 1 ? 1 : 0)) + 0.04)
        const x = cx + (w.position.x - view.x) * sx * view.z, y = cy + (w.position.y - view.y) * sy * view.z
        pos.set(w.id, [x, y])
        const el = labels.current[w.id]
        if (el) { el.style.transform = `translate(${x - 18}px,${y - 18}px)`; el.style.opacity = String(k[w.id]) }
      })

      const pts: number[] = []
      bg.forEach((s) => pts.push(s[0] * W * dp, s[1] * H * dp, s[2] * dp, s[3], s[4], 0.6, 0.75, 1))
      worlds.forEach((w) => {
        const t = tiers[w.id] ?? 0, kk = k[w.id], [x, y] = pos.get(w.id)!, sel = w.id === selectedId
        const c = sel ? GOLD : w.level === 2 ? CHILD : TIER_COLOR[t]
        const size = (w.level === 2 ? 38 : [24, 40, 62][t]) * (sel ? 1.3 : 1) * kk
        pts.push(x * dp, y * dp, size * dp, [0.5, 0.85, 1][t] * (w.level === 2 ? 0.9 : 1) * kk, (x * 0.013) % 1, ...c)
      })

      const ln: number[] = []
      const seg = (a: string, b: string, al: number) => {
        const p = pos.get(a), q = pos.get(b)
        if (p && q) ln.push(p[0] * dp, p[1] * dp, al, q[0] * dp, q[1] * dp, al)
      }
      CONNECTIONS.forEach(([a, b]) => seg(a, b, [0.1, 0.28, 0.7][Math.min(tiers[a] ?? 0, tiers[b] ?? 0)]))
      worlds.forEach((w) => w.parentId && seg(w.parentId, w.id, 0.75 * k[w.id]))

      renderer.draw(pts, ln, rm ? 0 : ms / 1000)
    }
    raf = requestAnimationFrame(frame)
    return () => { cancelAnimationFrame(raf); renderer.dispose() }
  }, [])

  return (
    <>
      <canvas ref={cv} className="gl" aria-label="星座マップ" />
      {(noGl || glError) && (
        <div className="nogl" style={{ display: 'grid' }}>
          {glError ? `星空マップを描画できませんでした: ${glError}` : 'このブラウザはWebGL2に対応していません。'}
        </div>
      )}
      <div className="lab">
        {worlds.map((w) => (
          <button key={w.id} ref={(el) => { labels.current[w.id] = el }} aria-label={w.name}
            className={`n t${tiers[w.id] ?? 0}${w.level === 2 ? ' lv2' : ''}${w.id === selectedId ? ' sel' : ''}`}
            onClick={() => onPick(w.id)}>
            <span>{w.name}</span>
          </button>
        ))}
      </div>
    </>
  )
}
