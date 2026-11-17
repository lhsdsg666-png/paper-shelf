const scope = new URL(self.registration.scope);
const namespace = 'paper-shelf-shell:' + scope.pathname + ':';
const cacheName = namespace + SHELL_REVISION;
const shell = SHELL_FILES.map(path => new URL(path, scope).href);
const assets = new Set(shell);

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    await cache.addAll(shell.map(url => new Request(url, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith(namespace) && name !== cacheName) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== scope.origin) return;

  const appNavigation = request.mode === 'navigate' &&
    (url.pathname === scope.pathname || url.pathname === scope.pathname + 'index.html');
  const cachedUrl = appNavigation ? scope.href : url.href;
  if (!assets.has(cachedUrl)) return;

  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    return await cache.match(cachedUrl) || fetch(request);
  })());
});
