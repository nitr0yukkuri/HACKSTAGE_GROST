'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Tier, World } from '../../types/hoshirube'
import { createRenderer } from '../../lib/webgl/renderer'
import { STAR_TIERS } from '../../lib/star-tiers'

export interface ViewState { x: number; y: number; z: number }
interface SyncLink { from: string; to: string }
interface Props {
  worlds: World[]
  tiers: Record<string, Tier>
  completedWorldIds: ReadonlySet<string>
  suggestedIds: ReadonlySet<string>
  readingLinks: { from: string; to: string; reason: 'shared-book' | 'reading-journey' }[]
  syncLinks: SyncLink[]
  selectedId: string | null
  targetRef: { current: ViewState }
  requestRenderRef: { current: () => void }
  panelOpen: boolean
  onPick: (id: string) => void
}

type RGB = [number, number, number]
const SYNC: RGB = [0.25, 0.76, 1]
const TIER_COLOR: RGB[] = [[0.45, 0.5, 0.68], SYNC, [1, 0.72, 0.4]]

/** WebGL2で星と星座線を描き、ラベル(button)をHTMLで重ねる。状態はpropsから受け取るだけ */
export default function UniverseCanvas(props: Props) {
  const { worlds, tiers, completedWorldIds, suggestedIds, readingLinks, syncLinks, selectedId, panelOpen, onPick } = props
  const cv = useRef<HTMLCanvasElement>(null)
  const syncAnimationStartedAt = useRef<number | null>(null)
  const syncSignature = useMemo(() => syncLinks.map((link) => `${link.from}>${link.to}`).join('|'), [syncLinks])
  const syncTargetIds = useMemo(() => new Set(syncLinks.map((link) => link.to)), [syncLinks])
  const labels = useRef<Record<string, HTMLButtonElement | null>>({})
  const live = useRef({ ...props, syncTargetIds })
  const scheduleRender = useRef<() => void>(() => {})
  live.current = { ...props, syncTargetIds }
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
    const labelWidths = new Map<string, number>()
    let measuredLabelViewport = -1
    let measuredLabelSelection: string | null = null
    let measuredLabelTiers: Record<string, Tier> | null = null
    let measuredCompletedWorldIds: ReadonlySet<string> | null = null
    let measuredLabelWorlds: World[] | null = null
    const view = { x: 0, y: 0, z: 1 }
    const motionPreference = matchMedia('(prefers-reduced-motion: reduce)')
    let reducedMotion = motionPreference.matches
    let raf = 0
    let contextLost = false
    let disposed = false
    const positions = new Map<string, [number, number]>()
    const activeWorldIds = new Set<string>()
    const points: number[] = []
    const lines: number[] = []

    const frame = (ms: number) => {
      raf = 0
      raf = 0
      if (document.hidden || contextLost || disposed) return
      const { worlds, tiers, completedWorldIds, suggestedIds, readingLinks, syncLinks, syncTargetIds, selectedId, targetRef, panelOpen } = live.current
      const target = targetRef.current
      const dp = devicePixelRatio || 1, W = canvas.clientWidth, H = canvas.clientHeight
      if (W !== measuredLabelViewport || selectedId !== measuredLabelSelection || tiers !== measuredLabelTiers || completedWorldIds !== measuredCompletedWorldIds || worlds !== measuredLabelWorlds) {
        labelWidths.clear()
        worlds.forEach((w) => {
          const span = labels.current[w.id]?.querySelector('span')
          if (span) labelWidths.set(w.id, span.getBoundingClientRect().width)
        })
        measuredLabelViewport = W
        measuredLabelSelection = selectedId
        measuredLabelTiers = tiers
        measuredCompletedWorldIds = completedWorldIds
        measuredLabelWorlds = worlds
      }
      const syncElapsed = syncAnimationStartedAt.current === null ? Number.POSITIVE_INFINITY : ms - syncAnimationStartedAt.current
      const syncProgress = Math.min(1, Math.max(0, syncElapsed / 1800))
      const syncPulse = !reducedMotion && syncElapsed >= 0 && syncElapsed < 1800 ? Math.sin(Math.PI * syncProgress) : 0
      if (reducedMotion) {
        view.x = target.x; view.y = target.y; view.z = target.z
      } else {
        view.x += (target.x - view.x) * 0.09; view.y += (target.y - view.y) * 0.09; view.z += (target.z - view.z) * 0.09
      }
      const wide = W > 760, avail = W - (wide && panelOpen ? 350 : 0)
      const cx = avail / 2, cy = H / 2, sx = Math.min(avail * 0.4, H * 0.62), sy = H * (wide ? 0.36 : 0.3)

      activeWorldIds.clear()
      worlds.forEach((w) => {
        k[w.id] = reducedMotion ? 1 : Math.min(1, (k[w.id] ?? (w.level === 1 ? 1 : 0)) + 0.04)
        const x = cx + (w.position.x - view.x) * sx * view.z, y = cy + (w.position.y - view.y) * sy * view.z
        const position = positions.get(w.id) ?? [0, 0]
        position[0] = x
        position[1] = y
        positions.set(w.id, position)
        activeWorldIds.add(w.id)
        const el = labels.current[w.id]
        if (el) {
          const mobile = W <= 760
          el.style.transform = `translate(${x - 18}px,${y - 18}px)`
          el.style.opacity = String(
            suggestedIds.has(w.id) ? 0.2 * k[w.id] : k[w.id]
          )
          const labelOffset = mobile ? 8 : 12
          const labelWidth = labelWidths.get(w.id) ?? 0
          const labelRightOverflows = x + labelOffset + labelWidth > W - 12
          const labelLeftFits = x - labelOffset - labelWidth >= 12
          el.classList.toggle('label-left', labelRightOverflows && labelLeftFits)
        }
      })

      for (const id of positions.keys()) {
        if (!activeWorldIds.has(id)) positions.delete(id)
      }

      points.length = 0
      bg.forEach((s) => points.push(s[0] * W * dp, s[1] * H * dp, s[2] * dp, s[3], s[4], 0.6, 0.75, 1))
      worlds.forEach((w) => {
        const t = tiers[w.id] ?? 0, kk = k[w.id], [x, y] = positions.get(w.id)!, sel = w.id === selectedId
        const complete = completedWorldIds.has(w.id)
        const suggested = suggestedIds.has(w.id)
        const synced = syncTargetIds.has(w.id)
        const c = TIER_COLOR[t]
        const completionScale = complete ? (w.level === 1 ? 1.5 : 1.25) : 1
        const syncScale = synced ? 1.18 + syncPulse * 0.24 : 1
        const size = (w.level === 2 ? 38 : [24, 40, 62][t]) * (sel ? 1.3 : 1) * completionScale * syncScale * kk * (suggested ? 0.55 : 1)
        const baseBrightness = [0.5, 0.85, 1][t] * (w.level === 2 ? 0.9 : 1) * kk
        const brightness = complete
          ? Math.min(1, baseBrightness * 1.35)
          : synced
            ? Math.min(1, baseBrightness * (1.2 + syncPulse * 0.3))
            : baseBrightness
        if (synced) points.push(x * dp, y * dp, size * 1.65 * dp, 0.28 + syncPulse * 0.1, (x * 0.013) % 1, ...SYNC)
        points.push(x * dp, y * dp, size * dp, suggested ? brightness * 0.2 : brightness, (x * 0.013) % 1, ...c)
      })

      if (syncPulse > 0.01) {
        syncLinks.forEach(({ from, to }) => {
          const source = positions.get(from), destination = positions.get(to)
          if (!source || !destination) return
          const easedProgress = syncProgress * syncProgress * (3 - 2 * syncProgress)
          const x = source[0] + (destination[0] - source[0]) * easedProgress
          const y = source[1] + (destination[1] - source[1]) * easedProgress
          points.push(x * dp, y * dp, (9 + syncPulse * 5) * dp, syncPulse * 0.95, (x * 0.013) % 1, 0.58, 0.88, 1)
        })
      }

      lines.length = 0
      const seg = (a: string, b: string, al: number) => {
        const p = positions.get(a), q = positions.get(b)
        if (p && q) lines.push(p[0] * dp, p[1] * dp, al, q[0] * dp, q[1] * dp, al)
      }
      // 大ジャンル間の固定線は初期表示しない。
      // 読了によって解放された小ジャンルと親ジャンルを接続する。
      worlds.forEach((w) => w.parentId && seg(
        w.parentId,
        w.id,
        (suggestedIds.has(w.id) ? 0.18 : 0.75) * k[w.id],
      ))

      // 読書によって生まれた大ジャンル間のつながり
      readingLinks.forEach(({ from, to, reason }) => {
        seg(from, to, reason === 'shared-book' ? 0.65 : 0.35)
      })

      // 全冊完読から次の星へ続く線を強調する。
      syncLinks.forEach(({ from, to }) => seg(from, to, 0.5 + syncPulse * 0.45))

      renderer.draw(points, lines, reducedMotion ? 0 : ms / 1000)
      if (!reducedMotion) raf = requestAnimationFrame(frame)
    }
    const scheduleFrame = () => {
      if (!raf && !document.hidden && !contextLost && !disposed) raf = requestAnimationFrame(frame)
    }
    scheduleRender.current = scheduleFrame
    const requestRenderRef = props.requestRenderRef
    requestRenderRef.current = scheduleFrame
    const onVisibilityChange = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf)
        raf = 0
      } else {
        scheduleFrame()
      }
    }
    const onMotionPreferenceChange = (event: MediaQueryListEvent) => {
      reducedMotion = event.matches
      scheduleFrame()
    }
    const onResize = () => scheduleFrame()
    const onContextLost = (event: Event) => {
      event.preventDefault()
      contextLost = true
      cancelAnimationFrame(raf)
      raf = 0
      setGlError('WebGLの描画が停止しました。下の星一覧から選べます。')
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    motionPreference.addEventListener('change', onMotionPreferenceChange)
    window.addEventListener('resize', onResize)
    canvas.addEventListener('webglcontextlost', onContextLost)
    scheduleFrame()
    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      motionPreference.removeEventListener('change', onMotionPreferenceChange)
      window.removeEventListener('resize', onResize)
      canvas.removeEventListener('webglcontextlost', onContextLost)
      scheduleRender.current = () => {}
      if (requestRenderRef.current === scheduleFrame) requestRenderRef.current = () => {}
      renderer.dispose()
    }
  }, [props.requestRenderRef])

  useEffect(() => {
    scheduleRender.current()
  }, [props.worlds, props.tiers, props.completedWorldIds, props.suggestedIds, props.readingLinks, props.syncLinks, props.selectedId, props.panelOpen])

  useEffect(() => {
    syncAnimationStartedAt.current = syncSignature ? performance.now() : null
    scheduleRender.current()
  }, [syncSignature])

  return (
    <>
      <canvas ref={cv} className="gl" aria-label="星座マップ" />
      {(noGl || glError) && (
        <div className="nogl" role="status" aria-live="polite">
          {glError ? `星空マップを描画できませんでした: ${glError}` : 'このブラウザはWebGL2に対応していません。'}
        </div>
      )}
      <div className={`lab${noGl || glError ? ` fallback${panelOpen ? ' panel-open' : ''}` : ''}`}>
        {worlds.filter((w) => !suggestedIds.has(w.id)).map((w) => {
          const complete = completedWorldIds.has(w.id)
          const synced = syncTargetIds.has(w.id)
          const detail = complete ? '、読了済み' : synced ? '、新しいつながり' : ''
          return (
            <button key={w.id} ref={(el) => { labels.current[w.id] = el }} aria-label={`${w.name}、${STAR_TIERS[tiers[w.id] ?? 0].name}${detail}`}
              aria-pressed={w.id === selectedId}
              className={`n t${tiers[w.id] ?? 0}${w.level === 2 ? ' lv2' : ''}${w.id === selectedId ? ' sel' : ''}${complete ? ' is-complete' : ''}${synced ? ' is-synced' : ''}`}
              onClick={() => onPick(w.id)}>
              <span>{w.name}</span>
            </button>
          )
        })}
      </div>
    </>
  )
}
