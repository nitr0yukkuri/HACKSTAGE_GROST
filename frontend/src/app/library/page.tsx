import type { Metadata } from 'next'
import LibraryClient from './LibraryClient'

export const metadata: Metadata = {
  title: '本棚',
  description: '保存した本と読了記録をまとめて管理します。',
  robots: {
    index: false,
    follow: false,
  },
}

export default function LibraryPage() {
  return <LibraryClient />
}
