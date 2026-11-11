/**
 * Service Worker: powłoka aplikacji działa offline.
 * Strategia dla plików aplikacji: najpierw sieć (zawsze świeża wersja), przy braku sieci – cache.
 * Żądania do API (inny origin) nie są tu obsługiwane – dane offline trzyma aplikacja w IndexedDB.
 */
const VERSION = 'planer-v7';
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/api.js',
  'js/db.js',
  'js/state.js',
  'js/ui.js',
  'js/labels.js',
  'js/substitutes.js',
  'js/timers.js',
  'js/diag.js',
  'js/views/cookmode.js',
  'js/views/editor.js',
  'js/util.js',
  'js/views/today.js',
  'js/views/week.js',
  'js/views/shopping.js',
  'js/views/cooking.js',
  'js/views/recipes.js',
  'js/views/settings.js',
  'icons/icon-192.png',
  'icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.endsWith('/api')) return;

  event.respondWith(
    // no-cache: zawsze pytamy serwer (ETag), żeby nie mieszać starych i nowych plików po aktualizacji
    fetch(req, { cache: 'no-cache' })
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then(c => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true })
        .then(hit => hit || (req.mode === 'navigate' ? caches.match('index.html') : Response.error())))
  );
});
