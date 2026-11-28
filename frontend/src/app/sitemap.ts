import type { MetadataRoute } from 'next'
import { SEO_TOPICS } from '../data/seo-topics'
import { SITE_URL } from '../lib/site'

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: SITE_URL,
    },
    ...SEO_TOPICS.map(({ slug }) => ({
      url: `${SITE_URL}/books/${slug}`,
    })),
  ]
}
