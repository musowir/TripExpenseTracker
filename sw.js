const CACHE_NAME = 'settle-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon.png',
  '/assets/css/style.css',
  '/assets/js/tracker.js',
  '/server.py'
];

// Install Lifecycle Event
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Caching app shell');
      return cache.addAll(ASSETS).then(() => {
        console.log('[Service Worker] App shell cached');
        return self.skipWaiting();
      }).catch((error) => {
        console.warn('[Service Worker] Cache.addAll error:', error);
        // Don't fail install if some assets can't be cached
        return self.skipWaiting();
      });
    })
  );
});

// Activate Event to clean old caches
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activating...');
  event.waitUntil(
    caches.keys().then((keys) => {
      console.log('[Service Worker] Found caches:', keys);
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[Service Worker] Deleting old cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => {
      console.log('[Service Worker] Claiming clients');
      return self.clients.claim();
    })
  );
});

// Network-first, fall back to cache
self.addEventListener('fetch', (event) => {
  // Only handle standard HTTP/HTTPS schemes
  if (!event.request.url.startsWith('http')) {
    return;
  }

  // Don't cache non-GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  // Skip API calls - always try network first
  if (event.request.url.includes('/api/')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Clone and cache successful responses
          if (response.status === 200) {
            const cacheCopy = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, cacheCopy);
            });
          }
          return response;
        })
        .catch(() => {
          // Fall back to cache for API calls when offline
          return caches.match(event.request);
        })
    );
    return;
  }

  // For static assets: Network first, fall back to cache
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Cache successful responses dynamically
        if (response.status === 200) {
          const cacheCopy = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, cacheCopy);
          });
        }
        return response;
      })
      .catch(() => {
        // Fall back to cache when offline
        return caches.match(event.request);
      })
  );
});
