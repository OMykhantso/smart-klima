/* Service worker: оболонка застосунку працює офлайн, API завжди з мережі. */
const CACHE = 'smart-klima-v1';
const SHELL = ['./', './index.html', './app.css', './app.js', './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png',
  '../shared/seed.js', '../shared/config.js', '../shared/api.js'];

self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.includes('/api/')) return; // дані лише з мережі
  // network-first: свіжа версія, а без мережі з кешу
  e.respondWith(fetch(e.request).then(res => {
    if (res.ok && url.origin === location.origin) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request)));
});
