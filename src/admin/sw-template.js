/* SkinMatrix shop system service worker (scope /admin/). Built by the adminServiceWorker plugin in
   vite.config.js, which fills in the version and the list of files to keep.

   It lets the till start, and be reloaded, with no internet:
   - pages under /admin/ (the shop system and the customer screen): network first, the saved copy when offline;
   - built files in /assets/ (hashed names, never change): saved copy first;
   - images, icons and fonts: the saved copy straight away, refreshed in the background.
   Firebase data is not handled here: Firestore keeps its own offline copy, and sales made offline wait in the
   till's queue (src/admin/live/offlineSales.js). */
const VERSION = '__VERSION__'
const PRECACHE = __PRECACHE__
const CACHE = `skinmatrix-admin-${VERSION}`
const RUNTIME = 'skinmatrix-admin-runtime'
const PAGES = ['/admin/', '/admin/index.html', '/admin/display.html']

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE)
    // One missing file must not stop the rest from being saved.
    await Promise.all([...PAGES, ...PRECACHE].map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => {})))
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Keep this version and the one before it, so a till still running the old page can load its lazy pages.
    const names = (await caches.keys()).filter((name) => name.startsWith('skinmatrix-admin-') && name !== RUNTIME)
    const keep = new Set([CACHE, ...names.filter((name) => name !== CACHE).sort().slice(-1)])
    await Promise.all(names.filter((name) => !keep.has(name)).map((name) => caches.delete(name)))
    await self.clients.claim()
  })())
})

const isPage = (request, url) => request.mode === 'navigate' && url.origin === self.location.origin && url.pathname.startsWith('/admin')
const isBuilt = (url) => url.origin === self.location.origin && url.pathname.startsWith('/assets/') && /-[A-Za-z0-9_-]{8}\.(js|css)$/.test(url.pathname)
const isStatic = (url) => (url.origin === self.location.origin && /\.(png|jpe?g|webp|svg|ico|woff2?)$/.test(url.pathname))
  || ['fonts.googleapis.com', 'fonts.gstatic.com', 'api.fontshare.com', 'cdn.fontshare.com'].includes(url.hostname)

async function networkFirstPage(request, url) {
  const fallback = url.pathname.startsWith('/admin/display') ? '/admin/display.html' : '/admin/index.html'
  try {
    const response = await fetch(request)
    if (response.ok) (await caches.open(CACHE)).put(fallback, response.clone())
    return response
  } catch {
    return (await caches.match(fallback)) || (await caches.match('/admin/')) || Response.error()
  }
}

async function cacheFirst(request) {
  const saved = await caches.match(request)
  if (saved) return saved
  const response = await fetch(request)
  if (response.ok) (await caches.open(CACHE)).put(request, response.clone())
  return response
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME)
  const saved = await cache.match(request)
  const fresh = fetch(request).then((response) => {
    if (response.ok || response.type === 'opaque') cache.put(request, response.clone())
    return response
  }).catch(() => saved || Response.error())
  return saved || fresh
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (isPage(request, url)) event.respondWith(networkFirstPage(request, url))
  else if (isBuilt(url)) event.respondWith(cacheFirst(request))
  else if (isStatic(url)) event.respondWith(staleWhileRevalidate(request))
})
