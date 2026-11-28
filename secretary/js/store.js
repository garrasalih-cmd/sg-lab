/* =====================================================================
   store.js — منطق المهام (إضافة، تعديل، إنهاء، حذف)
   كل تعديل:
     1) يُحفظ في الهاتف فورًا (IndexedDB)
     2) يُعلَّم dirty = 1 أي "لم يُرفع للسحابة بعد"
     3) يُطلق حدث 'sek:tasks' لتحديث الشاشة وطلب مزامنة
   ===================================================================== */
import { getAllTasks, getTask, putTask } from './db.js';

const nowISO = () => new Date().toISOString();
const changed = () => window.dispatchEvent(new Event('sek:tasks'));

// كل المهام غير المحذوفة
export async function all() {
  return (await getAllTasks()).filter(t => !t.deleted);
}

// المهام المعلّقة مرتّبة: ذات الموعد الأقرب أولًا، ثم الأحدث إضافة
export async function pending() {
  const list = (await all()).filter(t => t.status !== 'done');
  return list.sort((a, b) => {
    const ka = (a.due_date || '9999') + (a.due_time || '99');
    const kb = (b.due_date || '9999') + (b.due_time || '99');
    return ka === kb ? b.created_at.localeCompare(a.created_at) : ka.localeCompare(kb);
  });
}

// إضافة مهمة جديدة
export async function add({ title, category = 'personal', due_date = null, due_time = null, source = 'manual' }) {
  const clean = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  if (!clean) throw new Error('empty');
  const now = nowISO();
  const task = {
    id: crypto.randomUUID(),       // معرّف فريد يُنشأ في الهاتف
    title: clean, category, due_date, due_time: due_time || null,
    importance: null, duration_min: null,   // تُملأ في وضع الصباح (المرحلة 2)
    status: 'inbox', plan_date: null, postpone_count: 0, order_index: null,
    source, completed_at: null, deleted: false,
    created_at: now, updated_at: now,
    dirty: 1
  };
  await putTask(task);
  changed();
  return task;
}

// تعديل حقول مهمة (patch = الحقول الجديدة فقط)
export async function update(id, patch) {
  const t = await getTask(id);
  if (!t) return null;
  Object.assign(t, patch, { updated_at: nowISO(), dirty: 1 });
  await putTask(t);
  changed();
  return t;
}

export const complete = id => update(id, { status: 'done', completed_at: nowISO() });
export const reopen = id => update(id, { status: 'inbox', completed_at: null });
export const remove = id => update(id, { deleted: true });     // حذف ناعم
export const restore = id => update(id, { deleted: false });   // تراجع عن الحذف

// عدد ما أُنجز اليوم (للتشجيع 💪)
export async function doneTodayCount() {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  return (await all()).filter(t => t.status === 'done' && t.completed_at && new Date(t.completed_at) >= start).length;
}
