const CACHE = 'automation-fiber-trace-v1';
const CORE = ['/', '/index.html', '/styles.css', '/app.js', '/manifest.webmanifest', '/assets/app-icon.svg', '/data/f14-kgu-c029m-1.geojson', '/data/f14-kgu-c029m-2.geojson', '/data/f14-kgu-c029m-3.geojson', '/data/f14-kgu-c029m-4.geojson'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const u = new URL(e.request.url);
  if (u.pathname.startsWith('/data/')) {
    e.respondWith(fetch(e.request).then(r => { const copy=r.clone(); caches.open(CACHE).then(c=>c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request)));
    return;
  }
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => { if (u.origin === location.origin) { const copy=r.clone(); caches.open(CACHE).then(c=>c.put(e.request,copy)); } return r; })));
});
