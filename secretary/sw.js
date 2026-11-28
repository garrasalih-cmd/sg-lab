/* =====================================================================
   sw.js — Service Worker (عامل الخدمة)
   • يحفظ ملفات التطبيق في الهاتف ⇒ يفتح بدون إنترنت
   • "Stale-While-Revalidate": يعرض النسخة المحفوظة فورًا ويجلب الجديدة في الخلفية
   • يستقبل إشعارات Push ويعرضها، ويفتح الشاشة المناسبة عند النقر
   ===================================================================== */
const VERSION = 'v7';
const SHELL = 'sek-shell-' + VERSION;
const RUNTIME = 'sek-runtime';

const ASSETS = [
  './', './index.html', './css/style.css', './config.js', './manifest.webmanifest',
  './js/app.js', './js/db.js', './js/store.js', './js/sync.js', './js/voice.js', './js/util.js',
  './js/ui.js', './js/home.js', './js/morning.js', './js/planner.js', './js/plan.js',
  './js/focus.js', './js/review.js', './js/settings.js', './js/calendar.js',
  './icons/icon-192.png', './icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('sek-shell-') && k !== SHELL).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

const INDEX = new URL('./index.html', self.registration.scope).href;
const CDN_HOSTS = ['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    // أي فتح لصفحة التطبيق (حتى /share-target?text=...) ⇒ index.html
    // أما الصفحات المستقلة (مثل privacy.html) فتُعرض كما هي
    const standalone = /\.html$/.test(url.pathname) && !url.pathname.endsWith('/index.html');
    const nav = req.mode === 'navigate' && !standalone;
    e.respondWith(staleWhileRevalidate(e, nav ? INDEX : req, nav ? INDEX : req));
    return;
  }
  if (CDN_HOSTS.includes(url.hostname)) e.respondWith(cacheFirst(req));
  // Supabase وغيره: مباشرة للإنترنت
});

async function staleWhileRevalidate(event, key, fetchTarget) {
  const cache = await caches.open(SHELL);
  const cached = await cache.match(key, { ignoreSearch: true });
  const network = fetch(fetchTarget).then(res => {
    if (res.ok) cache.put(key, res.clone());
    return res;
  }).catch(() => null);
  event.waitUntil(network);
  return cached || (await network) || new Response('أنت بلا إنترنت ولم يُحفظ هذا الملف بعد', {
    status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
}

async function cacheFirst(req) {
  const cache = await caches.open(RUNTIME);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
    return res;
  } catch {
    return new Response('', { status: 504 });
  }
}

/* ---------- إشعارات Push (المرحلة 4) ---------- */
self.addEventListener('push', e => {
  let data = {};
  try { data = e.data.json(); } catch { data = { title: 'سكرتيري', body: e.data?.text() || '' }; }
  e.waitUntil(self.registration.showNotification(data.title || 'سكرتيري', {
    body: data.body || '',
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    tag: data.tag || 'sek',
    data: { url: data.url || './' },
    dir: 'rtl', lang: 'ar',
    vibrate: [120, 60, 120]
  }));
});

// النقر على الإشعار: نفتح التطبيق على الشاشة المطلوبة (أو نركّز على النافذة المفتوحة)
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || './', self.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = wins.find(w => w.url.startsWith(self.registration.scope));
    if (win) { await win.focus(); win.postMessage({ type: 'open', url }); }
    else await self.clients.openWindow(url);
  })());
});
