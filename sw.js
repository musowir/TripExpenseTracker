const CACHE_NAME = 'tracker-v1';
const ASSETS = [
  '/',
  '/manifest.json',
  '/icon.png'
];

// Install Lifecycle Event
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

// Network-first fetch strategy
self.addEventListener('fetch', (event) => {
  event.respondWith(
    fetch(event.request).catch(() => {
      return caches.match(event.request);
    })
  );
});

