/* SG Lab — Service Worker (وسيط التحقق)
   • الملفات العامة (صفحة الدخول والأيقونات) تُخدَّم من GitHub Pages مباشرة.
   • كل شيء آخر (الدروس، السكربتات، الصور، لوحة المعلم) يُجلب من الخادم مع رمز الجلسة،
     ويُخزَّن للعمل بدون إنترنت. عند الخروج يُمسح كل شيء. */
importScripts('config.js');
const API = self.SG_CONFIG.API;
const CACHE = 'sg-private-v1', IMG = 'sg-private-img';
const SCOPE = new URL(self.registration.scope).pathname;           // مثل /sg-lab/
const PUBLIC = new Set(['', 'index.html', '404.html', 'sw.js', 'config.js', 'manifest.webmanifest', 'logo.svg', 'logo-mark.svg',
  'favicon.svg', 'favicon-16.png', 'favicon-32.png', 'favicon-48.png', 'apple-touch-icon.png', 'og-image.png']);
const isPublic = rel => PUBLIC.has(rel) || /^icons\/[\w.-]+$/.test(rel);
const MIME = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json; charset=utf-8',
  webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml', webmanifest: 'application/manifest+json', txt: 'text/plain; charset=utf-8' };

/* ---- تخزين الرمز (IndexedDB) ---- */
const idb = () => new Promise((res, rej) => { const r = indexedDB.open('sg-auth', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const kvGet = async k => { const d = await idb(); return new Promise(res => { const q = d.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(undefined); }); };
const kvSet = async (k, v) => { const d = await idb(); return new Promise(res => { const t = d.transaction('kv', 'readwrite'); v === undefined ? t.objectStore('kv').delete(k) : t.objectStore('kv').put(v, k); t.oncomplete = () => res(); t.onerror = () => res(); }); };
let TOKEN; const token = async () => (TOKEN !== undefined ? TOKEN : (TOKEN = (await kvGet('token')) || ''));
async function wipe() { TOKEN = ''; await kvSet('token', undefined); const ks = await caches.keys(); await Promise.all(ks.filter(k => k.startsWith('sg-private')).map(k => caches.delete(k))); }

/* عدد نوافذ الموقع المفتوحة (باستثناء نافذة معيّنة إن مُرّر معرّفها). صفر = المتصفح كان مغلقاً */
const liveClients = async (exceptId) => (await self.clients.matchAll({ type: 'window', includeUncontrolled: true })).filter(c => c.id !== exceptId).length;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

const relOf = url => url.pathname.startsWith(SCOPE) ? decodeURIComponent(url.pathname.slice(SCOPE.length)) : null;
const isImg = rel => /^img\/[^/]+\.(webp|png|jpe?g|svg)$/i.test(rel);
const mime = rel => MIME[(rel.split('.').pop() || '').toLowerCase()] || 'application/octet-stream';

async function fromServer(rel, tok) {
  const r = await fetch(API + '/c/' + rel.split('/').map(encodeURIComponent).join('/'), { headers: { 'x-sg-token': tok }, cache: 'no-store' });
  return r;
}

/* منع وميض الواجهة القديمة: يُحقن في <head> من app.html شاشة داكنة بالشعار تغطي الصفحة حتى يكتمل التحميل
   (بعد تشغيل طبقات التصميم الجديدة)، ثم تُزال حين تهدأ الصفحة 0.8 ث بعد اكتمال التحميل. صمام أمان: تزول تلقائياً بعد 12 ثانية (للشبكات/الأجهزة البطيئة كالتطبيق) مهما حدث. */
const GUARD = '<style id="sg-hide">body{visibility:hidden!important}html{background:#070a10}'
  + 'html::before{content:"";position:fixed;inset:0;z-index:2147483647;background:#070a10 url(logo.svg) center/84px 84px no-repeat}@keyframes sgp{50%{opacity:.6}}html::before{animation:sgp 1.3s ease-in-out infinite}</style>'
  + '<script>(function(){var d=0,t,l=0,mo;'
  + 'function s(){if(d)return;d=1;try{mo&&mo.disconnect()}catch(e){}var e=document.getElementById("sg-hide");if(e)e.remove()}'
  + 'function arm(){clearTimeout(t);t=setTimeout(s,800)}'
  + 'try{mo=new MutationObserver(function(){if(l)arm()});mo.observe(document.documentElement,{childList:true,subtree:true})}catch(e){}'
  + 'addEventListener("load",function(){l=1;arm()});'
  + 'setTimeout(s,12000)})()</script>';
async function guardApp(blob) {
  try { const t = await blob.text(); return /<head[^>]*>/i.test(t) ? new Blob([t.replace(/<head[^>]*>/i, m => m + GUARD)], { type: 'text/html' }) : blob; }
  catch (_) { return blob; }
}

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  const rel = relOf(url);
  if (rel === null) return;
  if (isPublic(rel)) {                                                             // العام: شبكة ثم نسخة محفوظة (يعمل الدخول بلا إنترنت)
    if (rel === 'sw.js' || rel === 'config.js') return;
    e.respondWith(fetch(req).then(r => { if (r.ok) { const c = r.clone(); caches.open('sg-public').then(x => x.put(req, c)); } return r; })
      .catch(() => caches.match(req, { ignoreSearch: true }).then(h => h || Response.error())));
    return;
  }
  e.respondWith((async () => {
    const goLogin = () => (req.mode === 'navigate' ? Response.redirect(SCOPE, 302) : new Response('unauthorized', { status: 401 }));
    /* الدخول ينتهي بإغلاق المتصفح: إن لم تكن هناك أي نافذة/تبويب مفتوح للموقع فهذه جلسة متصفح جديدة → امسح الرمز واطلب الكود */
    if (req.mode === 'navigate' && !(await liveClients())) { await wipe(); return goLogin(); }
    const tok = await token();
    if (!tok) return goLogin();
    const cache = await caches.open(isImg(rel) ? IMG : CACHE), key = new Request(url.origin + url.pathname);   // بدون ?query
    if (isImg(rel)) { const hit = await cache.match(key); if (hit) return hit; }
    try {
      const r = await fromServer(rel, tok);
      if (r.status === 401) { await wipe(); return goLogin(); }
      if (r.status === 403 && req.mode === 'navigate') return Response.redirect(SCOPE + 'app.html', 302);   // طالب يفتح صفحة للمعلم
      if (!r.ok) return new Response(await r.text(), { status: r.status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      let blob = await r.blob();
      if (req.mode === 'navigate' && rel === 'app.html') blob = await guardApp(blob);   // لا تُظهر الواجهة القديمة قبل اكتمال الجديدة
      const out = new Response(blob, { status: 200, headers: { 'Content-Type': mime(rel) } });
      cache.put(key, out.clone());
      return out;
    } catch (_) {                                                                    // بدون إنترنت
      const hit = await cache.match(key); if (hit) return hit;
      return req.mode === 'navigate' ? new Response('<meta charset=utf-8><body style="background:#070a10;color:#eaf2fb;font:18px sans-serif;text-align:center;padding:3rem" dir=rtl>لا يوجد اتصال، وهذه الصفحة غير محفوظة للعمل بدون إنترنت.', { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }) : Response.error();
    }
  })());
});

self.addEventListener('message', e => {
  const d = e.data || {}, port = e.ports && e.ports[0], done = v => port && port.postMessage(v);
  if (d.type === 'login') e.waitUntil((async () => { await wipe(); TOKEN = d.token; await kvSet('token', d.token); done({ ok: true }); })());
  else if (d.type === 'alive') e.waitUntil((async () => {                           // هل توجد جلسة دخول حيّة في تبويب آخر؟
    const live = (await liveClients(e.source && e.source.id)) > 0 && !!(await token());
    if (!live) await wipe();                                                         // جلسة متصفح جديدة: امسح الرمز والنسخ المحفوظة
    done({ alive: live });
  })());
  else if (d.type === 'logout') e.waitUntil((async () => { await wipe(); done({ ok: true }); })());
  else if (d.type === 'precache' && Array.isArray(d.urls)) e.waitUntil((async () => {
    const tok = await token(); if (!tok) return;
    const cache = await caches.open(d.images ? IMG : CACHE);
    for (const u of d.urls) {                                                        // واحداً واحداً: لطيف مع الشبكة البطيئة
      try {
        const x = new URL(u, self.registration.scope), rel = relOf(x); if (rel === null || isPublic(rel)) continue;
        const key = new Request(x.origin + x.pathname); if (await cache.match(key)) continue;
        const r = await fromServer(rel, tok); if (r.status === 401) { await wipe(); return; }
        if (r.ok) await cache.put(key, new Response(await r.blob(), { status: 200, headers: { 'Content-Type': mime(rel) } }));
      } catch (_) { /* */ }
    }
  })());
});
