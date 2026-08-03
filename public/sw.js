// Service Worker：HTML/導覽用 network-first（線上永遠拿最新，離線才回快取）；
// 靜態資源(_astro 有 hash)與題庫圖片用 cache-first；題庫 JSON 用 network-first。
const SHELL = 'gq-shell-v2';
const DATA = 'gq-data-v2';
const SHELL_ASSETS = ['/', '/favicon.svg', '/manifest.webmanifest'];

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
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;

  const isHTML = req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');
  const isData = url.pathname.startsWith('/data/');
  const isImg = url.pathname.startsWith('/data/q-img/');
  const isHashedAsset = url.pathname.startsWith('/_astro/') || url.pathname.startsWith('/pagefind/');

  // 圖片與 hash 過的靜態資源：cache-first（內容不變）
  if (isImg || isHashedAsset) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(isImg ? DATA : SHELL).then((c) => c.put(req, copy));
        return res;
      }))
    );
    return;
  }

  // HTML 導覽 與 題庫 JSON：network-first
  if (isHTML || isData) {
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(isData ? DATA : SHELL).then((c) => c.put(req, copy));
        return res;
      }).catch(() => caches.match(req).then((hit) => hit || caches.match('/')))
    );
    return;
  }

  // 其他：network-first
  e.respondWith(fetch(req).catch(() => caches.match(req)));
});
