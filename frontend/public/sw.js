// Minimal service worker for PWA installability.
// Caches the app shell for offline launch, then falls back to network.

const CACHE_NAME = "edxo-voice-v1";
const SHELL_URLS = ["/voice"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  // Network-first strategy: try network, fall back to cache
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
