const VERSION = 'hoshirube-pwa-v1'
const STATIC_CACHE = `${VERSION}-static`
const PAGE_CACHE = `${VERSION}-pages`
const OFFLINE_URL = '/offline.html'
const PRECACHE_URLS = [OFFLINE_URL, '/pwa-icon-192.png', '/pwa-icon-512.png', '/apple-touch-icon.png']
const APP_ROUTES = new Set(['/', '/universe', '/explore', '/library', '/onboarding'])

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith('hoshirube-pwa-') && key !== STATIC_CACHE && key !== PAGE_CACHE)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/') || request.headers.has('RSC') || request.headers.has('next-router-prefetch')) return

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const pageCache = await caches.open(PAGE_CACHE)
      try {
        const response = await fetch(request)
        if (response.ok && APP_ROUTES.has(url.pathname) && response.headers.get('content-type')?.includes('text/html')) {
          try {
            await pageCache.put(request, response.clone())
          } catch {
            // A full browser cache should not turn a successful request into an offline error.
          }
        }
        return response
      } catch {
        const cachedPage = APP_ROUTES.has(url.pathname) ? await pageCache.match(request) : undefined
        return cachedPage || await caches.match(OFFLINE_URL) || Response.error()
      }
    })())
    return
  }

  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith((async () => {
      const cache = await caches.open(STATIC_CACHE)
      const cached = await cache.match(request)
      if (cached) return cached
      const response = await fetch(request)
      if (response.ok) {
        try {
          await cache.put(request, response.clone())
        } catch {
          // A full browser cache should not block the requested asset.
        }
      }
      return response
    })())
  }
})
