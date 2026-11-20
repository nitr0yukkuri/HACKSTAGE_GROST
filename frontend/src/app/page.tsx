import Link from 'next/link'
import Logo from '../components/common/Logo'

export default function WelcomePage() {
  return (
    <section className="scr">
      <div className="earth" aria-hidden="true" />
      <Logo size={140} stroke={2.4} />
      <h1 className="hoshirube-title"><span className="sr-only">ほしるべ</span><span className="hoshirube-letter" aria-hidden="true">ほ</span><span className="hoshirube-letter" aria-hidden="true">し</span><span className="hoshirube-letter" aria-hidden="true">る</span><span className="hoshirube-letter" aria-hidden="true">べ</span></h1>
      <p className="tag-l">本を通して、<br />まだ知らない“好き”に出会う。</p>
      <Link href="/onboarding" className="pill">はじめる <span aria-hidden="true">→</span></Link>
    </section>
  )
}
