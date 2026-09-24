const CACHE = 'automation-fiber-trace-v2';
const CORE = [
  '/', '/index.html', '/styles.css', '/app.js', '/manifest.webmanifest', '/assets/app-icon.svg',
  '/data/f14-kgu-c029m-1.geojson', '/data/f14-kgu-c029m-2.geojson',
  '/data/f14-kgu-c029m-3.geojson', '/data/f14-kgu-c029m-4.geojson'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;

  // Network-first keeps Netlify deployments and topology updates fresh.
  event.respondWith(
    fetch(event.request)
      .then(response => {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
