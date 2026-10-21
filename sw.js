const CACHE_NAME = 'pictameal-shell-v29';
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './backend/field-defaults.js',
  './voice-match.js',
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
  // cache: 'reload' skips the browser's HTTP cache, so a new version never
  // installs with an older file mixed in
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL.map(url => new Request(url, { cache: 'reload' }))))
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

// The page and its code are network-first: an old cached index.html must
// never run with a newer script.js (or the other way round) — that breaks
// the page. They come from the cache only when the network fails (offline).
// Images and icons stay cache-first.
const NETWORK_FIRST = ['index.html', 'script.js', 'style.css', 'calorie.js', 'sync.js', 'manifest.json', 'sw.js', 'backend/field-defaults.js', 'voice-match.js'];
function isNetworkFirst(request, url){
  if (request.mode === 'navigate') return true;
  const scope = new URL(self.registration.scope).pathname;
  const file = url.pathname.startsWith(scope) ? url.pathname.slice(scope.length) : '';
  return file === '' || NETWORK_FIRST.includes(file);
}

function putInCache(request, response){
  if (!response || !response.ok || response.type !== 'basic') return;
  const copy = response.clone();
  caches.open(CACHE_NAME).then(cache => cache.put(request, copy)).catch(() => {});
}

async function networkFirst(request){
  try {
    // cache: 'no-cache' revalidates with the server, so the browser's HTTP
    // cache (GitHub Pages: max-age 600) can't hand back an older copy either;
    // a navigation is re-issued by URL (redirect: 'manual' as navigations need)
    const response = await fetch(request.mode === 'navigate'
      ? new Request(request.url, { cache: 'no-cache', credentials: 'same-origin', redirect: 'manual' })
      : new Request(request, { cache: 'no-cache' }));
    putInCache(request, response);
    return response;
  } catch (err){
    // offline: the cached copy; a navigation with ?group=… falls back to the
    // cached page without the query, then to index.html
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request)
      || (request.mode === 'navigate' ? (await cache.match(request, { ignoreSearch: true })) || (await cache.match('./index.html')) : null);
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request){
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  putInCache(request, response);
  return response;
}

// The research admin page is never cached nor intercepted (always the network).
const ADMIN_FILES = ['admin.html', 'admin.js', 'admin.css', 'admin-stats.js'];
function isAdminFile(url){
  const scope = new URL(self.registration.scope).pathname;
  return url.pathname.startsWith(scope) && ADMIN_FILES.includes(url.pathname.slice(scope.length));
}

self.addEventListener('fetch', event => {
  if (IS_LOCAL) return; // never intercept locally: the browser fetches from the network
  const requestUrl = new URL(event.request.url);
  if (event.request.method !== 'GET' || requestUrl.origin !== self.location.origin) return;
  if (isAdminFile(requestUrl)) return;
  event.respondWith(isNetworkFirst(event.request, requestUrl) ? networkFirst(event.request) : cacheFirst(event.request));
});
