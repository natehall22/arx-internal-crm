const CACHE_NAME = 'canvass-v4';
const RUNTIME_CACHE = 'canvass-runtime-v4';
const RUNTIME_MAX_ENTRIES = 60;
const OFFLINE_URL = '/canvass/offline';

// Assets to cache immediately on install
const PRECACHE_ASSETS = [
  '/canvass',
  '/canvass-manifest.json',
  '/canvass-icons/icon-192.png',
  '/canvass-icons/icon-512.png',
];

// Only a plain 200 from our own origin is worth keeping. A redirect (e.g. /canvass bounced to /login) or an error is not.
function isCacheable(response) {
  return response && response.status === 200 && !response.redirected && response.type === 'basic';
}

async function putRuntime(request, response) {
  const cache = await caches.open(RUNTIME_CACHE);
  await cache.put(request, response);
  const keys = await cache.keys();
  // keys() is oldest-first: trim from the front.
  for (let i = 0; i < keys.length - RUNTIME_MAX_ENTRIES; i++) await cache.delete(keys[i]);
}

// Install: precache each asset on its own, never keeping a redirected response. No skipWaiting: an update waits until the
// rep taps "New version" (a forced swap could interrupt a half-typed lead).
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(
        PRECACHE_ASSETS.map((url) =>
          fetch(url, { credentials: 'same-origin' }).then((response) => {
            if (isCacheable(response)) return cache.put(url, response);
          })
        )
      )
    )
  );
});

// Activate: clean up old caches. No clients.claim: pages already open keep their current behaviour; the worker takes
// over on the next navigation.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME && name !== RUNTIME_CACHE)
          .map((name) => caches.delete(name))
      );
    })
  );
});

// Fetch event - network first, fallback to cache
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Only our own origin: never touch Google Maps, Supabase or any other host.
  if (url.origin !== self.location.origin) return;

  // Skip API requests - let them fail naturally for offline handling
  if (url.pathname.startsWith('/api/')) return;

  // Next data / RSC payloads are per-navigation and never worth keeping.
  if (url.searchParams.has('_rsc') || url.pathname.startsWith('/_next/data/')) return;

  // Skip the roof-report builder, opportunity pages, and public report share pages —
  // their HTML embeds short-lived signed URLs; a cached copy served offline would render
  // broken images/links and stale report state.
  if (url.pathname.startsWith('/opportunities/') || url.pathname.startsWith('/r/')) return;

  // For navigation requests (HTML pages)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (isCacheable(response)) {
            const responseClone = response.clone();
            event.waitUntil(putRuntime(request, responseClone));
          }
          return response;
        })
        .catch(() => {
          // Return cached version if offline
          return caches.match(request).then((cached) => {
            return cached || caches.match('/canvass');
          });
        })
    );
    return;
  }

  // Hashed Next.js chunks — always network (Vercel CDN); never cache-first
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/_next/image/')) {
    event.respondWith(fetch(request));
    return;
  }

  // For static assets - cache first, network fallback
  if (
    url.pathname.includes('/canvass-icons/') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.jpg') ||
    url.pathname.endsWith('.svg')
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;

        return fetch(request).then((response) => {
          if (isCacheable(response)) {
            const responseClone = response.clone();
            event.waitUntil(putRuntime(request, responseClone));
          }
          return response;
        });
      })
    );
    return;
  }

  // Default: network first
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (isCacheable(response)) {
          const responseClone = response.clone();
          event.waitUntil(putRuntime(request, responseClone));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});

// Background sync for offline leads
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-leads') {
    event.waitUntil(syncOfflineLeads());
  }
});

async function syncOfflineLeads() {
  // This will be triggered when the device comes back online
  // The actual sync logic is handled by the offlineStore in the app
  const clients = await self.clients.matchAll();
  clients.forEach((client) => {
    client.postMessage({ type: 'SYNC_LEADS' });
  });
}

// Push notifications (for future use)
self.addEventListener('push', (event) => {
  if (!event.data) return;

  const data = event.data.json();
  const options = {
    body: data.body || 'New notification',
    icon: '/canvass-icons/icon-192.png',
    badge: '/canvass-icons/icon-192.png',
    vibrate: [100, 50, 100],
    data: {
      url: data.url || '/canvass',
    },
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'Canvass', options)
  );
});

// Listen for skip-waiting from the canvass page after deploy
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Notification click handler
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/canvass';

  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      // Focus existing window if available
      for (const client of clients) {
        if (client.url.includes('/canvass') && 'focus' in client) {
          return client.focus();
        }
      }
      // Open new window
      return self.clients.openWindow(url);
    })
  );
});
