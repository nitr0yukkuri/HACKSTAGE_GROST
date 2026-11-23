import './globals.css'
import type { Metadata, Viewport } from 'next'
import StarfieldBackground from '../components/common/StarfieldBackground'
import PwaRegister from '../components/common/PwaRegister'

export const metadata: Metadata = {
  title: 'ほしるべ',
  description: '本を通して、まだ知らない“好き”に出会う。',
  applicationName: 'ほしるべ',
  appleWebApp: {
    capable: true,
    title: 'ほしるべ',
    statusBarStyle: 'black-translucent',
  },
  icons: {
    icon: [
      { url: '/pwa-icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/pwa-icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
}
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0d1634',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <PwaRegister />
        <div className="app">
          <StarfieldBackground />
          {children}
        </div>
      </body>
    </html>
  )
}
