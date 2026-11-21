import Link from 'next/link'
import Logo from './Logo'

type ActiveTab = 'universe' | 'explore' | 'library'

export default function AppHeader({ active, showReset = true }: { active: ActiveTab; showReset?: boolean }) {
  return (
    <header className="site-nav">
      <Link href="/" className="site-nav__brand" aria-label="ほしるべ ホーム">
        <Logo label />
      </Link>
      <nav className="site-nav__tabs" aria-label="メインナビゲーション">
        <Link href="/universe" className={`site-nav__tab${active === 'universe' ? ' is-active' : ''}`} aria-current={active === 'universe' ? 'page' : undefined}>
          星座図
        </Link>
        <Link href="/explore" className={`site-nav__tab${active === 'explore' ? ' is-active' : ''}`} aria-current={active === 'explore' ? 'page' : undefined}>
          探索
        </Link>
        <Link href="/library" className={`site-nav__tab${active === 'library' ? ' is-active' : ''}`} aria-current={active === 'library' ? 'page' : undefined}>
          ライブラリ
        </Link>
      </nav>
      {showReset && (
        <Link href="/onboarding" className="site-nav__reset">
          質問をやり直す
        </Link>
      )}
    </header>
  )
}

