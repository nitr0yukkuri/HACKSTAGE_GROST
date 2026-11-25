'use client'

import { readingLinksForLibrary } from '../../lib/reading-links'

import { classifyBook } from '../../lib/book-classification'
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import Link from 'next/link'
import AppHeader from '../../components/common/AppHeader'
import UniverseCanvas, { type ViewState } from '../../components/universe/UniverseCanvas'
import WorldDetailPanel from '../../components/universe/WorldDetailPanel'
import { WORLDS } from '../../data/worlds'
import { booksForWorld, calcScores, decodeAnswers, emptyOnboardingAnswers, initialWorldId, loadOnboardingAnswers } from '../../lib/recommendations'
import { STAR_TIERS, starTiersFor } from '../../lib/star-tiers'
import { CONNECTIONS } from '../../data/connections'
import {
  applyReadHistory,
  recommendNextInWorld,
  type ReadEntry,
} from '../../lib/recommendations'
import useLibrary from '../../lib/useLibrary'
import { getThemeBooks, isDiscoveryApiConfigured, isDiscoveryThemeSupported, loadDiscoverySession, type BookRecommendation, type DiscoverySession } from '../../lib/api/discovery'
import { libraryBookKey, loadLibrary } from '../../lib/library-store'
import { completedWorldIdsFor, loadWorldBookLists, rememberWorldBooks, resetWorldBookListsFallback, WORLD_BOOK_LISTS_STORAGE_KEY, type WorldBookLists } from '../../lib/reading-progress'
import type { OnboardingAnswers } from '../../types/hoshirube'

const HOME: ViewState = { x: 0, y: 0, z: 1 }
const clamp = (value: number, limit = 1.3) => Math.min(limit, Math.max(-limit, value))
interface SyncLink { from: string; to: string }
interface ActivePan { pointerId: number; lastX: number; lastY: number }
interface TouchPoint { x: number; y: number; pendingTap: boolean; pointerType: string }
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
  const [answers, setAnswers] = useState<OnboardingAnswers>(emptyOnboardingAnswers)
  const [answersReady, setAnswersReady] = useState(false)
  const apiConfigured = isDiscoveryApiConfigured()
  const [discoverySession, setDiscoverySession] = useState<DiscoverySession | null>(null)
  const [discoveryReady, setDiscoveryReady] = useState(false)
  const [bookResult, setBookResult] = useState<BookRecommendation | null>(null)
  const [bookLoading, setBookLoading] = useState(false)
  const [bookError, setBookError] = useState<string | null>(null)
  const [bookRetry, setBookRetry] = useState(0)
  const [worldBookLists, setWorldBookLists] = useState<WorldBookLists>({})
  const bookCache = useRef(new Map<string, BookRecommendation>())
  useEffect(() => {
    setAnswers(decodeAnswers(loadOnboardingAnswers()))
    setDiscoverySession(apiConfigured ? loadDiscoverySession() : null)
    setAnswersReady(true)
    setDiscoveryReady(true)
  }, [apiConfigured])
  const { entries: library, save: saveBook, setReadStatus } = useLibrary()

  useEffect(() => {
    const sync = () => setWorldBookLists(loadWorldBookLists())
    const onStorage = (event: StorageEvent) => {
      if (event.key === null) resetWorldBookListsFallback()
      if (event.key === WORLD_BOOK_LISTS_STORAGE_KEY || event.key === null) sync()
    }
    sync()
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])
  const baseScores = useMemo(() => calcScores(answers), [answers])

  const history = useMemo<ReadEntry[]>(
    () => Object.values(library)
      .filter((entry) =>
        entry.status === 'read' && entry.book.source === 'local_demo'
      )
      .map((entry) => ({
        bookId: entry.book.id,
        readAt: entry.savedAt,
      })),
    [library],
  )

  const readIds = useMemo(
    () => new Set(history.map((entry) => entry.bookId)),
    [history],
  )

  const scores = useMemo(
    () => applyReadHistory(baseScores, history),
    [baseScores, history],
  )
  const completedWorldIds = useMemo(
    () => completedWorldIdsFor(Object.fromEntries(WORLDS.map((candidate) => [
      candidate.id,
      apiConfigured && isDiscoveryThemeSupported(candidate.id)
        ? worldBookLists[candidate.id] ?? []
        : booksForWorld(candidate.id).map(libraryBookKey),
    ])), library),
    [apiConfigured, worldBookLists, library],
  )
  const [picked, setPicked] = useState<string | null>(null)
  const [panelOpen, setPanelOpen] = useState(true)
  const mapRef = useRef<HTMLDivElement>(null)
  const activePan = useRef<ActivePan | null>(null)
  const activePointers = useRef(new Map<number, TouchPoint>())
  const activePinch = useRef<ActivePinch | null>(null)
  const targetRef = useRef<ViewState>(HOME)
  const requestCanvasRenderRef = useRef<() => void>(() => {})
  const finishPointerRef = useRef<(pointerId: number, map: HTMLDivElement) => void>(() => {})
  const updateTarget = useCallback((next: ViewState | ((current: ViewState) => ViewState)) => {
    targetRef.current = typeof next === 'function' ? next(targetRef.current) : next
    requestCanvasRenderRef.current()
  }, [])

  const selectedId = picked ?? (
    answers.themes.find((id) => WORLDS.some((w) => w.id === id && w.level === 1))
    ?? (apiConfigured && discoverySession
      ? discoverySession.seed.themes[0].themeId
      : initialWorldId(scores))
  )
  const recs = useMemo(
    () => recommendNextInWorld(selectedId, history),
    [selectedId, history],
  )

  const world = WORLDS.find((w) => w.id === selectedId)!
  const root = world.parentId ? WORLDS.find((w) => w.id === world.parentId)! : world
  // 質問で選択した大ジャンルを出発点にする。
  // おまかせ・未選択時はAPI候補、またはスコア上位のジャンルを使用。
  const initialGenreIds = useMemo(() => {
    const valid = new Set(WORLDS.filter((w) => w.level === 1).map((w) => w.id))
    const chosen = answers.themes.filter((id) => valid.has(id))
    if (chosen.length > 0) return new Set(chosen)

    if (apiConfigured && discoverySession) {
      return new Set(discoverySession.seed.themes.map((theme) => theme.themeId))
    }

    return new Set([initialWorldId(baseScores)])
  }, [answers.themes, apiConfigured, discoverySession, baseScores])

  // 読了済みの本の分類は一度だけ計算し、解放済みと関連候補を同時に作る。
  const { unlockedChildIds, suggestedChildIds } = useMemo(() => {
    const childIds = new Set(WORLDS.filter((w) => w.parentId).map((w) => w.id))
    const unlocked = new Set<string>()
    const candidates = new Set<string>()

    Object.values(library).forEach((entry) => {
      if (entry.status !== 'read') return
      const classification = classifyBook(entry.book)

      entry.book.worldIds.forEach((id) => {
        if (childIds.has(id)) unlocked.add(id)
      })
      classification.confirmedIds.forEach((id) => {
        unlocked.add(id)
        candidates.add(id)
      })
      classification.suggestedIds.forEach((id) => candidates.add(id))
    })

    const suggested = new Set(
      [...candidates].filter((id) => !unlocked.has(id)),
    )
    return { unlockedChildIds: unlocked, suggestedChildIds: suggested }
  }, [library])

  // 読了によって解放された中ジャンルのみ、パネルから選択できる。
  const kids = WORLDS.filter(
    (w) => w.parentId === root.id && unlockedChildIds.has(w.id),
  )

  // 解放済みの小ジャンルの親も表示して、星が孤立しないようにする。
  const visibleIds = useMemo(() => {
    const ids = new Set(initialGenreIds)
    for (const childId of [...unlockedChildIds, ...suggestedChildIds]) {
      const child = WORLDS.find((w) => w.id === childId)
      if (child?.parentId) {
        ids.add(child.parentId)
        ids.add(childId)
      }
    }
    return ids
  }, [initialGenreIds, unlockedChildIds, suggestedChildIds])

  // 大ジャンルは自由に探索できるよう常時表示する。
  // 小ジャンルだけ読了による解放を必要とする。
  const visible = WORLDS.filter(
    (w) => w.level === 1 || visibleIds.has(w.id),
  )
  const searchQuery = discoverySession?.seed.themes.find((theme) => theme.themeId === world.id)?.searchQuery ?? world.searchQuery
  const discoverySearchEnabled = apiConfigured && isDiscoveryThemeSupported(world.id)

  useEffect(() => {
    if (!apiConfigured || !discoverySession || !discoveryReady) return
    if (!isDiscoveryThemeSupported(world.id)) {
      setBookResult(null)
      setBookError(null)
      setBookLoading(false)
      return
    }
    const cacheKey = JSON.stringify([discoverySession.context, world.id, searchQuery])
    const cached = bookCache.current.get(cacheKey)
    if (cached) {
      setWorldBookLists(rememberWorldBooks(cached.themeId, cached.items.map(libraryBookKey), loadLibrary()))
      setBookResult(cached)
      setBookError(null)
      setBookLoading(false)
      return
    }

    const controller = new AbortController()
    setBookResult(null)
    setBookError(null)
    setBookLoading(true)
    getThemeBooks(world.id, searchQuery, discoverySession.context, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return
        bookCache.current.set(cacheKey, result)
        setWorldBookLists(rememberWorldBooks(result.themeId, result.items.map(libraryBookKey), loadLibrary()))
        setBookResult(result)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setBookError(error instanceof Error ? error.message : '本を取得できませんでした。再試行してください。')
      })
      .finally(() => {
        if (!controller.signal.aborted) setBookLoading(false)
      })
    return () => controller.abort()
  }, [apiConfigured, discoveryReady, discoverySession, world.id, searchQuery, bookRetry])

  const readingLinks = useMemo(() => readingLinksForLibrary(library), [library])

  const syncLinks = useMemo<SyncLink[]>(() => {
    const usedTargets = new Set<string>()
    return WORLDS.filter((candidate) => candidate.level === 1 && completedWorldIds.has(candidate.id))
      .flatMap((source) => {
        const neighbors = CONNECTIONS.flatMap(([a, b]) =>
          a === source.id ? [b] : b === source.id ? [a] : [],
        )
          .filter((id) =>
            !completedWorldIds.has(id) &&
            !usedTargets.has(id) &&
            (apiConfigured || booksForWorld(id).length > 0),
          )
          .sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0))
        const targetId = neighbors[0]
        if (!targetId) return []
        usedTargets.add(targetId)
        return [{ from: source.id, to: targetId }]
      })
  }, [apiConfigured, completedWorldIds, scores])

  const tiers = useMemo(
    () => starTiersFor(
      WORLDS,
      completedWorldIds,
      new Set(syncLinks.map((link) => link.to)),
      scores,
      apiConfigured && discoverySession
        ? discoverySession.seed.themes.map((theme) => theme.themeId)
        : undefined,
    ),
    [apiConfigured, completedWorldIds, discoverySession, scores, syncLinks],
  )

  const nextWorldId = syncLinks.find((link) => link.from === world.id)?.to
  const nextWorld = WORLDS.find((candidate) => candidate.id === nextWorldId)

  const focusWorld = useCallback((worldId: string, zoomLevel = 1, panelVisible = panelOpen) => {
    if (typeof window === 'undefined' || window.innerWidth > 760) return
    const map = mapRef.current
    const focus = WORLDS.find((item) => item.id === worldId)
    if (!map || !focus) return

    const mapRect = map.getBoundingClientRect()
    const panel = panelVisible ? map.querySelector<HTMLElement>('.panel') : null
    const panelTop = panel && !panel.classList.contains('off')
      ? panel.getBoundingClientRect().top
      : mapRect.bottom
    const openHeight = Math.max(80, panelTop - mapRect.top)
    const desiredY = panelVisible
      ? Math.min(openHeight * 0.44, mapRect.height * 0.26)
      : mapRect.height / 2
    const scaleY = mapRect.height * 0.3 * zoomLevel
    const targetY = focus.position.y + (mapRect.height / 2 - desiredY) / scaleY

    updateTarget({
      x: clamp(focus.position.x),
      y: clamp(targetY, 2.2),
      z: zoomLevel,
    })
  }, [panelOpen, updateTarget])

  useEffect(() => {
    if (answersReady) focusWorld(selectedId, 1, panelOpen)
  }, [answersReady, selectedId, panelOpen, focusWorld])

  const pick = (id: string) => { setPicked(id); setPanelOpen(true) }
  const zoom = (f: number) => updateTarget((t) => ({ ...t, z: Math.min(3, Math.max(0.6, t.z * f)) }))
  const startPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!answersReady) return
    if ((event.pointerType !== 'touch' && event.pointerType !== 'mouse') || event.button !== 0 || activePointers.current.has(event.pointerId)) return
    const targetElement = event.target instanceof Element ? event.target : null
    if (targetElement?.closest('.panel, .zc, .lgd, .hint')) return
    if (event.pointerType === 'mouse') {
      if (activePointers.current.size || targetElement?.closest('.n')) return
      activePointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY, pendingTap: false, pointerType: 'mouse' })
      event.currentTarget.setPointerCapture(event.pointerId)
      activePan.current = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY }
      return
    }
    if (Array.from(activePointers.current.values()).some((point) => point.pointerType === 'mouse')) return
    if (activePointers.current.size >= 2) return

    activePointers.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
      pendingTap: Boolean(targetElement?.closest('.n')),
      pointerType: 'touch',
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
      updateTarget((t) => ({
        ...t,
        x: clamp(anchorX - (centerX - viewCenterX) / (sx * zoom)),
        y: clamp(anchorY - (centerY - viewCenterY) / (sy * zoom), 2.2),
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
    updateTarget((t) => ({
      ...t,
      x: clamp(t.x - dx / (sx * t.z)),
      y: clamp(t.y - dy / (sy * t.z), 2.2),
    }))
  }
  const finishPointer = (pointerId: number, map: HTMLDivElement) => {
    if (!activePointers.current.delete(pointerId)) return
    activePinch.current = null
    activePan.current = null
    if (map.hasPointerCapture(pointerId)) map.releasePointerCapture(pointerId)

    if (activePointers.current.size === 1) {
      const [remainingId, point] = Array.from(activePointers.current.entries())[0]
      point.pendingTap = false
      activePan.current = { pointerId: remainingId, lastX: point.x, lastY: point.y }
    }
  }
  finishPointerRef.current = finishPointer
  const stopPan = (event: ReactPointerEvent<HTMLDivElement>) => finishPointer(event.pointerId, event.currentTarget)
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const onWheel = (event: WheelEvent) => {
      const panel = event.target instanceof Element ? event.target.closest<HTMLElement>('.panel') : null
      if (panel) {
        if (window.innerWidth <= 760) return

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
        updateTarget((t) => ({ ...t, z: Math.min(3, Math.max(0.6, t.z * factor)) }))
        return
      }

      const wide = width > 760
      const available = width - (wide && panelOpen ? 350 : 0)
      const sx = Math.max(1, Math.min(available * 0.4, height * 0.62))
      const sy = Math.max(1, height * (wide ? 0.36 : 0.3))
      updateTarget((t) => ({
        ...t,
        x: clamp(t.x + dx / (sx * t.z)),
        y: clamp(t.y + dy / (sy * t.z), 2.2),
      }))
    }
    const onPointerEndOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && map.contains(event.target)) return
      finishPointerRef.current(event.pointerId, map)
    }

    map.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('pointerup', onPointerEndOutside)
    window.addEventListener('pointercancel', onPointerEndOutside)
    return () => {
      map.removeEventListener('wheel', onWheel)
      window.removeEventListener('pointerup', onPointerEndOutside)
      window.removeEventListener('pointercancel', onPointerEndOutside)
    }
  }, [panelOpen, updateTarget])

  return (
    <section className="scr uni">
      <AppHeader active="universe" />
      <div className="map" ref={mapRef} onPointerDown={startPan} onPointerMove={movePan}
        onPointerUp={stopPan} onPointerCancel={stopPan} onLostPointerCapture={stopPan}>
        {answersReady && discoveryReady && apiConfigured && !discoverySession ? (
          <div className="discovery-gate" role="status">
            <div><span aria-hidden="true">✦</span><h2>星の候補がありません</h2>
              <p>API接続が有効ですが、このタブに保存された質問結果がありません。質問に答えて星をつくってください。</p>
              <Link href="/onboarding" className="pill">質問に答える →</Link>
            </div>
          </div>
        ) : answersReady && discoveryReady ? <>
          <UniverseCanvas
              worlds={visible}
              tiers={tiers}
              completedWorldIds={completedWorldIds}
              suggestedIds={suggestedChildIds}
              readingLinks={readingLinks}
              syncLinks={syncLinks}
              selectedId={selectedId}
              targetRef={targetRef}
              requestRenderRef={requestCanvasRenderRef}
              panelOpen={panelOpen}
              onPick={pick}
            />
          <div className="zc">
            <button aria-label="拡大" onClick={() => zoom(1.3)}>＋</button>
            <button aria-label="縮小" onClick={() => zoom(1 / 1.3)}>－</button>
            <button aria-label="中心に戻す" onClick={() => { if (window.innerWidth <= 760) focusWorld(selectedId, 1, panelOpen); else updateTarget(HOME) }}>◎</button>
          </div>
          <div className="lgd" role="list" aria-label="星の等級と意味">
            <div role="listitem" aria-label={`${STAR_TIERS[2].name}：${STAR_TIERS[2].description}`}>
              <span className="lgd__star lgd__star--first" aria-hidden="true" />
              <span className="lgd__text"><strong>{STAR_TIERS[2].name}</strong><small>{STAR_TIERS[2].description}</small></span>
            </div>
            <div role="listitem" aria-label={`${STAR_TIERS[1].name}：${STAR_TIERS[1].description}`}>
              <span className="lgd__star lgd__star--second" aria-hidden="true" />
              <span className="lgd__text"><strong>{STAR_TIERS[1].name}</strong><small>{STAR_TIERS[1].description}</small></span>
            </div>
            <div role="listitem" aria-label={`${STAR_TIERS[0].name}：${STAR_TIERS[0].description}`}>
              <span className="lgd__star lgd__star--third" aria-hidden="true" />
              <span className="lgd__text"><strong>{STAR_TIERS[0].name}</strong><small>{STAR_TIERS[0].description}</small></span>
            </div>
          </div>
          <div className="hint">気になる星を選んで、その世界の本をのぞいてみよう</div>
          <WorldDetailPanel world={world} root={root} kids={kids} tier={tiers[world.id]}
            nextWorld={nextWorld}
            books={discoverySearchEnabled ? (bookResult?.themeId === world.id ? bookResult.items : []) : booksForWorld(world.id)}
            loading={discoverySearchEnabled && bookLoading} error={discoverySearchEnabled ? bookError : null}
            onRetry={() => setBookRetry((count) => count + 1)} apiMode={discoverySearchEnabled} library={library} open={panelOpen}
              readIds={readIds}
              recs={discoverySearchEnabled ? [] : recs}
              onRead={(book) => {
                const key = libraryBookKey(book)
                if (library[key]?.status === 'read') return
                if (!library[key]) saveBook(book, world.id)
                setReadStatus(key, 'read')
              }}
            onPick={pick} onClose={() => setPanelOpen(false)}
            onExplore={() => {
                if (window.innerWidth <= 760) {
                  focusWorld(world.id, 1.25, panelOpen)
                } else {
                  updateTarget({
                    x: world.position.x,
                    y: world.position.y,
                    z: 1.8,
                  })
                }
              }} />
        </> : <div className="map-loading" role="status" aria-live="polite">星座図を準備しています…</div>}
      </div>
    </section>
  )
}

export default function UniversePage() {
  return <Universe />
}
