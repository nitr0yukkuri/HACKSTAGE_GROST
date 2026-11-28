import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getSeoTopic, SEO_TOPICS } from '../../../data/seo-topics'
import { SITE_URL } from '../../../lib/site'

type TopicPageProps = {
  params: Promise<{ slug: string }>
}

export function generateStaticParams() {
  return SEO_TOPICS.map(({ slug }) => ({ slug }))
}

export async function generateMetadata({ params }: TopicPageProps): Promise<Metadata> {
  const { slug } = await params
  const topic = getSeoTopic(slug)
  if (!topic) return {}

  const canonical = `/books/${topic.slug}`
  const title = `${topic.title} | ほしるべ`
  return {
    title: topic.title,
    description: topic.description,
    alternates: { canonical },
    openGraph: {
      type: 'article',
      locale: 'ja_JP',
      siteName: 'ほしるべ',
      title,
      description: topic.description,
      url: `${SITE_URL}${canonical}`,
      images: [
        {
          url: '/hoshirube-og.png',
          width: 860,
          height: 489,
          alt: 'ほしるべ。本から、まだ知らない好きに出会う読書アプリ',
        },
      ],
    },
    twitter: { card: 'summary_large_image', title, description: topic.description, images: ['/hoshirube-og.png'] },
  }
}

export default async function TopicPage({ params }: TopicPageProps) {
  const { slug } = await params
  const topic = getSeoTopic(slug)
  if (!topic) notFound()

  const relatedTopics = topic.relatedSlugs
    .map((relatedSlug) => getSeoTopic(relatedSlug))
    .filter((relatedTopic) => relatedTopic !== undefined)
  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'ほしるべ', item: SITE_URL },
      {
        '@type': 'ListItem',
        position: 2,
        name: topic.title.split('｜')[0],
        item: `${SITE_URL}/books/${topic.slug}`,
      },
    ],
  }

  return (
    <main className="seo-topic-page">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd).replace(/</g, '\\u003c') }}
      />
      <div className="seo-topic-page__inner">
        <nav className="seo-topic-breadcrumb" aria-label="パンくずリスト">
          <Link href="/">ほしるべ</Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">{topic.title.split('｜')[0]}</span>
        </nav>

        <header className="seo-topic-hero">
          <p className="seo-topic-eyebrow">BOOK DISCOVERY</p>
          <h1>{topic.title.split('｜')[0]}</h1>
          <p className="seo-topic-lead">{topic.lead}</p>
        </header>

        <div className="seo-topic-content">
          {topic.sections.map((section) => (
            <section key={section.heading} aria-labelledby={`section-${section.heading}`}>
              <h2 id={`section-${section.heading}`}>{section.heading}</h2>
              {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
            </section>
          ))}
        </div>

        <section className="seo-topic-cta" aria-labelledby="seo-topic-cta-title">
          <p className="seo-topic-eyebrow">FIND YOUR NEXT BOOK</p>
          <h2 id="seo-topic-cta-title">気になる問いから、本を探してみよう。</h2>
          <p>いくつかの質問に答えて興味の手がかりを見つけ、気になるテーマをたどれます。</p>
          <Link className="seo-topic-button" href="/onboarding">冒険をはじめる</Link>
        </section>

        <nav className="seo-topic-related" aria-labelledby="seo-topic-related-title">
          <h2 id="seo-topic-related-title">ほかのテーマから探す</h2>
          <ul>
            {relatedTopics.map((relatedTopic) => (
              <li key={relatedTopic.slug}>
                <Link href={`/books/${relatedTopic.slug}`}>
                  {relatedTopic.title.split('｜')[0]} <span aria-hidden="true">→</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <Link className="seo-topic-home" href="/">トップページへ戻る</Link>
      </div>
    </main>
  )
}
