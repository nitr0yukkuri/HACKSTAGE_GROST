import type { Metadata } from 'next'
import Link from 'next/link'
import StartRocketButton from '../components/common/StartRocketButton'
import StarCursorTrail from '../components/common/StarCursorTrail'
import Logo from '../components/common/Logo'
import { SEO_TOPICS } from '../data/seo-topics'
import { SITE_DESCRIPTION, SITE_URL } from '../lib/site'

export const metadata: Metadata = {
  title: '本から、まだ知らない「好き」に出会う',
  description: SITE_DESCRIPTION,
  alternates: {
    canonical: '/',
  },
  openGraph: {
    type: 'website',
    locale: 'ja_JP',
    siteName: 'ほしるべ',
    title: '本から、まだ知らない「好き」に出会う | ほしるべ',
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    images: [
      {
        url: '/hoshirube-og.png',
        width: 860,
        height: 489,
        alt: 'ほしるべ。本から、まだ知らない好きに出会う読書アプリ',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: '本から、まだ知らない「好き」に出会う | ほしるべ',
    description: SITE_DESCRIPTION,
    images: ['/hoshirube-og.png'],
  },
}

const websiteJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: 'ほしるべ',
  alternateName: 'Hoshirube',
  url: SITE_URL,
  description: SITE_DESCRIPTION,
  inLanguage: 'ja-JP',
}

export default function WelcomePage() {
  return (
    <main className="welcome-page">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd).replace(/</g, '\\u003c') }}
      />
      <section className="scr welcome-hero" aria-labelledby="welcome-title">
        <StarCursorTrail />
        <div className="earth" aria-hidden="true" />
        <div className="hoshirube-hero-content">
          <Logo size={140} preload />
          <h1 id="welcome-title" className="hoshirube-title"><span className="sr-only">ほしるべ — 本から、まだ知らない「好き」に出会う</span><span className="hoshirube-letter" aria-hidden="true">ほ</span><span className="hoshirube-letter" aria-hidden="true">し</span><span className="hoshirube-letter" aria-hidden="true">る</span><span className="hoshirube-letter" aria-hidden="true">べ</span></h1>
          <p className="tag-l">本を通して、<br />まだ知らない“好き”に出会おう。</p>
        </div>
        <StartRocketButton />
      </section>

      <section className="welcome-details" aria-labelledby="welcome-details-title">
        <div className="welcome-details__inner">
          <p className="welcome-details__eyebrow">ABOUT HOSHIRUBE</p>
          <h2 id="welcome-details-title">答えて、選んで、本と出会う。</h2>
          <p className="welcome-details__intro">
            ほしるべは、気になることや読んでみたいテーマを手がかりに、本を探せる読書アプリです。
            まだ知らない興味の入口を見つけて、気になる本を本棚に記録できます。
          </p>
          <ol className="welcome-steps">
            <li>
              <span className="welcome-steps__number" aria-hidden="true">01</span>
              <div>
                <h3>いまの気分を選ぶ</h3>
                <p>いくつかの質問に答えて、興味の手がかりを見つけます。</p>
              </div>
            </li>
            <li>
              <span className="welcome-steps__number" aria-hidden="true">02</span>
              <div>
                <h3>気になるテーマをたどる</h3>
                <p>星空に広がるテーマから、もっと知りたい分野を選びます。</p>
              </div>
            </li>
            <li>
              <span className="welcome-steps__number" aria-hidden="true">03</span>
              <div>
                <h3>本を探して、本棚に残す</h3>
                <p>テーマに関係する本を探し、気になる本や読書の記録を自分の本棚に残します。</p>
              </div>
            </li>
          </ol>
          <a className="welcome-details__link" href="/onboarding">冒険をはじめる</a>

          <section className="welcome-topics" aria-labelledby="welcome-topics-title">
            <p className="welcome-details__eyebrow">READING THEMES</p>
            <h2 id="welcome-topics-title">気になるテーマから、本の世界へ。</h2>
            <p className="welcome-topics__intro">
              知りたいことや身近な疑問を入口に、次に読みたいテーマを見つけてみませんか。
            </p>
            <ul className="welcome-topics__list">
              {SEO_TOPICS.map((topic) => (
                <li key={topic.slug}>
                  <Link href={`/books/${topic.slug}`}>
                    <span>{topic.title.split('｜')[0]}</span>
                    <span aria-hidden="true">→</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </section>
    </main>
  )
}
