// PWA Service Worker：靜態檔快取（可離線開啟）；研究 API 一律走網路，不快取
const CACHE = 'dm-edu-v4';
const SHELL = ['/', '/index.html', '/css/app.css', '/js/app.js', '/js/widgets.js', '/manifest.webmanifest', '/icons/icon.svg', '/icons/icon-192.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/admin')) return;
  if (url.pathname.startsWith('/api/')) {
    if (url.pathname === '/api/content') {
      // 內容：網路優先，離線時用快取
      e.respondWith(fetch(e.request).then(r => { const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request)));
    }
    return;
  }
  // 靜態檔：先回快取、背景更新
  e.respondWith(caches.match(e.request).then(hit => {
    const net = fetch(e.request).then(r => { if (r.ok) { const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); } return r; }).catch(() => hit || caches.match('/index.html'));
    return hit || net;
  }));
});
