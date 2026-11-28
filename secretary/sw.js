/* =====================================================================
   sw.js — Service Worker (عامل الخدمة)
   برنامج صغير يعمل بين التطبيق والإنترنت:
   • يحفظ ملفات التطبيق في الهاتف ⇒ يفتح بدون إنترنت.
   • استراتيجية "Stale-While-Revalidate": يعرض النسخة المحفوظة فورًا،
     ويجلب النسخة الجديدة في الخلفية ⇒ التحديثات تظهر في الفتح التالي.
   • طلبات Supabase (البيانات) لا تُخزَّن هنا؛ المزامنة تتولاها sync.js.
   ===================================================================== */
const VERSION = 'v1';
const SHELL = 'sek-shell-' + VERSION;   // ملفات التطبيق
const RUNTIME = 'sek-runtime';          // الخط ومكتبة Supabase من CDN

const ASSETS = [
  './', './index.html', './css/style.css', './config.js', './manifest.webmanifest',
  './js/app.js', './js/db.js', './js/store.js', './js/sync.js', './js/voice.js', './js/util.js',
  './icons/icon-192.png', './icons/icon-512.png'
];

// التثبيت: نحفظ ملفات التطبيق مسبقًا (precache)
self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

// التفعيل: نحذف الإصدارات القديمة ونتحكم بالصفحات المفتوحة فورًا
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

  // ملفات التطبيق نفسه
  if (url.origin === self.location.origin) {
    // أي فتح لصفحة (حتى /share-target?text=...) ⇒ index.html
    const key = req.mode === 'navigate' ? INDEX : req;
    e.respondWith(staleWhileRevalidate(e, key, req.mode === 'navigate' ? INDEX : req));
    return;
  }
  // الخط والمكتبة: نحفظها مرة واحدة (cache-first) لأن روابطها ثابتة الإصدار
  if (CDN_HOSTS.includes(url.hostname)) {
    e.respondWith(cacheFirst(req));
  }
  // كل ما عدا ذلك (Supabase مثلًا) يمر مباشرة للإنترنت
});

async function staleWhileRevalidate(event, key, fetchTarget) {
  const cache = await caches.open(SHELL);
  const cached = await cache.match(key, { ignoreSearch: true });
  const network = fetch(fetchTarget).then(res => {
    if (res.ok) cache.put(key, res.clone());
    return res;
  }).catch(() => null);
  event.waitUntil(network);          // نكمل التحديث حتى بعد الرد
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
