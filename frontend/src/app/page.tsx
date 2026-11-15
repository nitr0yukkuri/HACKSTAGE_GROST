import Link from 'next/link'
import Logo from '../components/common/Logo'

export default function WelcomePage() {
  return (
    <section className="scr">
      <div className="earth" aria-hidden="true" />
      <Logo size={76} stroke={2.4} />
      <h1>ほしるべ</h1>
      <p className="tag-l">本を通して、<br />まだ知らない“好き”に出会う。</p>
      <Link href="/onboarding" className="pill">はじめる <span aria-hidden="true">→</span></Link>
    </section>
  )
}
