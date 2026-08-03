// 簡易 Service Worker：應用外殼 cache-first、題庫資料 network-first（可離線複習看過的內容）
const SHELL = 'gq-shell-v1';
const DATA = 'gq-data-v1';
const SHELL_ASSETS = ['/', '/practice', '/mock', '/random', '/records', '/search', '/favicon.svg', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== SHELL && k !== DATA).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  // 題庫資料與圖片：network-first，成功則存快取，失敗則回快取
  if (url.pathname.startsWith('/data/')) {
    e.respondWith(
      fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(DATA).then((c) => c.put(e.request, copy));
        return res;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // 其他（HTML/JS/CSS）：cache-first，背景更新
  e.respondWith(
    caches.match(e.request).then((hit) =>
      hit || fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(SHELL).then((c) => c.put(e.request, copy));
        return res;
      }).catch(() => hit)
    )
  );
});
