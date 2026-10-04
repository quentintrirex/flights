/* Service worker: push notifications and a tiny offline shell. */
const CACHE = 'flights-v6';
const SHELL = ['./', 'assets/app.css', 'assets/app.js', 'places.php', 'assets/icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Network first (prices must be fresh); the cached shell is only for when there is no connection.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.endsWith('api.php')) return;
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('./'))));
});

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data.json(); } catch { d = { title: 'Flights', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(Promise.all([
    self.registration.showNotification(d.title || 'Cheap flight found', {
      body: d.body || '', tag: d.tag, renotify: true, icon: 'assets/icon-192.png', badge: 'assets/icon-192.png', data: { url: d.url || './' },
    }),
    navigator.setAppBadge ? navigator.setAppBadge().catch(() => {}) : null,
  ]));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL(e.notification.data?.url || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) {
      if (c.url.startsWith(self.registration.scope)) { c.postMessage({ url: target }); return c.focus(); }
    }
    return self.clients.openWindow(target);
  }));
});
