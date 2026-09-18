const CACHE = 'yueji-shell-20260918-r2';
const SHELL = [
  './',
  './index.html',
  './style.css',
  './yueji-theme.css',
  './yueji-notes-chapters.css',
  './manifest.json',
  './yueji-core.js',
  './yueji-release-ui.js',
  './yueji-notes-chapters.js',
  './app.js',
  './yueji-extension.js',
  './yueji-p1-identity-migration.js',
  './yueji-weread-date-evidence.js',
  './yueji-layout.js',
  './yueji-book-cover.js',
  './yueji-onboarding.js',
  './yueji-features.js',
  './vendor/jszip.min.js',
  './vendor/sql-asm.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/.netlify/functions/'))
    return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request, { ignoreSearch: true });
        if (cached) return cached;
        if (request.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      }),
  );
});
