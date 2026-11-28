// =====================================================================
// google.ts — كل ما يخص Google Calendar
//  • OAuth: ربط حساب Google مرة واحدة (نحفظ refresh_token في الخادم فقط)
//  • قراءة أحداث اليوم من تقاويمك (الحصص والمواعيد)
//  • مزامنة ثنائية مع تقويم «سكرتيري»
// =====================================================================
import { admin, SB_URL, localParts, getSettings } from './shared.ts';
import { syncGoogleTasks } from './gtasks.ts';

const CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID') ?? '';
const CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET') ?? '';
export const REDIRECT_URI = `${SB_URL}/functions/v1/sek`;
export const googleConfigured = () => !!(CLIENT_ID && CLIENT_SECRET);

// التقويم (قراءة وكتابة) + Google Tasks (قراءة وكتابة)
const SCOPES = 'openid email https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/tasks';
const CAL_NAME = 'سكرتيري';
const CAT_LABEL: Record<string, string> = { school: '🏫 مدرسة', home: '🏠 بيت', family: '👨‍👩‍👧 عائلة', personal: '👤 شخصي' };
const CAT_COLOR: Record<string, string> = { school: '9', home: '5', family: '4', personal: '3' }; // ألوان Google

// deno-lint-ignore no-explicit-any
type Tok = any;
// deno-lint-ignore no-explicit-any
type Task = any;
const enc = encodeURIComponent;

/* ---------------- OAuth ---------------- */

// الخطوة 1: نصنع رابط صفحة موافقة Google
export async function startConnect(userId: string, returnUrl: string) {
  const state = crypto.randomUUID() + crypto.randomUUID();
  await admin.from('oauth_states').insert({ state, user_id: userId, return_url: returnUrl });
  const q = new URLSearchParams({
    client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, response_type: 'code', scope: SCOPES,
    access_type: 'offline',   // نريد refresh_token للعمل في الخلفية
    prompt: 'consent', include_granted_scopes: 'true', state
  });
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + q;
}

// الخطوة 2: Google يعيدك إلى هنا مع code ⇒ نبدّله بمفاتيح ونعيدك للتطبيق
export async function handleCallback(url: URL): Promise<Response> {
  const state = url.searchParams.get('state') ?? '';
  const { data: st } = await admin.from('oauth_states').select('*').eq('state', state).maybeSingle();
  if (st) await admin.from('oauth_states').delete().eq('state', state);
  if (!st || Date.now() - Date.parse(st.created_at) > 15 * 60_000) {
    return new Response('انتهت صلاحية الطلب. ارجع إلى التطبيق وحاول مرة أخرى.', { status: 400, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
  const back = (status: string) => {
    const u = new URL(st.return_url); u.searchParams.set('gcal', status);
    return Response.redirect(u.toString(), 302);
  };
  const code = url.searchParams.get('code');
  if (!code) return back('denied');

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: REDIRECT_URI, grant_type: 'authorization_code' })
  });
  const j = await r.json();
  if (!r.ok || !j.refresh_token) { console.error('token exchange', j); return back('error'); }

  // البريد من id_token (JWT): الجزء الأوسط Base64URL
  let email = null;
  try { email = JSON.parse(atob(j.id_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).email; } catch { /* ignore */ }

  const { data: old } = await admin.from('google_tokens').select('calendar_id').eq('user_id', st.user_id).maybeSingle();
  const tok: Tok = {
    user_id: st.user_id, email, refresh_token: j.refresh_token, access_token: j.access_token,
    expires_at: new Date(Date.now() + j.expires_in * 1000).toISOString(),
    calendar_id: old?.calendar_id ?? null, sync_token: null
  };
  await admin.from('google_tokens').upsert(tok);
  try { await ensureCalendar(tok); await syncUser(tok); } catch (e) { console.error('first sync', e); }
  return back('ok');
}

// الدخول بـ Google من التطبيق (Supabase Auth): التطبيق يرسل refresh_token الذي أعطاه Google
// ⇒ نتحقق منه بتجديده، ثم نحفظه وننشئ تقويم «سكرتيري» ونزامن فورًا
export async function storeGoogleToken(userId: string, email: string | null, refreshToken: string) {
  const { data: old } = await admin.from('google_tokens').select('calendar_id').eq('user_id', userId).maybeSingle();
  const tok: Tok = {
    user_id: userId, email, refresh_token: refreshToken, access_token: null, expires_at: null,
    calendar_id: old?.calendar_id ?? null, sync_token: null, tasks_synced_at: null
  };
  await admin.from('google_tokens').upsert(tok);
  try { await accessToken(tok); }            // مفتاح غير صالح ⇒ نحذفه ونبلّغ التطبيق
  catch (e) { await admin.from('google_tokens').delete().eq('user_id', userId); throw e; }
  try { await ensureCalendar(tok); await syncUser(tok); } catch (e) { console.error('first sync', e); }
}

export async function disconnect(userId: string) {
  const { data: tok } = await admin.from('google_tokens').select('*').eq('user_id', userId).maybeSingle();
  if (tok) {
    await fetch('https://oauth2.googleapis.com/revoke?token=' + enc(tok.refresh_token), { method: 'POST' }).catch(() => {});
    await admin.from('google_tokens').delete().eq('user_id', userId);
    // نفصل المهام عن أحداثها (الأحداث تبقى في التقويم)
    await admin.from('tasks').update({ gcal_event_id: null, gcal_etag: null, gcal_synced_at: null }).eq('user_id', userId);
  }
}

/* ---------------- استدعاء Google API ---------------- */

async function accessToken(tok: Tok): Promise<string> {
  if (tok.access_token && tok.expires_at && Date.parse(tok.expires_at) > Date.now() + 60_000) return tok.access_token;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: tok.refresh_token, grant_type: 'refresh_token' })
  });
  const j = await r.json();
  if (!r.ok) {
    // invalid_grant = المستخدم ألغى الإذن من حساب Google ⇒ نعتبره غير مربوط
    if (j.error === 'invalid_grant') await admin.from('google_tokens').delete().eq('user_id', tok.user_id);
    throw new Error('google_token: ' + (j.error_description || j.error));
  }
  tok.access_token = j.access_token;
  tok.expires_at = new Date(Date.now() + j.expires_in * 1000).toISOString();
  await admin.from('google_tokens').update({ access_token: tok.access_token, expires_at: tok.expires_at }).eq('user_id', tok.user_id);
  return tok.access_token;
}

async function gapi(tok: Tok, method: string, path: string, body?: unknown, query?: Record<string, string>) {
  const url = new URL('https://www.googleapis.com/calendar/v3' + path);
  for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, v);
  const r = await fetch(url, {
    method,
    headers: { Authorization: 'Bearer ' + await accessToken(tok), 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  // deno-lint-ignore no-explicit-any
  const data: any = r.status === 204 ? {} : await r.json().catch(() => ({}));
  return { status: r.status, ok: r.ok, data };
}

// نتأكد من وجود تقويم «سكرتيري» (ننشئه إذا لم يوجد)
async function ensureCalendar(tok: Tok) {
  if (tok.calendar_id) {
    const r = await gapi(tok, 'GET', `/calendars/${enc(tok.calendar_id)}`);
    if (r.ok) return;
    tok.calendar_id = null;
  }
  let pageToken = '';
  do {
    const r = await gapi(tok, 'GET', '/users/me/calendarList', undefined, pageToken ? { pageToken } : {});
    const found = (r.data.items || []).find((c: Tok) => c.summary === CAL_NAME && c.accessRole === 'owner');
    if (found) { tok.calendar_id = found.id; break; }
    pageToken = r.data.nextPageToken || '';
  } while (pageToken);
  if (!tok.calendar_id) {
    const { tz } = await getSettings(tok.user_id);
    const r = await gapi(tok, 'POST', '/calendars', { summary: CAL_NAME, timeZone: tz, description: 'مهام مجدولة من تطبيق سكرتيري' });
    if (!r.ok) throw new Error('create calendar: ' + JSON.stringify(r.data));
    tok.calendar_id = r.data.id;
  }
  tok.sync_token = null;
  await admin.from('google_tokens').update({ calendar_id: tok.calendar_id, sync_token: null }).eq('user_id', tok.user_id);
}

/* ---------------- أحداث اليوم (للخطة) ---------------- */

export async function listEvents(tok: Tok, timeMin: string, timeMax: string) {
  const cals = await gapi(tok, 'GET', '/users/me/calendarList', undefined, { minAccessRole: 'reader' });
  const list = (cals.data.items || [])
    .filter((c: Tok) => c.selected !== false && !c.deleted && c.id !== tok.calendar_id)
    .slice(0, 12);
  const results = await Promise.all(list.map(async (c: Tok) => {
    const r = await gapi(tok, 'GET', `/calendars/${enc(c.id)}/events`, undefined, {
      timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '100'
    });
    return (r.data.items || [])
      .filter((e: Tok) => e.status !== 'cancelled' && e.transparency !== 'transparent' &&
        !(e.attendees || []).some((a: Tok) => a.self && a.responseStatus === 'declined'))
      .map((e: Tok) => ({
        title: e.summary || '(بدون عنوان)',
        start: e.start.dateTime || e.start.date,
        end: e.end.dateTime || e.end.date,
        allDay: !!e.start.date,
        cal: c.summaryOverride || c.summary,
        color: c.backgroundColor
      }));
  }));
  return results.flat().sort((a, b) => a.start.localeCompare(b.start));
}

/* ---------------- المزامنة الثنائية ---------------- */

export async function syncUser(tok: Tok) {
  if (!tok.calendar_id) await ensureCalendar(tok);
  const { tz } = await getSettings(tok.user_id);
  await pullFromGoogle(tok, tz);   // ① ما تغيّر في التقويم ⇒ المهام
  await pushToGoogle(tok, tz);     // ② ما تغيّر في المهام ⇒ التقويم
  // ③ Google Tasks (أخطاؤه لا توقف مزامنة التقويم)
  await syncGoogleTasks(tok, async (method, url, body) => {
    const r = await fetch(url, {
      method, headers: { Authorization: 'Bearer ' + await accessToken(tok), 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    // deno-lint-ignore no-explicit-any
    const data: any = r.status === 204 ? {} : await r.json().catch(() => ({}));
    return { status: r.status, ok: r.ok, data };
  });
  await admin.from('google_tokens').update({ last_sync_at: new Date().toISOString() }).eq('user_id', tok.user_id);
}

async function pullFromGoogle(tok: Tok, tz: string, retried = false): Promise<void> {
  const cal = enc(tok.calendar_id);
  let pageToken = '', nextSync = '';
  do {
    const q: Record<string, string> = tok.sync_token
      ? { syncToken: tok.sync_token, singleEvents: 'true', maxResults: '250' }
      : { timeMin: new Date(Date.now() - 14 * 864e5).toISOString(), singleEvents: 'true', showDeleted: 'true', maxResults: '250' };
    if (pageToken) q.pageToken = pageToken;
    const r = await gapi(tok, 'GET', `/calendars/${cal}/events`, undefined, q);
    if (r.status === 410 && !retried) {         // انتهت صلاحية sync_token ⇒ مزامنة كاملة
      tok.sync_token = null;
      return pullFromGoogle(tok, tz, true);
    }
    if (!r.ok) throw new Error('events.list: ' + JSON.stringify(r.data));
    for (const ev of r.data.items || []) await applyEvent(tok, ev, tz);
    pageToken = r.data.nextPageToken || '';
    nextSync = r.data.nextSyncToken || nextSync;
  } while (pageToken);
  if (nextSync) {
    tok.sync_token = nextSync;
    await admin.from('google_tokens').update({ sync_token: nextSync }).eq('user_id', tok.user_id);
  }
}

// حدث واحد من تقويم «سكرتيري» ⇒ تحديث المهمة المرتبطة به
async function applyEvent(tok: Tok, ev: Tok, tz: string) {
  const uid = tok.user_id;
  const taskId = ev.extendedProperties?.private?.sek_task_id;
  const q = admin.from('tasks').select('*').eq('user_id', uid);
  const { data: task } = await (taskId ? q.eq('id', taskId) : q.eq('gcal_event_id', ev.id)).maybeSingle();
  const now = new Date().toISOString();

  // حُذف الحدث من التقويم ⇒ نلغي جدولة المهمة (المهمة نفسها تبقى)
  if (ev.status === 'cancelled') {
    if (task && task.gcal_event_id === ev.id) {
      await admin.from('tasks').update({
        gcal_event_id: null, gcal_etag: null, sched_start: null, due_time: null,
        updated_at: now, gcal_synced_at: now
      }).eq('id', task.id);
    }
    return;
  }
  if (!ev.start?.dateTime) return;              // أحداث "طوال اليوم" نتجاهلها

  const start = new Date(ev.start.dateTime).toISOString();
  const dur = Math.min(1440, Math.max(5, Math.round((Date.parse(ev.end.dateTime) - Date.parse(start)) / 60000)));
  const isDone = /^✓/.test(ev.summary || '');
  const title = (ev.summary || '').replace(/^✓\s*/, '').trim().slice(0, 500) || 'مهمة من التقويم';
  const lp = localParts(start, tz);

  if (!task) {
    if (taskId) return;                          // مهمة حُذفت نهائيًا
    // حدث جديد أضفته بيدك داخل تقويم «سكرتيري» ⇒ نحوّله إلى مهمة 🎁
    await admin.from('tasks').insert({
      id: crypto.randomUUID(), user_id: uid, title, category: 'personal',
      status: isDone ? 'done' : 'today', completed_at: isDone ? now : null,
      plan_date: lp.date, due_date: lp.date, due_time: lp.time, sched_start: start, duration_min: dur,
      source: 'calendar', gcal_event_id: ev.id, gcal_etag: ev.etag,
      created_at: now, updated_at: now, gcal_synced_at: now
    });
    return;
  }
  if (task.gcal_etag === ev.etag) return;        // هذا تعديلنا نحن (صدى)
  // تعارض: عُدّلت المهمة في التطبيق بعد آخر مزامنة، وتعديلها أحدث من تعديل الحدث ⇒ التطبيق يفوز
  if (task.gcal_synced_at && Date.parse(task.updated_at) > Date.parse(task.gcal_synced_at) &&
      Date.parse(task.updated_at) > Date.parse(ev.updated)) return;

  await admin.from('tasks').update({
    title, sched_start: start, duration_min: dur,
    plan_date: lp.date, due_date: lp.date, due_time: lp.time,
    status: isDone ? 'done' : (task.status === 'done' ? 'done' : 'today'),
    completed_at: isDone ? (task.completed_at || now) : task.completed_at,
    updated_at: now, gcal_etag: ev.etag, gcal_synced_at: now
  }).eq('id', task.id);
}

// المهام المجدولة (sched_start) التي تغيّرت ⇒ إنشاء/تعديل/حذف أحداثها
async function pushToGoogle(tok: Tok, tz: string) {
  const cal = enc(tok.calendar_id);
  const { data: tasks } = await admin.from('tasks').select('*').eq('user_id', tok.user_id)
    .or('sched_start.not.is.null,gcal_event_id.not.is.null');
  for (const t of (tasks || []) as Task[]) {
    if (t.gcal_synced_at && Date.parse(t.updated_at) <= Date.parse(t.gcal_synced_at)) continue; // لم تتغير

    // محذوفة أو أُلغيت جدولتها ⇒ نحذف الحدث
    if (t.deleted || !t.sched_start) {
      if (t.gcal_event_id) await gapi(tok, 'DELETE', `/calendars/${cal}/events/${enc(t.gcal_event_id)}`);
      await admin.from('tasks').update({ gcal_event_id: null, gcal_etag: null, gcal_synced_at: t.updated_at }).eq('id', t.id);
      continue;
    }
    const startMs = Date.parse(t.sched_start);
    const done = t.status === 'done';
    const body = {
      summary: (done ? '✓ ' : '') + t.title,
      description: `${CAT_LABEL[t.category] || ''} · من تطبيق سكرتيري`,
      start: { dateTime: new Date(startMs).toISOString(), timeZone: tz },
      end: { dateTime: new Date(startMs + (t.duration_min || 30) * 60000).toISOString(), timeZone: tz },
      status: 'confirmed',
      colorId: CAT_COLOR[t.category],
      extendedProperties: { private: { sek_task_id: t.id } },
      // تنبيه قبل 10 دقائق في تطبيق التقويم (إلا إذا أُنجزت)
      reminders: { useDefault: false, overrides: done ? [] : [{ method: 'popup', minutes: 10 }] }
    };
    let r = null;
    if (t.gcal_event_id) {
      r = await gapi(tok, 'PATCH', `/calendars/${cal}/events/${enc(t.gcal_event_id)}`, body);
      if (r.status === 404 || r.status === 410) r = null;
    }
    if (!r) r = await gapi(tok, 'POST', `/calendars/${cal}/events`, body);
    if (!r.ok) { console.error('event write', t.id, JSON.stringify(r.data)); continue; }
    await admin.from('tasks').update({ gcal_event_id: r.data.id, gcal_etag: r.data.etag, gcal_synced_at: t.updated_at }).eq('id', t.id);
  }
}
