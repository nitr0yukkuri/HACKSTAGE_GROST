'use client'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import Logo from '../common/Logo'
import UniverseCanvas, { type ViewState } from './UniverseCanvas'
import WorldDetailPanel from './WorldDetailPanel'
import { WORLDS } from '../../data/worlds'
import { booksForWorld, calcScores, decodeAnswers, initialWorldId, tiersFor, applyReadHistory, recommendBooks, recommendNextInWorld, recommendOtherWorld, type ReadEntry } from '../../lib/recommendations'
const HOME: ViewState = { x: 0, y: 0, z: 1 }

function Universe() {
  const qs = useSearchParams().toString()
  const answers = useMemo(() => decodeAnswers(qs), [qs])
  const baseScores = useMemo(() => calcScores(answers), [answers])
  const [history, setHistory] = useState<ReadEntry[]>([])
  const readIds = useMemo(() => new Set(history.map((h) => h.bookId)), [history])
  const scores = useMemo(() => applyReadHistory(baseScores, history), [baseScores, history])
  const tiers = useMemo(() => tiersFor(scores), [scores])
  const onRead = (bookId: string) => {
    setHistory((prev) => prev.some((h) => h.bookId === bookId) ? prev : [...prev, { bookId, readAt: Date.now() }])
    setLastReadId(bookId)
  }
  const [picked, setPicked] = useState<string | null>(null)
  const [panelOpen, setPanelOpen] = useState(true)
  const [target, setTarget] = useState<ViewState>(HOME)
  const mapRef = useRef<HTMLDivElement>(null)
  const [lastReadId, setLastReadId] = useState<string | null>(null)
  const selectedId = picked ?? initialWorldId(baseScores, answers.omakase ? answers.q4Novelty : null)
  const recs = useMemo(
    () => recommendNextInWorld(selectedId, history),
    [selectedId, history],
  )
  const otherWorld = useMemo(
    () => recommendOtherWorld(selectedId, history),
    [selectedId, history],
  )
  const world = WORLDS.find((w) => w.id === selectedId)!
  const tier = tiers[world.id] ?? 0
  const books = booksForWorld(world.id)
  const root = world.parentId ? WORLDS.find((w) => w.id === world.parentId)! : world
  const kids = WORLDS.filter((w) => w.parentId === root.id)
  const visible = WORLDS.filter((w) => w.level === 1 || w.parentId === root.id) // 選んだ星の中ジャンルだけ展開

  const pick = (id: string) => {
    setPicked(id)
    setPanelOpen(true)
    const w = WORLDS.find((w) => w.id === id)
    if (w) setTarget((t) => ({ ...t, x: w.position.x, y: w.position.y, z: Math.max(t.z, 1.8) }))
  }
  const zoom = (f: number) => setTarget((t) => ({ ...t, z: Math.min(3, Math.max(0.6, t.z * f)) }))
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
      <div className="map" ref={mapRef}>
        <UniverseCanvas worlds={visible} tiers={tiers} selectedId={selectedId} target={target} panelOpen={panelOpen} onPick={pick} />
        <div className="zc">
          <button aria-label="拡大" onClick={() => zoom(1.3)}>＋</button>
          <button aria-label="縮小" onClick={() => zoom(1 / 1.3)}>－</button>
          <button aria-label="中心に戻す" onClick={() => setTarget(HOME)}>◎</button>
        </div>
        <div className="lgd">
          <div><s />興味が強い</div><div><s className="b" />少し気になる</div><div><s className="c" />まだ未知の領域</div>
        </div>
        <div className="universe-hint">気になる星を選んで、その世界の本をのぞいてみよう</div>
        <WorldDetailPanel
          world={world}
          root={root}
          kids={kids}
          tier={tier}
          books={books}
          recs={recs}
          otherWorld={otherWorld}
          open={panelOpen}
          readIds={readIds}
          lastReadId={lastReadId}
          onPick={pick}
          onRead={onRead}
          onClose={() => setPanelOpen(false)}
          onExplore={() =>
            setTarget({
              x: world.position.x,
              y: world.position.y,
              z: 1.8,
            })
          }
        />
      </div>
    </section>
  )
}

export default function UniversePage() {
  return <Suspense><Universe /></Suspense>
}
