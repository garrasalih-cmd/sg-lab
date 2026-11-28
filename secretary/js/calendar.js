/* =====================================================================
   calendar.js — Google Calendar والإشعارات من جهة التطبيق
   • التطبيق لا يرى مفاتيح Google أبدًا: كل شيء يمر عبر دالة الخادم sek
   • أحداث اليوم تُحفظ في الهاتف لتعمل الخطة بلا إنترنت
   ===================================================================== */
import { kvGet, kvSet } from './db.js';
import { callFn, sb, state as syncState, schedule as scheduleSync, configured } from './sync.js';
import { todayStr, addDays } from './util.js';

const cfg = window.SEK_CONFIG || {};

/* ---------- حالة الربط ---------- */
let lastOpenSync = 0;
export const gcal = { known: false, configured: false, connected: false, email: null, tasks_ok: null, tasks_error: null };

export async function refreshStatus() {
  const r = await callFn('status');
  if (!r.error) Object.assign(gcal, { known: true, configured: r.configured, connected: r.connected, email: r.email, tasks_ok: r.tasks_ok, tasks_error: r.tasks_error });
  // عند فتح التطبيق: نسحب جديد Google Tasks والتقويم فورًا (مرة كل 5 دقائق على الأكثر)
  if (gcal.connected && Date.now() - lastOpenSync > 5 * 60_000) { lastOpenSync = Date.now(); syncCalendarNow(); }
  await kvSet('gcal', { ...gcal });
  window.dispatchEvent(new Event('sek:gcal'));
  return gcal;
}
export async function loadCachedStatus() {
  Object.assign(gcal, (await kvGet('gcal')) || {});
}

// ربط حساب Google: نفتح صفحة الموافقة، ثم يعيدنا الخادم إلى التطبيق مع ?gcal=ok
export async function connect() {
  const ret = location.origin + location.pathname;
  const r = await callFn('connect', { return_url: ret });
  if (r.error) return r;
  location.href = r.url;
  return { ok: true };
}
export async function disconnect() {
  const r = await callFn('disconnect');
  await refreshStatus();
  return r;
}

/* ---------- أحداث يوم معيّن (حصصك ومواعيدك) ---------- */
export async function eventsFor(day = todayStr(), { refresh = true } = {}) {
  const key = 'events:' + day;
  const cached = (await kvGet(key)) || null;
  if (!refresh || !gcal.connected || !navigator.onLine) return cached?.events || [];
  const [y, m, d] = day.split('-').map(Number);
  const from = new Date(y, m - 1, d).toISOString();
  const [y2, m2, d2] = addDays(day, 1).split('-').map(Number);
  const to = new Date(y2, m2 - 1, d2).toISOString();
  const r = await callFn('events', { from, to });
  if (r.error || !r.connected) return cached?.events || [];
  await kvSet(key, { at: Date.now(), events: r.events });
  return r.events;
}

/* ---------- مزامنة التقويم بعد تعديل مهام مجدولة (مع تأخير لتجميع التعديلات) ---------- */
let gTimer;
window.addEventListener('sek:calendar-dirty', () => {
  if (!gcal.connected) return;
  clearTimeout(gTimer);
  gTimer = setTimeout(async () => {
    const r = await callFn('sync');
    if (!r.error) scheduleSync(1000);   // نسحب ما كتبه الخادم (أرقام الأحداث، تعديلات التقويم)
  }, 2500);
});
export async function syncCalendarNow() {
  const r = await callFn('sync');
  scheduleSync(500);
  return r;
}

/* =====================================================================
   إشعارات Push
   ===================================================================== */
export const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

const b64ToBytes = b64 => {
  const pad = '='.repeat((4 - b64.length % 4) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
};

export async function pushState() {
  if (!pushSupported) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  return sub ? 'on' : 'off';
}

// تفعيل الإشعارات: إذن المتصفح ⇒ اشتراك Push ⇒ حفظه في Supabase
export async function enablePush() {
  if (!pushSupported) return { error: 'المتصفح لا يدعم الإشعارات' };
  if (!configured || !syncState.user) return { error: 'سجّل الدخول أولًا (☁️ الحساب)' };
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return { error: 'لم تسمح بالإشعارات. فعّلها من إعدادات Chrome ← الإشعارات' };
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(cfg.VAPID_PUBLIC) });
  const j = sub.toJSON();
  const c = await sb();
  const { error } = await c.from('push_subs').upsert({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, user_id: syncState.user.id });
  if (error) return { error: error.message };
  return { ok: true };
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    try { const c = await sb(); await c.from('push_subs').delete().eq('endpoint', sub.endpoint); } catch { /* */ }
    await sub.unsubscribe();
  }
}

export const testPush = () => callFn('test_push');

// تحديث حالة الربط عند كل تسجيل دخول
window.addEventListener('sek:sync', () => {
  if (syncState.user && syncState.status === 'ok' && !gcal._checked) { gcal._checked = true; refreshStatus(); }
});
