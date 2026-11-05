/* Offline support. Every file of the app is cached when the service worker installs, so the app opens without a
   connection. A new version (bump VERSION here and in js/app.js) caches its files afresh and removes the old cache;
   the open app keeps running and uses it from its next start. Nothing else is fetched or stored here: the goals
   live in the browser's localStorage. */

const VERSION = '1.0.0';
const CACHE = `questline-pocket-${VERSION}`;
const FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/tokens.css',
  'css/base.css',
  'css/components.css',
  'css/screens.css',
  'css/screens-2.css',
  'css/app.css',
  'js/app.js',
  'js/dates.js',
  'js/format.js',
  'js/icons.js',
  'js/model.js',
  'js/screens.js',
  'js/store.js',
  'js/ui.js',
  'js/validate.js',
  'fonts/fraunces-latin-full-normal.woff2',
  'icons/favicon.svg',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'LICENSES/Fraunces-OFL.txt',
  'LICENSES/Lucide-ISC.txt',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(FILES.map((file) => new Request(file, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('questline-pocket-') && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    caches
      .match(request, { ignoreSearch: true })
      .then((cached) => cached ?? fetch(request))
      .catch(() => (request.mode === 'navigate' ? caches.match('./') : Response.error())),
  );
});
