/* =====================================================================
   store.js — منطق المهام
   كل تعديل:
     1) يُحفظ في الهاتف فورًا (IndexedDB)
     2) يُعلَّم dirty = 1 أي "لم يُرفع للسحابة بعد"
     3) يُطلق حدث 'sek:tasks' لتحديث الشاشات وطلب مزامنة
   ===================================================================== */
import { getAllTasks, getTask, putTask } from './db.js';
import { todayStr, addDays, addMonths, localISO, parseDays, weekdayOf, firstMatchingDay, GRADE_MIN_DEFAULT } from './util.js';
import { getSettings, saveSettings } from './sync.js';

const nowISO = () => new Date().toISOString();
const changed = () => window.dispatchEvent(new Event('sek:tasks'));

/* =================== القراءة =================== */

export async function all() {
  return (await getAllTasks()).filter(t => !t.deleted);
}
export const get = getTask;

// هل لهذه المهمة مهام فرعية (غير محذوفة)؟
const parentIds = list => new Set(list.filter(t => t.parent_id).map(t => t.parent_id));

export async function children(parentId) {
  return (await all()).filter(t => t.parent_id === parentId)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

// المهام المعلّقة للرئيسية: المستوى الأعلى فقط (المهام الفرعية تظهر داخل أمّها)
export async function pending() {
  const list = (await all()).filter(t => t.status !== 'done' && !t.parent_id);
  return list.sort((a, b) => {
    const ka = (a.due_date || '9999') + (a.due_time || '99');
    const kb = (b.due_date || '9999') + (b.due_time || '99');
    return ka === kb ? b.created_at.localeCompare(a.created_at) : ka.localeCompare(kb);
  });
}

/* ---------- المرحلة 2: طابور وضع الصباح ----------
   المهام التي تحتاج قرارًا اليوم:
   • غير منجزة، وليست أمًّا لمهام فرعية (نسأل عن الخطوات نفسها)
   • ليست مقرّرة مسبقًا لليوم أو لاحقًا (status=today و plan_date >= اليوم)
   • يومها حان: plan_date <= اليوم، أو بلا plan_date وموعدها اليوم أو قبله أو بلا موعد */
export async function morningQueue() {
  const t0 = todayStr();
  const list = await all();
  const parents = parentIds(list);
  return list.filter(t =>
    t.status !== 'done' && !parents.has(t.id) && !t.grade_total &&   // رزم التصحيح تُرتَّب تلقائيًا
    !(t.status === 'today' && t.plan_date && t.plan_date >= t0) &&
    (t.plan_date ? t.plan_date <= t0 : (!t.due_date || t.due_date <= t0))
  ).sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999') || a.created_at.localeCompare(b.created_at));
}

/* ---------- المرحلة 3: مهام خطة اليوم ----------
   المقرّرة لليوم + التي موعدها اليوم (حتى لو لم تمرّ بوضع الصباح) */
export async function planTasks(day = todayStr()) {
  const list = await all();
  const parents = parentIds(list);
  const open = [], done = [];
  for (const t of list) {
    if (parents.has(t.id)) continue;
    // رزمة تصحيح لم تنتهِ ⇒ تظهر كل يوم حتى تكتمل
    const planned = (t.status === 'today' && t.plan_date === day) || (t.grade_total > 0 && t.status !== 'done');
    const dueToday = t.status === 'inbox' && t.due_date === day && (!t.plan_date || t.plan_date <= day);
    if (t.status === 'done') {
      if (t.plan_date === day || (t.completed_at && todayStr(new Date(t.completed_at)) === day)) done.push(t);
    } else if (planned || dueToday) open.push(t);
  }
  return { open, done };
}

/* =================== الكتابة =================== */

// إذا كان للمهمة تاريخ وساعة ⇒ وقتها ثابت (sched_start) فتذهب للتقويم وتُذكَّر بها
const fixedStart = (date, time) => (date && time ? localISO(date, time) : null);

export async function add(fields) {
  const clean = String(fields.title || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  if (!clean) throw new Error('empty');
  const now = nowISO();
  const task = {
    id: crypto.randomUUID(),
    title: clean,
    category: fields.category || 'personal',
    due_date: fields.due_date || null,
    due_time: fields.due_date ? (fields.due_time || null) : null,
    importance: fields.importance ?? null,
    duration_min: fields.duration_min ?? null,
    remind_min: fields.remind_min ?? null,   // التذكير قبل الموعد بالدقائق (null = 15، 0 = بدون)
    school: fields.school || null,            // مدرسة أ / ب
    grade_total: fields.grade_total ?? null,  // 📝 رزمة تصحيح: عدد الأوراق
    grade_done: 0,
    grade_min: fields.grade_min ?? null,      // دقائق الورقة
    status: fields.status || 'inbox',
    plan_date: fields.plan_date || null,
    postpone_count: 0,
    order_index: fields.order_index ?? null,
    source: fields.source || 'manual',
    recur: fields.recur || null,
    parent_id: fields.parent_id || null,
    focus_min: 0,
    sched_start: null,
    completed_at: null, deleted: false,
    created_at: fields.created_at || now, updated_at: now,
    dirty: 1
  };
  // مهمة متكررة: تحتاج تاريخ بداية، و«أيام محددة» تبدأ في أول يوم مناسب
  if (task.recur && !task.due_date) task.due_date = todayStr();
  if (task.recur?.startsWith('days:')) task.due_date = firstMatchingDay(task.recur, task.due_date);
  task.sched_start = fixedStart(task.due_date, task.due_time);
  await putTask(task);
  changed();
  return task;
}

// تعديل حقول مهمة (patch = الحقول الجديدة فقط)
export async function update(id, patch, { silent = false } = {}) {
  const t = await getTask(id);
  if (!t) return null;
  Object.assign(t, patch);
  // تغيّر التاريخ أو الساعة ⇒ نعيد حساب الوقت الثابت
  if ('due_date' in patch || 'due_time' in patch) {
    if (!t.due_date) t.due_time = null;
    const fs = fixedStart(t.due_date, t.due_time);
    if (fs) t.sched_start = fs;
    else if ('due_time' in patch && !patch.due_time && !('sched_start' in patch)) t.sched_start = null;
  }
  t.updated_at = nowISO();
  t.dirty = 1;
  await putTask(t);
  if (!silent) changed();
  return t;
}

// إنهاء مهمة: + إنشاء التكرار التالي + إنهاء الأم إذا انتهت كل خطواتها
export async function complete(id) {
  await finish(id);
  changed();
}
async function finish(id) {
  const t = await update(id, { status: 'done', completed_at: nowISO() }, { silent: true });
  if (!t) return;
  if (t.recur) await spawnNext(t);
  if (t.parent_id) {
    const sibs = await children(t.parent_id);
    const parent = await getTask(t.parent_id);
    if (parent && parent.status !== 'done' && sibs.length && sibs.every(s => s.status === 'done')) await finish(t.parent_id);
  }
}
export async function reopen(id) {
  const t = await update(id, { status: 'inbox', completed_at: null }, { silent: true });
  if (t?.parent_id) await update(t.parent_id, { status: 'inbox', completed_at: null }, { silent: true });
  changed();
}

// حذف ناعم (مع الخطوات الفرعية)
export async function remove(id) {
  for (const c of await children(id)) await update(c.id, { deleted: true }, { silent: true });
  await update(id, { deleted: true });
}
export async function restore(id) {
  const kids = (await getAllTasks()).filter(t => t.parent_id === id && t.deleted);
  for (const c of kids) await update(c.id, { deleted: false }, { silent: true });
  await update(id, { deleted: false });
}

/* ---------- المرحلة 5: التكرار ----------
   عند إنهاء مهمة متكررة ننشئ النسخة التالية بالتاريخ القادم */
export function nextDate(t) {
  const t0 = todayStr();
  let d = t.due_date || t0;
  const r = t.recur || '';
  // أيام محددة: أول يوم مناسب بعد (الموعد أو اليوم، أيهما أبعد)
  if (r.startsWith('days:')) {
    const days = parseDays(r), base = d > t0 ? d : t0;
    for (let i = 1; i <= 7; i++) { const x = addDays(base, i); if (days.includes(weekdayOf(x))) return x; }
    return addDays(base, 7);
  }
  const n = r.startsWith('every:') ? Math.max(1, +r.slice(6)) : 0;
  const step = x => n ? addDays(x, n) : r === 'daily' ? addDays(x, 1) : r === 'weekly' ? addDays(x, 7) : addMonths(x, 1);
  do { d = step(d); } while (d <= t0);
  return d;
}
async function spawnNext(t) {
  await add({
    title: t.title, category: t.category, recur: t.recur,
    due_date: nextDate(t), due_time: t.due_time,
    importance: t.importance, duration_min: t.duration_min, remind_min: t.remind_min, source: 'recur'
  });
}

/* ---------- المرحلة 5: تقسيم مهمة إلى خطوات تلقائيًا (بدون كتابة) ---------- */
export async function split(id, parts) {
  const t = await getTask(id);
  if (!t) return [];
  const each = t.duration_min ? Math.max(15, Math.round(t.duration_min / parts / 5) * 5) : null;
  const kids = [];
  for (let i = 1; i <= parts; i++) {
    kids.push(await add({
      title: `${t.title} (${i}/${parts})`, category: t.category, parent_id: t.id,
      importance: t.importance, duration_min: each, source: 'split',
      created_at: new Date(Date.now() + i).toISOString()   // ترتيب الخطوات 1، 2، 3
    }));
  }
  // الأم تصبح «حاوية»: نلغي جدولتها ونصفّر عداد التأجيل
  await update(id, { postpone_count: 0, plan_date: null, status: 'inbox', sched_start: null, due_time: null });
  return kids;
}

// إضافة خطوة فرعية يدويًا
export async function addStep(parentId, title) {
  const p = await getTask(parentId);
  return add({ title, category: p?.category, parent_id: parentId, importance: p?.importance });
}

/* ---------- المرحلة 3: حفظ ترتيب السحب ---------- */
export async function reorder(ids) {
  for (let i = 0; i < ids.length; i++) {
    const t = await getTask(ids[i]);
    if (t && t.order_index !== i) await update(ids[i], { order_index: i }, { silent: true });
  }
  changed();
}

/* ---------- إحصاءات ---------- */
export async function doneTodayCount() {
  const t0 = todayStr();
  return (await all()).filter(t => t.status === 'done' && t.completed_at && todayStr(new Date(t.completed_at)) === t0).length;
}


/* =====================================================================
   📝 عدّاد التصحيح: +1 بعد كل ورقة (أو −1 للتصحيح)
   يحدّث الرزمة، ويسجّل عدد أوراق اليوم (للهدف اليومي والإحصاء)، ويُنهي الرزمة عند اكتمالها
   ===================================================================== */
export async function gradeStep(id, delta = 1) {
  const t = await getTask(id);
  if (!t?.grade_total) return null;
  const done = Math.max(0, Math.min(t.grade_total, (t.grade_done || 0) + delta));
  const real = done - (t.grade_done || 0);
  if (!real) return t;
  await update(id, { grade_done: done }, { silent: true });
  // سجل اليوم: {"2026-11-28": 12} (نحتفظ بآخر 60 يومًا)
  const s = await getSettings(), day = todayStr();
  const log = { ...(s.grade_log || {}) };
  log[day] = Math.max(0, (log[day] || 0) + real);
  // وكم من هذه الرزمة بالذات (لنعرف هل أنهيت حصة اليوم منها)
  const by = { ...(s.grade_by || {}) };
  by[day] = { ...(by[day] || {}) };
  by[day][id] = Math.max(0, (by[day][id] || 0) + real);
  for (const o of [log, by]) for (const k of Object.keys(o)) if (k < addDays(day, -60)) delete o[k];
  await saveSettings({ grade_log: log, grade_by: by });
  if (done >= t.grade_total) await finish(id);          // ✅ اكتملت الرزمة
  changed();
  return { ...t, grade_done: done };
}
// ✓ حصة منجزة اليوم (أو إلغاء الإشارة)
export async function toggleClass(code, day = todayStr()) {
  const s = await getSettings();
  const all = { ...(s.class_done || {}) };
  const list = new Set(all[day] || []);
  list.has(code) ? list.delete(code) : list.add(code);
  all[day] = [...list];
  for (const k of Object.keys(all)) if (k < addDays(day, -60)) delete all[k];
  await saveSettings({ class_done: all });
  changed();
  return list.has(code);
}
export const gradedToday = async () => ((await getSettings()).grade_log || {})[todayStr()] || 0;

// تعلّم السرعة الحقيقية من جلسات التركيز: متوسط متحرك لدقائق الورقة
export async function learnGradeSpeed(id, minutes, papers) {
  if (!(papers > 0) || !(minutes > 0)) return;
  const t = await getTask(id); if (!t) return;
  const old = t.grade_min || GRADE_MIN_DEFAULT;
  const now = Math.min(120, Math.max(1, minutes / papers));
  await update(id, { grade_min: Math.round(old * 0.6 + now * 0.4) }, { silent: true });
}
