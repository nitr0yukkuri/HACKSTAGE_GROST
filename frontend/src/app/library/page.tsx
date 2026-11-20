import type { Metadata } from 'next'
import LibraryClient from './LibraryClient'

export const metadata: Metadata = {
  title: '本棚 | ほしるべ',
  description: '保存した本と読了記録をまとめて管理します。',
}

export default function LibraryPage() {
  return <LibraryClient />
}
