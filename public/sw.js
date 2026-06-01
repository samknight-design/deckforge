const CACHE_NAME = 'deckforge-v11';
const STATIC_CACHE = 'deckforge-static-v11';
const DECK_CACHE = 'deckforge-decks-v11';

const STATIC_ASSETS = [
  '/',
  '/home',
  '/scan',
  '/decks',
  '/community',
  '/profile',
];

// Install event — cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch(() => {
        // Non-fatal — some routes may redirect
      });
    })
  );
  self.skipWaiting();
});

// Activate event — clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME && key !== STATIC_CACHE && key !== DECK_CACHE)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Fetch event
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Don't intercept API calls, auth flows, or non-GET requests
  if (
    request.method !== 'GET' ||
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/auth/') ||
    url.pathname.startsWith('/_next/')
  ) {
    return;
  }

  // Cache-first for Scryfall card images
  if (url.hostname === 'cards.scryfall.io' || url.hostname === 'card.scryfall.io') {
    event.respondWith(
      caches.open(DECK_CACHE).then((cache) =>
        cache.match(request).then((cached) => {
          if (cached) return cached;
          return fetch(request).then((response) => {
            if (response.ok) {
              cache.put(request, response.clone());
            }
            return response;
          });
        })
      )
    );
    return;
  }

  // Network-first for app pages, fallback to cache
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
  }
});

// Background sync for offline-queued actions
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-deck-changes') {
    // Future: sync offline changes
    event.waitUntil(Promise.resolve());
  }
});
