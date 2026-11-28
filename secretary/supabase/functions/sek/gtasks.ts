// =====================================================================
// gtasks.ts — مزامنة Google Tasks ⇄ سكرتيري
//  ① سحب: كل مهمة جديدة أو معدّلة في Google Tasks ⇒ مهمة في سكرتيري
//     (المنجزة تصل كمنجزة، والمهام الفرعية تصل كخطوات تحت أمّها)
//  ② دفع: إذا أنهيت/أعدت فتح/حذفت مهمة مصدرها Google Tasks ⇒ يتغيّر هناك أيضًا
// =====================================================================
import { admin } from './shared.ts';

// deno-lint-ignore no-explicit-any
type Any = any;
type Api = (method: string, url: string, body?: unknown) => Promise<{ status: number; ok: boolean; data: Any }>;
const BASE = 'https://tasks.googleapis.com/tasks/v1';
const enc = encodeURIComponent;

/* ---------- تخمين الفئة (من اسم القائمة أو عنوان المهمة) ---------- */
const KEYWORDS: Record<string, string[]> = {
  school: ['مدرس', 'حصة', 'حصه', 'درس', 'امتحان', 'اختبار', 'طلاب', 'طالب', 'الصف', 'علامات', 'تصحيح', 'بجروت', 'بغروت',
           'معلم', 'ولي أمر', 'اولياء', 'أولياء', 'مختبر', 'school', 'work', 'עבודה', 'בית ספר', 'arduino', 'esp32'],
  home:   ['البيت', 'بيت', 'تنظيف', 'غسيل', 'فاتور', 'كهرباء', 'تصليح', 'مشتريات', 'سوبر', 'اغراض', 'أغراض', 'home', 'shopping', 'בית', 'קניות'],
  family: ['ماما', 'أمي', 'امي', 'أبي', 'بابا', 'زوجتي', 'الأولاد', 'الاولاد', 'ابني', 'بنتي', 'العائلة', 'عائلة', 'عيد ميلاد',
           'زيارة', 'زياره', 'family', 'משפחה'],
  personal: ['رياضة', 'طبيب', 'دكتور', 'أسنان', 'اسنان', 'قراءة', 'نادي', 'حلاقة', 'personal', 'אישי']
};
function guess(text: string): string | null {
  const s = (text || '').toLowerCase();
  for (const [cat, words] of Object.entries(KEYWORDS)) if (words.some(w => s.includes(w))) return cat;
  return null;
}

/* ---------- المزامنة الكاملة لمستخدم واحد ---------- */
export async function syncGoogleTasks(tok: Any, call: Api) {
  const started = new Date();
  try {
    await pull(tok, call);
    await push(tok, call);
    await admin.from('google_tokens').update({
      // نعود دقيقتين للخلف حتى لا نفوّت تعديلًا حدث أثناء المزامنة
      tasks_synced_at: new Date(started.getTime() - 120_000).toISOString(), tasks_ok: true, tasks_error: null
    }).eq('user_id', tok.user_id);
    tok.tasks_synced_at = started.toISOString();
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    console.error('gtasks', tok.user_id, msg);
    // 403 = الصلاحية غير ممنوحة (ربط قديم بدون Tasks) ⇒ نطلب إعادة الربط
    await admin.from('google_tokens').update({ tasks_ok: false, tasks_error: msg.slice(0, 300) }).eq('user_id', tok.user_id);
  }
}

/* ---------- ① السحب من Google Tasks ---------- */
async function pull(tok: Any, call: Api) {
  const uid = tok.user_id;
  const lists: Any[] = [];
  let pageToken = '';
  do {
    const r = await call('GET', `${BASE}/users/@me/lists?maxResults=100${pageToken ? '&pageToken=' + enc(pageToken) : ''}`);
    if (!r.ok) throw new Error(`lists ${r.status}: ${JSON.stringify(r.data?.error?.message || r.data)}`);
    lists.push(...(r.data.items || []));
    pageToken = r.data.nextPageToken || '';
  } while (pageToken);

  for (const list of lists) {
    // كل المهام (أول مرة) أو ما تغيّر فقط منذ آخر مزامنة
    const items: Any[] = [];
    pageToken = '';
    do {
      const q = new URLSearchParams({ maxResults: '100', showCompleted: 'true', showHidden: 'true' });
      if (tok.tasks_synced_at) { q.set('updatedMin', new Date(tok.tasks_synced_at).toISOString()); q.set('showDeleted', 'true'); }
      if (pageToken) q.set('pageToken', pageToken);
      const r = await call('GET', `${BASE}/lists/${enc(list.id)}/tasks?${q}`);
      if (!r.ok) throw new Error(`tasks ${r.status}: ${JSON.stringify(r.data?.error?.message || r.data)}`);
      items.push(...(r.data.items || []));
      pageToken = r.data.nextPageToken || '';
    } while (pageToken);

    // المهام الأم أولًا، ثم الفرعية (حتى نجد أمّها)
    items.sort((a, b) => (a.parent ? 1 : 0) - (b.parent ? 1 : 0));
    const listCat = guess(list.title);

    for (const it of items) {
      const { data: ex } = await admin.from('tasks').select('*').eq('user_id', uid).eq('gtask_id', it.id).maybeSingle();
      const now = new Date().toISOString();

      // حُذفت في Google Tasks ⇒ نحذفها هنا (حذف ناعم)
      if (it.deleted) {
        if (ex && !ex.deleted) await admin.from('tasks').update({ deleted: true, updated_at: now, gtask_updated: it.updated, gtask_synced_at: now }).eq('id', ex.id);
        continue;
      }
      const title = (it.title || '').trim().slice(0, 500);
      if (!title) continue;                                   // مهمة فارغة
      if (ex && ex.gtask_updated === it.updated) continue;    // لم تتغير (أو صدى تعديلنا)
      // تعارض: عُدّلت في سكرتيري بعد آخر مزامنة وتعديلها أحدث ⇒ سكرتيري يفوز
      if (ex && ex.gtask_synced_at && Date.parse(ex.updated_at) > Date.parse(ex.gtask_synced_at) &&
          Date.parse(ex.updated_at) > Date.parse(it.updated)) continue;

      let parentId = null;
      if (it.parent) {
        const { data: p } = await admin.from('tasks').select('id').eq('user_id', uid).eq('gtask_id', it.parent).maybeSingle();
        parentId = p?.id ?? null;
      }
      const done = it.status === 'completed';
      const due = it.due ? String(it.due).slice(0, 10) : null;  // Google يخزّن التاريخ فقط (بدون ساعة)

      if (!ex) {
        await admin.from('tasks').insert({
          id: crypto.randomUUID(), user_id: uid, title,
          category: listCat || guess(title) || 'personal',
          due_date: due, status: done ? 'done' : 'inbox',
          completed_at: done ? (it.completed || now) : null,
          parent_id: parentId, source: 'gtasks',
          created_at: now, updated_at: now,
          gtask_id: it.id, gtask_list: list.id, gtask_updated: it.updated, gtask_synced_at: now
        });
      } else {
        await admin.from('tasks').update({
          title, due_date: due ?? (ex.due_time ? ex.due_date : null),
          status: done ? 'done' : (ex.status === 'done' ? 'inbox' : ex.status),
          completed_at: done ? (ex.completed_at || it.completed || now) : null,
          parent_id: parentId ?? ex.parent_id, deleted: false,
          updated_at: now, gtask_list: list.id, gtask_updated: it.updated, gtask_synced_at: now
        }).eq('id', ex.id);
      }
    }
  }
}

/* ---------- ② الدفع إلى Google Tasks ---------- */
async function push(tok: Any, call: Api) {
  const { data: rows } = await admin.from('tasks')
    .select('id,title,status,deleted,updated_at,gtask_id,gtask_list,gtask_synced_at,due_date')
    .eq('user_id', tok.user_id).not('gtask_id', 'is', null);
  for (const t of rows || []) {
    if (t.gtask_synced_at && Date.parse(t.updated_at) <= Date.parse(t.gtask_synced_at)) continue;  // لم تتغير
    const url = `${BASE}/lists/${enc(t.gtask_list)}/tasks/${enc(t.gtask_id)}`;
    let updated: string | null = null;
    if (t.deleted) {
      await call('DELETE', url);                                   // حذفتها في سكرتيري ⇒ تُحذف هناك
    } else {
      const body: Any = { id: t.gtask_id, title: t.title, status: t.status === 'done' ? 'completed' : 'needsAction' };
      if (t.status !== 'done') body.completed = null;
      if (t.due_date) body.due = `${t.due_date}T00:00:00.000Z`;
      const r = await call('PATCH', url, body);
      if (!r.ok && r.status !== 404) { console.error('gtask patch', t.id, r.status, JSON.stringify(r.data)); continue; }
      updated = r.data?.updated ?? null;
    }
    await admin.from('tasks').update({ gtask_synced_at: t.updated_at, ...(updated ? { gtask_updated: updated } : {}) }).eq('id', t.id);
  }
}
