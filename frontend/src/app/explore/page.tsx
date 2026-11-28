import type { Metadata } from 'next'
import ExploreClient from './ExploreClient'

export const metadata: Metadata = {
  title: '探索',
  description: '読んだ本を探して、星座に読了記録を残します。',
  robots: {
    index: false,
    follow: false,
  },
}

export default function ExplorePage() {
  return <ExploreClient />
}
