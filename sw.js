const CACHE_NAME = 'pictameal-shell-v21';
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './calorie.js',
  './sync.js',
  './script.js',
  './home-illustration.png',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
  './icons/apple-touch-icon.png'
];

// Local preview (VS Code Live Server / Simple Browser, http-server …): no
// caching and no request interception at all — every file comes straight from
// the network, so an edit shows on the next reload. On activation this worker
// deletes every cache of this origin and reloads the open pages once (that is
// what replaces an older caching worker left installed there); the freshly
// loaded index.html then unregisters it. The live site (lima-cgu.github.io)
// keeps the offline cache below.
const IS_LOCAL = ['localhost', '127.0.0.1', '[::1]'].includes(self.location.hostname);

self.addEventListener('install', event => {
  if (IS_LOCAL){
    event.waitUntil(self.skipWaiting());
    return;
  }
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  if (IS_LOCAL){
    event.waitUntil((async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map(key => caches.delete(key)));
      // take over pages an older caching worker still controls and load them
      // fresh once; the fresh index.html then unregisters this worker
      await self.clients.claim();
      const pages = await self.clients.matchAll({ type: 'window' });
      pages.forEach(page => page.navigate(page.url).catch(() => {}));
    })());
    return;
  }
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (IS_LOCAL) return; // never intercept locally: the browser fetches from the network
  const requestUrl = new URL(event.request.url);
  if (event.request.method !== 'GET' || requestUrl.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
      return response;
    }))
  );
});
