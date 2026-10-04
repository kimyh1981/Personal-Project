// 오프라인 동작용 서비스 워커.
// - 앱 파일: 네트워크 우선(항상 최신), 오프라인이면 캐시
// - /api/ (공공데이터): 절대 캐시하지 않음 — 최신 데이터만 쓴다
// - 글꼴: 캐시 우선
const VERSION = 'rea-v13';
const SHELL = [
  './', 'index.html', 'my.html', 'guide.html', 'manifest.webmanifest', 'css/style.css',
  'js/policy.js', 'js/amount.js', 'js/engine.js', 'js/conditions.js', 'js/vworld.js', 'js/direct.js', 'js/geo.js', 'js/recommend.js', 'js/charts.js', 'js/app.js', 'js/pwa.js', 'js/tiers.js', 'js/mymarket.js', 'js/future.js', 'js/quick.js', 'js/my.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin && url.pathname.includes('/api/')) return; // 공공데이터는 항상 네트워크
  if (/fonts\.(googleapis|gstatic)\.com$|^cdn\.jsdelivr\.net$/.test(url.hostname)) {
    e.respondWith(caches.open(VERSION).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') c.put(req, res.clone());
      return res;
    }));
    return;
  }
  if (url.origin !== location.origin) return;
  if (url.pathname.includes('/media/')) return; // 안내 영상은 크고 구간 요청이라 캐시하지 않는다
  e.respondWith(fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
    return res;
  }).catch(async () => (await caches.match(req, { ignoreSearch: true })) || caches.match('index.html')));
});
