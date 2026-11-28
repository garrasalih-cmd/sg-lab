/* =====================================================================
   sync.js — المزامنة مع Supabase + الإعدادات + استدعاء دالة الخادم
   الفكرة (Offline-first = الهاتف أولًا):
     ① رفع (push): كل مهمة dirty تُرسل للسحابة (upsert = إدراج أو تحديث)
     ② سحب (pull): نطلب ما تغيّر في السحابة منذ آخر مزامنة (synced_at)
   متى؟ عند فتح التطبيق، بعد كل تعديل (بعد ثانية ونصف)، عند عودة الإنترنت،
        وكل 5 دقائق ما دام التطبيق مفتوحًا.
   التعارض: "الأحدث يفوز" حسب updated_at (مطبّق هنا وفي الخادم أيضًا).
   ===================================================================== */
import { getAllTasks, getTask, putTask, clearTasks, kvGet, kvSet, kvDel } from './db.js';
import { DEFAULT_TIMETABLE } from './util.js';

// مكتبة Supabase تُحمَّل من CDN عند الحاجة فقط (ويخزّنها Service Worker للأوفلاين)
const LIB_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm';
const cfg = window.SEK_CONFIG || {};
export const configured = !!(cfg.SUPABASE_URL && cfg.SUPABASE_KEY);

// الأعمدة التي يرسلها الهاتف (dirty خاص بالهاتف، وأعمدة gcal_* يكتبها الخادم فقط)
const COLS = ['id', 'title', 'category', 'due_date', 'due_time', 'importance', 'duration_min', 'status', 'plan_date',
  'postpone_count', 'order_index', 'source', 'completed_at', 'deleted', 'created_at', 'updated_at',
  'sched_start', 'recur', 'parent_id', 'focus_min', 'remind_min', 'school', 'grade_total', 'grade_done', 'grade_min'];
const READ_ONLY = ['gcal_event_id', 'gtask_id'];   // يكتبها الخادم فقط

/* ---------- الحالة المعروضة في الواجهة ----------
   status: local (بدون حساب) | offline | syncing | ok | error */
export const state = { status: 'local', user: null, lastSync: null, error: null };
const notify = () => window.dispatchEvent(new Event('sek:sync'));
const setStatus = (status, error = null) => { state.status = status; state.error = error; notify(); };

let client = null;
export async function sb() {
  if (!configured) return null;
  if (client) return client;
  const { createClient } = await import(LIB_URL);
  client = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  client.auth.onAuthStateChange((event, session) => {
    state.user = session?.user || null;
    if (!state.user) setStatus('local'); else notify();
    if (event === 'SIGNED_IN') schedule(0);
  });
  return client;
}

/* ---------- تحويل بين شكل الهاتف وشكل الخادم ---------- */
const toRow = (t, uid) => {
  const row = { user_id: uid };
  for (const c of COLS) row[c] = t[c] ?? null;
  row.postpone_count = t.postpone_count || 0;
  row.focus_min = t.focus_min || 0;
  row.grade_done = t.grade_done || 0;   // العمود في القاعدة لا يقبل null
  row.deleted = !!t.deleted;
  return row;
};
const iso = v => (v ? new Date(v).toISOString() : null);
const fromRow = r => {
  const t = {};
  for (const c of [...COLS, ...READ_ONLY]) t[c] = r[c] ?? null;
  t.due_time = r.due_time ? r.due_time.slice(0, 5) : null;  // الخادم يعيد 14:00:00
  for (const c of ['created_at', 'updated_at', 'completed_at', 'sched_start']) t[c] = iso(r[c]);
  t.postpone_count = r.postpone_count || 0;
  t.focus_min = r.focus_min || 0;
  t.dirty = 0;
  return t;
};

/* =====================================================================
   الإعدادات (صف واحد لكل مستخدم في جدول settings)
   ===================================================================== */
export const DEFAULT_SETTINGS = {
  name: 'صالح', tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Jerusalem',
  day_start: '07:30', day_end: '22:00', morning_time: '06:30', evening_time: '20:30',
  push_morning: true, push_evening: true, push_reminders: true,
  timetable: DEFAULT_TIMETABLE,   // جدول الحصص 🏫 (مدرستان)
  grading_goal: 20,              // 📝 الهدف اليومي للتصحيح
  grade_log: {}                  // أوراق كل يوم
};
let settingsCache = null;
export async function getSettings() {
  if (!settingsCache) settingsCache = { ...DEFAULT_SETTINGS, ...((await kvGet('settings')) || {}) };
  return settingsCache;
}
export async function saveSettings(patch) {
  settingsCache = { ...(await getSettings()), ...patch, updated_at: new Date().toISOString() };
  await kvSet('settings', settingsCache);
  await kvSet('settings_dirty', 1);
  window.dispatchEvent(new Event('sek:settings'));
  schedule();
}
const SETTING_COLS = ['name', 'tz', 'day_start', 'day_end', 'morning_time', 'evening_time', 'push_morning', 'push_evening', 'push_reminders', 'timetable', 'grading_goal', 'grade_log'];
async function syncSettings(c, uid) {
  if (await kvGet('settings_dirty')) {
    const s = await getSettings();
    const row = { user_id: uid, updated_at: s.updated_at || new Date().toISOString() };
    for (const k of SETTING_COLS) row[k] = s[k];
    const { error } = await c.from('settings').upsert(row);
    if (error) throw error;
    await kvDel('settings_dirty');
  } else {
    const { data } = await c.from('settings').select('*').eq('user_id', uid).maybeSingle();
    if (data) {
      const s = { ...(await getSettings()) };
      for (const k of SETTING_COLS) if (data[k] != null) s[k] = typeof data[k] === 'string' && /^\d\d:\d\d:\d\d$/.test(data[k]) ? data[k].slice(0, 5) : data[k];
      settingsCache = s; await kvSet('settings', s);
      window.dispatchEvent(new Event('sek:settings'));
    } else {
      await kvSet('settings_dirty', 1);   // أول مرة: نرفع الإعدادات الافتراضية
    }
  }
}

/* =====================================================================
   المزامنة الكاملة
   ===================================================================== */
let running = false, again = false, timer = null;

export async function syncNow() {
  if (running) { again = true; return; }
  if (!configured) return setStatus('local');
  if (!navigator.onLine) return setStatus(state.user ? 'offline' : 'local');

  running = true;
  try {
    const c = await sb();
    const { data: { session } } = await c.auth.getSession();
    if (!session) { state.user = null; return setStatus('local'); }
    state.user = session.user;
    const uid = session.user.id;
    setStatus('syncing');

    // ① رفع التعديلات المحلية
    const dirty = (await getAllTasks()).filter(t => t.dirty);
    let calendarRelevant = false;
    if (dirty.length) {
      const { error } = await c.from('tasks').upsert(dirty.map(t => toRow(t, uid)));
      if (error) throw error;
      for (const t of dirty) {
        if (t.sched_start || t.gcal_event_id || t.gtask_id) calendarRelevant = true;   // التقويم أو Google Tasks
        const cur = await getTask(t.id);
        if (cur && cur.updated_at === t.updated_at) { cur.dirty = 0; await putTask(cur); }
      }
    }

    // ② سحب ما تغيّر في السحابة (على دفعات من 1000)
    const key = 'cursor:' + uid;
    let cursor = (await kvGet(key)) || '1970-01-01T00:00:00Z';
    let pulled = 0;
    for (;;) {
      const { data, error } = await c.from('tasks').select('*')
        .gt('synced_at', cursor).order('synced_at', { ascending: true }).limit(1000);
      if (error) throw error;
      for (const r of data) {
        const local = await getTask(r.id);
        const remote = fromRow(r);
        if (!local || !local.dirty || Date.parse(remote.updated_at) >= Date.parse(local.updated_at)) {
          await putTask(remote); pulled++;
        }
        cursor = r.synced_at;
      }
      if (data.length < 1000) break;
    }
    await kvSet(key, cursor);
    await syncSettings(c, uid);
    if (pulled) window.dispatchEvent(new Event('sek:tasks-remote'));
    // تغيّرت مهام مجدولة ⇒ نطلب من الخادم تحديث Google Calendar
    if (calendarRelevant) window.dispatchEvent(new Event('sek:calendar-dirty'));

    state.lastSync = new Date();
    setStatus('ok');
  } catch (e) {
    console.warn('sync failed', e);
    setStatus(navigator.onLine ? 'error' : 'offline', e?.message || String(e));
  } finally {
    running = false;
    if (again) { again = false; schedule(500); }
  }
}

export function schedule(delay = 1500) {
  clearTimeout(timer);
  timer = setTimeout(syncNow, delay);
}

/* ---------- استدعاء دالة الخادم sek (Google Calendar، الإشعارات) ---------- */
export async function callFn(action, body = {}) {
  if (!configured || !navigator.onLine) return { error: 'offline' };
  const c = await sb();
  const { data: { session } } = await c.auth.getSession();
  if (!session) return { error: 'signed_out' };
  const { data, error } = await c.functions.invoke('sek', { body: { action, ...body } });
  if (error) {
    let msg = error.message;
    try { msg = (await error.context.json()).error || msg; } catch { /* */ }
    return { error: msg };
  }
  return data;
}

/* ---------- الحساب: دخول / حساب جديد / خروج ---------- */
const AUTH_ERR = {
  'Invalid login credentials': 'البريد أو كلمة المرور غير صحيحة',
  'Email not confirmed': 'افتح رسالة التأكيد في بريدك أولًا، ثم ادخل هنا',
  'User already registered': 'هذا البريد مسجّل مسبقًا، اضغط «دخول»',
  'Password should be at least 6 characters': 'كلمة المرور 6 أحرف على الأقل',
  'Failed to fetch': 'تعذّر الاتصال بالخادم، تأكد من الإنترنت'
};
const authMsg = e => AUTH_ERR[e?.message] || (navigator.onLine ? (e?.message || 'حدث خطأ') : 'لا يوجد إنترنت');

export async function signIn(email, password) {
  try {
    const c = await sb();
    const { error } = await c.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return { ok: true };
  } catch (e) { return { ok: false, msg: authMsg(e) }; }
}

export async function signUp(email, password) {
  try {
    const c = await sb();
    const { data, error } = await c.auth.signUp({
      email, password, options: { emailRedirectTo: location.origin + location.pathname }
    });
    if (error) throw error;
    return { ok: true, needsConfirm: !data.session };
  } catch (e) { return { ok: false, msg: authMsg(e) }; }
}

// الخروج: نمسح المهام من هذا الهاتف (تبقى في السحابة) حتى لا تختلط بحساب آخر
export async function signOut() {
  const c = await sb();
  const uid = state.user?.id;
  await c.auth.signOut();
  if (uid) await kvDel('cursor:' + uid);
  await clearTasks();
  state.user = null;
  setStatus('local');
  window.dispatchEvent(new Event('sek:tasks-remote'));
}

export async function hasUnsynced() {
  return (await getAllTasks()).some(t => t.dirty);
}

/* ---------- التشغيل ---------- */
export async function init() {
  window.addEventListener('online', () => schedule(0));
  window.addEventListener('offline', () => setStatus(state.user ? 'offline' : 'local'));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') schedule(300); });
  setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 5 * 60 * 1000);
  if (configured) {
    try { await sb(); } catch { return setStatus('local'); }
    schedule(0);
  }
}
