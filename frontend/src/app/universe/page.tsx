'use client'
import { Suspense, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import Logo from '../../components/common/Logo'
import UniverseCanvas, { type ViewState } from '../../components/universe/UniverseCanvas'
import WorldDetailPanel from '../../components/universe/WorldDetailPanel'
import { WORLDS } from '../../data/worlds'
import { booksForWorld, calcScores, decodeAnswers, tiersFor, topWorldId } from '../../lib/recommendations'

const HOME: ViewState = { x: 0, y: 0, z: 1 }

function Universe() {
  const qs = useSearchParams().toString()
  const scores = useMemo(() => calcScores(decodeAnswers(qs)), [qs])
  const tiers = useMemo(() => tiersFor(scores), [scores])
  const [picked, setPicked] = useState<string | null>(null)
  const [panelOpen, setPanelOpen] = useState(true)
  const [target, setTarget] = useState<ViewState>(HOME)

  const selectedId = picked ?? topWorldId(scores)
  const world = WORLDS.find((w) => w.id === selectedId)!
  const root = world.parentId ? WORLDS.find((w) => w.id === world.parentId)! : world
  const kids = WORLDS.filter((w) => w.parentId === root.id)
  const visible = WORLDS.filter((w) => w.level === 1 || w.parentId === root.id) // 選んだ星の中ジャンルだけ展開

  const pick = (id: string) => { setPicked(id); setPanelOpen(true) }
  const zoom = (f: number) => setTarget((t) => ({ ...t, z: Math.min(3, Math.max(0.6, t.z * f)) }))

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
      <div className="map">
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
