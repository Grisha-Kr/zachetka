// Сервис-воркер: хранит оболочку приложения, чтобы оно быстро открывалось.
// Данные (/api/) никогда не кэшируются.
const VERSION = 'zachetka-v5';
const SHELL = ['/', '/index.html', '/app.css?v=5', '/app.js?v=4', '/vendor/pocketbase.umd.js', '/manifest.webmanifest', '/icons/icon-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/_/')) return;
  // Сначала сеть, при отсутствии связи берём из кэша
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok && (url.pathname === '/' || /\.(html|css|js|woff2|png|webmanifest)$/.test(url.pathname))) {
        const copy = res.clone();
        caches.open(VERSION).then(c => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match(e.request).then(r => r || caches.match('/')))
  );
});
