// =====================================================================
// notify.ts — إشعارات Push: الصباح، المساء، والتذكير قبل المهمة
// تُستدعى كل 5 دقائق من المؤقّت (pg_cron)
// =====================================================================
import webpush from 'npm:web-push@3.6.7';
import { admin, cfg, localParts, toMin, getSettings } from './shared.ts';

let vapidReady = false;
async function setupVapid() {
  if (vapidReady) return;
  webpush.setVapidDetails(await cfg('vapid_subject'), await cfg('vapid_public'), await cfg('vapid_private'));
  vapidReady = true;
}

type Payload = { title: string; body: string; url: string; tag: string };
// deno-lint-ignore no-explicit-any
type Sub = any;

// إرسال إشعار لجهاز واحد. إذا ألغى المستخدم الاشتراك (404/410) نحذفه
export async function sendPush(sub: Sub, payload: Payload) {
  await setupVapid();
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload), { TTL: 3600, urgency: 'high' }
    );
    return { ok: true };
  } catch (e) {
    // deno-lint-ignore no-explicit-any
    const code = (e as any)?.statusCode;
    if ((code === 404 || code === 410) && sub.user_id) await admin.from('push_subs').delete().eq('endpoint', sub.endpoint);
    return { ok: false, code, msg: String((e as Error)?.message || e) };
  }
}

export async function pushToUser(userId: string, payload: Payload) {
  const { data: subs } = await admin.from('push_subs').select('*').eq('user_id', userId);
  return Promise.all((subs || []).map((s: Sub) => sendPush(s, payload)));
}

// نسجّل الإشعار مرة واحدة فقط (المفتاح الأساسي يمنع التكرار)
async function once(userId: string, kind: string, ref: string) {
  const { error } = await admin.from('notif_log').insert({ user_id: userId, kind, ref });
  return !error;
}

export async function runNotifications(gcalUsers: Set<string>) {
  const { data: subs } = await admin.from('push_subs').select('user_id');
  const users = [...new Set((subs || []).map((s: Sub) => s.user_id as string))];
  const now = new Date();

  for (const uid of users) {
    try {
      const s = await getSettings(uid);
      const lp = localParts(now, s.tz);
      const hi = s.name ? ` يا ${s.name}` : '';
      const inWindow = (t: string) => lp.minutes >= toMin(t) && lp.minutes < toMin(t) + 20;

      // ☀️ إشعار الصباح
      if (s.push_morning && inWindow(s.morning_time) && await once(uid, 'morning', lp.date)) {
        const { count } = await admin.from('tasks').select('id', { count: 'exact', head: true })
          .eq('user_id', uid).eq('deleted', false).neq('status', 'done');
        await pushToUser(uid, {
          title: `☀️ صباح الخير${hi}`,
          body: count ? `لديك ${count} مهام. اضغط لنرتّب يومك معًا` : 'لا مهام معلّقة. يوم هادئ 🌿',
          url: './?morning=1', tag: 'morning'
        });
      }

      // 🌙 إشعار المساء: أنجزتَ X من Y
      if (s.push_evening && inWindow(s.evening_time) && await once(uid, 'evening', lp.date)) {
        const { data: today } = await admin.from('tasks').select('status')
          .eq('user_id', uid).eq('deleted', false).eq('plan_date', lp.date);
        const y = today?.length || 0, x = (today || []).filter((t: Sub) => t.status === 'done').length;
        await pushToUser(uid, {
          title: '🌙 مراجعة المساء',
          body: y ? `أنجزتَ ${x} من ${y} اليوم. دقيقة واحدة لترحيل الباقي؟` : 'كيف كان يومك؟ اضغط للمراجعة',
          url: './?evening=1', tag: 'evening'
        });
      }

      // ⏰ تذكير قبل المهمة (فقط إن لم يكن Google Calendar مربوطًا، فهو يذكّرك بنفسه)
      if (s.push_reminders && !gcalUsers.has(uid)) {
        const from = now.toISOString(), to = new Date(now.getTime() + 15 * 60000).toISOString();
        const { data: soon } = await admin.from('tasks').select('id,title,sched_start')
          .eq('user_id', uid).eq('deleted', false).neq('status', 'done')
          .gte('sched_start', from).lte('sched_start', to);
        for (const t of soon || []) {
          if (!await once(uid, 'reminder', `${t.id}@${t.sched_start}`)) continue;
          await pushToUser(uid, {
            title: `⏰ ${t.title}`,
            body: `تبدأ الساعة ${localParts(t.sched_start, s.tz).time}`,
            url: './?plan=1', tag: 'rem-' + t.id
          });
        }
      }
    } catch (e) {
      console.error('notify user', uid, e);
    }
  }
  // تنظيف السجلات القديمة (أقدم من 30 يومًا)
  await admin.from('notif_log').delete().lt('sent_at', new Date(Date.now() - 30 * 864e5).toISOString());
  await admin.from('oauth_states').delete().lt('created_at', new Date(Date.now() - 864e5).toISOString());
}
