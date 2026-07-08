// ARX CRM Service Worker - Offline Support for Canvassing
const CACHE_NAME = 'arx-crm-v2'
const STATIC_CACHE = 'arx-static-v2'
const MAP_TILE_CACHE = 'arx-map-tiles-v2'

// Static assets to cache immediately
const STATIC_ASSETS = [
  '/',
  '/canvass',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
]

// Install event - cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return cache.addAll(STATIC_ASSETS)
    })
  )
  self.skipWaiting()
})

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME && name !== STATIC_CACHE && name !== MAP_TILE_CACHE)
          .map((name) => caches.delete(name))
      )
    })
  )
  self.clients.claim()
})

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  
  // Handle Google Maps tile requests - cache aggressively
  if (url.hostname.includes('googleapis.com') || 
      url.hostname.includes('gstatic.com') ||
      url.hostname.includes('google.com')) {
    event.respondWith(
      caches.open(MAP_TILE_CACHE).then((cache) => {
        return cache.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            // Return cached, but also update cache in background
            fetch(event.request).then((networkResponse) => {
              if (networkResponse.ok) {
                cache.put(event.request, networkResponse.clone())
              }
            }).catch(() => {})
            return cachedResponse
          }
          
          // Not in cache, fetch from network
          return fetch(event.request).then((networkResponse) => {
            if (networkResponse.ok) {
              cache.put(event.request, networkResponse.clone())
            }
            return networkResponse
          }).catch(() => {
            // Return a placeholder for failed map tiles
            return new Response('', { status: 503, statusText: 'Offline' })
          })
        })
      })
    )
    return
  }
  
  // Handle API requests - network first, no cache
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response(
          JSON.stringify({ error: 'You are offline. Data will sync when connection is restored.' }),
          { 
            status: 503, 
            headers: { 'Content-Type': 'application/json' }
          }
        )
      })
    )
    return
  }
  
  // Hashed Next.js chunks — always network (Vercel CDN); never cache-first
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/_next/image/')) {
    event.respondWith(fetch(event.request))
    return
  }

  // Handle page navigation - network first with cache fallback
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => {
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse
          }
          // Return the cached canvass page as fallback
          return caches.match('/canvass')
        })
      })
    )
    return
  }
  
  // Default: cache first, network fallback
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse
      }
      return fetch(event.request).then((networkResponse) => {
        // Cache successful responses
        if (networkResponse.ok && event.request.method === 'GET') {
          const responseClone = networkResponse.clone()
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone)
          })
        }
        return networkResponse
      })
    })
  )
})

// Background sync for pending pins
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-pins') {
    event.waitUntil(syncPendingPins())
  }
})

async function syncPendingPins() {
  // This will be triggered when connection is restored
  // The actual sync logic is in the React component using IndexedDB
  const clients = await self.clients.matchAll()
  clients.forEach((client) => {
    client.postMessage({ type: 'SYNC_PINS' })
  })
}

// Listen for messages from the app
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})
