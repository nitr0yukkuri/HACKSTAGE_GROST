import Link from 'next/link'
import Logo from './Logo'

type ActiveTab = 'universe' | 'library'

export default function AppHeader({ active }: { active: ActiveTab }) {
  return (
    <header className="site-nav">
      <Link href="/" className="site-nav__brand" aria-label="ほしるべ ホーム">
        <Logo label />
      </Link>
      <nav className="site-nav__tabs" aria-label="メインナビゲーション">
        <Link href="/universe" className={`site-nav__tab${active === 'universe' ? ' is-active' : ''}`} aria-current={active === 'universe' ? 'page' : undefined}>
          星座図
        </Link>
        <button type="button" className="site-nav__tab" disabled title="準備中">
          探索
        </button>
        <Link href="/library" className={`site-nav__tab${active === 'library' ? ' is-active' : ''}`} aria-current={active === 'library' ? 'page' : undefined}>
          ライブラリ
        </Link>
      </nav>
      <Link href="/onboarding" className="site-nav__reset">
        質問をやり直す
      </Link>
    </header>
  )
}
