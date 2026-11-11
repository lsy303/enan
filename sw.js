/* عِنان: يجعل التطبيق قابلًا للتثبيت، ويفتحه بسرعة حتى مع إنترنت ضعيف.
   لا يخزّن بيانات الإسطبل؛ Firebase يتولى حفظها ومزامنتها بنفسه. */
const VERSION = 'enan-v4';
const SHELL = [
  './', './index.html', './app.html', './demo.html', './manifest.webmanifest',
  './icons/enan-192.png', './icons/enan-512.png', './icons/apple-touch-icon.png', './icons/favicon.png',
  './icons/suhub-lockup.png', './icons/suhub-lockup-white.png',
];
// مكتبات خارجية ثابتة الإصدار: آمنة للتخزين
const STATIC_HOSTS = ['www.gstatic.com', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // الصفحات: الشبكة أولًا (لتصل التحديثات فورًا)، والنسخة المخزّنة عند انقطاع الإنترنت
  if (req.mode === 'navigate' && url.origin === location.origin) {
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        if (res.ok) caches.open(VERSION).then((c) => c.put(url.origin + url.pathname, copy));
        return res;
      }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('./app.html')))
    );
    return;
  }

  // الملفات الثابتة: من المخزن فورًا، وتحديثها في الخلفية
  const sameOrigin = url.origin === location.origin;
  if (sameOrigin || STATIC_HOSTS.includes(url.hostname)) {
    e.respondWith(
      caches.match(req).then((cached) => {
        const net = fetch(req).then((res) => {
          if (res && (res.ok || res.type === 'opaque')) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
          return res;
        }).catch(() => cached);
        return cached || net;
      })
    );
  }
  // كل ما عدا ذلك (Firebase وغيره) يمر مباشرة بلا تدخل
});
