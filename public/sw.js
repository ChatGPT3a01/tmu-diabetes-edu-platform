// PWA Service Worker：靜態檔快取（可離線開啟）；研究 API 一律走網路，不快取
// 使用相對路徑，可同時在網站根目錄與 GitHub Pages 子路徑運作
const CACHE = 'dm-edu-v8';
const SHELL = ['./', 'index.html', 'config.js', 'css/app.css', 'js/app.js', 'js/widgets.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/tmu-logo.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.pathname.includes('/api/')) {
    // 衛教內容：網路優先，離線時用快取（可跨網域到後端）
    if (url.pathname.endsWith('/api/content')) {
      e.respondWith(fetch(e.request).then(r => { if (r.ok) { const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); } return r; }).catch(() => caches.match(e.request)));
    }
    return;
  }
  if (url.origin !== location.origin || url.pathname.includes('/admin')) return;
  // config.js 網路優先（後端網址變更時立即生效）；其他靜態檔先回快取、背景更新
  if (url.pathname.endsWith('/config.js')) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }
  e.respondWith(caches.match(e.request).then(hit => {
    const net = fetch(e.request).then(r => { if (r.ok) { const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); } return r; }).catch(() => hit || caches.match('index.html'));
    return hit || net;
  }));
});
