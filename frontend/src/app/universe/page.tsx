'use client'
import { Suspense, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import Logo from '../../components/common/Logo'
import UniverseCanvas, { type ViewState } from '../../components/universe/UniverseCanvas'
import WorldDetailPanel from '../../components/universe/WorldDetailPanel'
import { WORLDS } from '../../data/worlds'
import { booksForWorld, calcScores, decodeAnswers, initialWorldId, tiersFor } from '../../lib/recommendations'

const HOME: ViewState = { x: 0, y: 0, z: 1 }
interface ActivePan { pointerId: number; lastX: number; lastY: number }
interface TouchPoint { x: number; y: number; pendingTap: boolean }
interface ActivePinch {
  pointerIds: [number, number]
  startDistance: number
  startZoom: number
  startX: number
  startY: number
  startCenterX: number
  startCenterY: number
}

function Universe() {
  const qs = useSearchParams().toString()
  const answers = useMemo(() => decodeAnswers(qs), [qs])
  const scores = useMemo(() => calcScores(answers), [answers])
  const tiers = useMemo(() => tiersFor(scores), [scores])
  const [picked, setPicked] = useState<string | null>(null)
  const [panelOpen, setPanelOpen] = useState(true)
  const [target, setTarget] = useState<ViewState>(HOME)
  const mapRef = useRef<HTMLDivElement>(null)
  const activePan = useRef<ActivePan | null>(null)
  const activePointers = useRef(new Map<number, TouchPoint>())
  const activePinch = useRef<ActivePinch | null>(null)
  const targetRef = useRef(target)
  targetRef.current = target

  const selectedId = picked ?? initialWorldId(scores, answers.omakase ? answers.q4Novelty : null)
  const world = WORLDS.find((w) => w.id === selectedId)!
  const root = world.parentId ? WORLDS.find((w) => w.id === world.parentId)! : world
  const kids = WORLDS.filter((w) => w.parentId === root.id)
  const visible = WORLDS.filter((w) => w.level === 1 || w.parentId === root.id) // 選んだ星の中ジャンルだけ展開

  const pick = (id: string) => { setPicked(id); setPanelOpen(true) }
  const zoom = (f: number) => setTarget((t) => ({ ...t, z: Math.min(3, Math.max(0.6, t.z * f)) }))
  const startPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'touch' || activePointers.current.has(event.pointerId)) return
    const targetElement = event.target instanceof Element ? event.target : null
    if (targetElement?.closest('.panel, .zc')) return
    if (activePointers.current.size >= 2) return

    activePointers.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
      pendingTap: Boolean(targetElement?.closest('.n')),
    })

    if (activePointers.current.size === 1) {
      if (!activePointers.current.get(event.pointerId)!.pendingTap) {
        event.currentTarget.setPointerCapture(event.pointerId)
        activePan.current = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY }
      }
      return
    }

    const pointerIds = Array.from(activePointers.current.keys()) as [number, number]
    const first = activePointers.current.get(pointerIds[0])!
    const second = activePointers.current.get(pointerIds[1])!
    pointerIds.forEach((pointerId) => event.currentTarget.setPointerCapture(pointerId))
    first.pendingTap = false
    second.pendingTap = false
    const dx = second.x - first.x
    const dy = second.y - first.y
    activePinch.current = {
      pointerIds,
      startDistance: Math.max(1, Math.hypot(dx, dy)),
      startZoom: targetRef.current.z,
      startX: targetRef.current.x,
      startY: targetRef.current.y,
      startCenterX: (first.x + second.x) / 2,
      startCenterY: (first.y + second.y) / 2,
    }
    activePan.current = null
  }
  const movePan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const point = activePointers.current.get(event.pointerId)
    if (!point) return
    point.x = event.clientX
    point.y = event.clientY

    const pinch = activePinch.current
    if (pinch) {
      const first = activePointers.current.get(pinch.pointerIds[0])
      const second = activePointers.current.get(pinch.pointerIds[1])
      if (!first || !second) return

      const map = mapRef.current
      if (!map) return
      const rect = map.getBoundingClientRect()
      if (!rect.width || !rect.height) return

      const dx = second.x - first.x
      const dy = second.y - first.y
      const distance = Math.max(1, Math.hypot(dx, dy))
      const centerX = (first.x + second.x) / 2
      const centerY = (first.y + second.y) / 2
      const wide = rect.width > 760
      const available = rect.width - (wide && panelOpen ? 350 : 0)
      const sx = Math.max(1, Math.min(available * 0.4, rect.height * 0.62))
      const sy = Math.max(1, rect.height * (wide ? 0.36 : 0.3))
      const zoom = Math.min(3, Math.max(0.6, pinch.startZoom * distance / pinch.startDistance))
      const viewCenterX = rect.left + available / 2
      const viewCenterY = rect.top + rect.height / 2
      const anchorX = pinch.startX + (pinch.startCenterX - viewCenterX) / (sx * pinch.startZoom)
      const anchorY = pinch.startY + (pinch.startCenterY - viewCenterY) / (sy * pinch.startZoom)
      const clamp = (value: number) => Math.min(1.3, Math.max(-1.3, value))
      setTarget((t) => ({
        ...t,
        x: clamp(anchorX - (centerX - viewCenterX) / (sx * zoom)),
        y: clamp(anchorY - (centerY - viewCenterY) / (sy * zoom)),
        z: zoom,
      }))
      return
    }

    if (point.pendingTap) return
    const pan = activePan.current
    if (!pan || pan.pointerId !== event.pointerId) return

    const dx = event.clientX - pan.lastX
    const dy = event.clientY - pan.lastY
    pan.lastX = event.clientX
    pan.lastY = event.clientY

    const map = mapRef.current
    if (!map) return
    const { width, height } = map.getBoundingClientRect()
    if (!width || !height) return

    const wide = width > 760
    const available = width - (wide && panelOpen ? 350 : 0)
    const sx = Math.max(1, Math.min(available * 0.4, height * 0.62))
    const sy = Math.max(1, height * (wide ? 0.36 : 0.3))
    const clamp = (value: number) => Math.min(1.3, Math.max(-1.3, value))
    setTarget((t) => ({
      ...t,
      x: clamp(t.x - dx / (sx * t.z)),
      y: clamp(t.y - dy / (sy * t.z)),
    }))
  }
  const stopPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!activePointers.current.delete(event.pointerId)) return
    activePinch.current = null
    activePan.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)

    if (activePointers.current.size === 1) {
      const [pointerId, point] = Array.from(activePointers.current.entries())[0]
      point.pendingTap = false
      activePan.current = { pointerId, lastX: point.x, lastY: point.y }
    }
  }
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const onWheel = (event: WheelEvent) => {
      const panel = event.target instanceof Element ? event.target.closest<HTMLElement>('.panel') : null
      if (panel) {
        const canScrollUp = panel.scrollTop > 0
        const canScrollDown = panel.scrollTop + panel.clientHeight < panel.scrollHeight - 1
        if ((event.deltaY < 0 && canScrollUp) || (event.deltaY > 0 && canScrollDown)) return
      }
      event.preventDefault()

      const { width, height } = map.getBoundingClientRect()
      if (!width || !height) return
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1
      const dx = event.deltaX * unit
      const dy = event.deltaY * unit

      if (event.ctrlKey) {
        const factor = Math.exp(-dy * 0.0025)
        setTarget((t) => ({ ...t, z: Math.min(3, Math.max(0.6, t.z * factor)) }))
        return
      }

      const wide = width > 760
      const available = width - (wide && panelOpen ? 350 : 0)
      const sx = Math.max(1, Math.min(available * 0.4, height * 0.62))
      const sy = Math.max(1, height * (wide ? 0.36 : 0.3))
      const clamp = (value: number) => Math.min(1.3, Math.max(-1.3, value))
      setTarget((t) => ({
        ...t,
        x: clamp(t.x + dx / (sx * t.z)),
        y: clamp(t.y + dy / (sy * t.z)),
      }))
    }

    map.addEventListener('wheel', onWheel, { passive: false })
    return () => map.removeEventListener('wheel', onWheel)
  }, [panelOpen])

  return (
    <section className="scr uni">
      <div className="nav">
        <Link href="/" className="lg" aria-label="最初に戻る"><Logo label /></Link>
        <div className="tabs">
          <button className="tab on">星座図</button>
          <button className="tab" aria-disabled="true" title="準備中">探索</button>
          <button className="tab" aria-disabled="true" title="準備中">ライブラリ</button>
        </div>
        <Link href="/onboarding" className="rs">質問をやり直す</Link>
      </div>
      <div className="map" ref={mapRef} onPointerDown={startPan} onPointerMove={movePan}
        onPointerUp={stopPan} onPointerCancel={stopPan} onLostPointerCapture={stopPan}>
        <UniverseCanvas worlds={visible} tiers={tiers} selectedId={selectedId} target={target} panelOpen={panelOpen} onPick={pick} />
        <div className="zc">
          <button aria-label="拡大" onClick={() => zoom(1.3)}>＋</button>
          <button aria-label="縮小" onClick={() => zoom(1 / 1.3)}>－</button>
          <button aria-label="中心に戻す" onClick={() => setTarget(HOME)}>◎</button>
        </div>
        <div className="lgd">
          <div><s />興味が強い</div><div><s className="b" />少し気になる</div><div><s className="c" />まだ未知の領域</div>
        </div>
        <div className="hint">気になる星を選んで、その世界の本をのぞいてみよう</div>
        <WorldDetailPanel world={world} root={root} kids={kids} tier={tiers[world.id]} books={booksForWorld(world.id)} open={panelOpen}
          onPick={pick} onClose={() => setPanelOpen(false)}
          onExplore={() => setTarget({ x: world.position.x, y: world.position.y, z: 1.8 })} />
      </div>
    </section>
  )
}

export default function UniversePage() {
  return <Suspense><Universe /></Suspense>
}
