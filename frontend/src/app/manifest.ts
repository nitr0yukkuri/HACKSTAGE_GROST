import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'ほしるべ',
    short_name: 'ほしるべ',
    description: '本を通して、まだ知らない“好き”に出会う。',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#050a1a',
    theme_color: '#0d1634',
    icons: [
      { src: '/pwa-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/pwa-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/pwa-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
