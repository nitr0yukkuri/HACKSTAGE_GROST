import './globals.css'
import type { Metadata, Viewport } from 'next'
import StarfieldBackground from '../components/common/StarfieldBackground'

export const metadata: Metadata = {
  title: 'ほしるべ',
  description: '本を通して、まだ知らない“好き”に出会う。',
}
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <div className="app">
          <StarfieldBackground />
          {children}
        </div>
      </body>
    </html>
  )
}
