/* =====================================================================
   planner.js — خوارزمية ترتيب اليوم (المرحلة 3)
   المدخلات: مهام اليوم + أحداث التقويم + بداية/نهاية يومك + الوقت الحالي
   الخطوات:
     1) ترتيب المهام: ترتيبك اليدوي (السحب) أولًا، ثم الأهمية 1←4، ثم الموعد
     2) أهم 3 = أول ثلاث مهام في الترتيب
     3) الأوقات المشغولة = أحداث التقويم + المهام ذات الساعة الثابتة
     4) فترات الفراغ = ما بين الأوقات المشغولة (من الآن حتى نهاية اليوم)
     5) كل مهمة مرنة تأخذ أول فراغ يتسع لمدتها (First-Fit)
   ===================================================================== */
import { toMin, minOfDate } from './util.js';

const DEFAULT_DUR = 30;      // مدة افتراضية إذا لم تحدّدها
const GAP = 5;               // 5 دقائق راحة بين المهام والحصص

export function sortTasks(tasks) {
  return [...tasks].sort((a, b) =>
    (a.order_index ?? 1e9) - (b.order_index ?? 1e9) ||
    (a.importance ?? 2.5) - (b.importance ?? 2.5) ||
    (a.due_time || '99').localeCompare(b.due_time || '99') ||
    a.created_at.localeCompare(b.created_at));
}

/**
 * @param tasks    مهام اليوم غير المنجزة
 * @param events   أحداث Google Calendar [{title,start,end,allDay}]
 * @param settings {day_start, day_end}
 * @param now      Date
 * @param day      'YYYY-MM-DD' (اليوم)
 * @returns {ordered, top3, slots: Map(id → {start,end,fixed}), unscheduled, timeline}
 */
export function planDay({ tasks, events = [], settings, now = new Date(), day }) {
  const ordered = sortTasks(tasks);
  const dayStart = toMin(settings.day_start || '07:30');
  const dayEnd = toMin(settings.day_end || '22:00');
  const nowMin = Math.ceil(minOfDate(now) / 5) * 5;   // تقريب لأقرب 5 دقائق

  // ① الأوقات المشغولة من التقويم (نتجاهل أحداث "طوال اليوم")
  const busy = [];
  const evItems = [];
  for (const e of events) {
    if (e.allDay) { evItems.push({ kind: 'event', allDay: true, title: e.title, cal: e.cal }); continue; }
    const s = new Date(e.start), en = new Date(e.end);
    const sm = sameDay(s, day) ? minOfDate(s) : 0;
    const em = sameDay(en, day) ? minOfDate(en) : 24 * 60;
    busy.push([sm, em]);
    evItems.push({ kind: 'event', start: sm, end: em, title: e.title, cal: e.cal, color: e.color, icon: e.icon });
  }

  // ② المهام ذات الساعة الثابتة (لها due_time اليوم، أو حُدّد وقتها من التقويم)
  const slots = new Map();
  const flexible = [];
  for (const t of ordered) {
    const dur = t.duration_min || DEFAULT_DUR;
    if (t.due_time && t.due_date === day) {
      const s = toMin(t.due_time);
      slots.set(t.id, { start: s, end: s + dur, fixed: true });
      busy.push([s, s + dur]);
    } else flexible.push(t);
  }

  // ③ فترات الفراغ
  let free = [[Math.max(dayStart, nowMin), dayEnd]];
  for (const [bs, be] of busy) free = subtract(free, bs - GAP, be + GAP);

  // ④ توزيع المهام المرنة بالترتيب على أول فراغ مناسب
  const unscheduled = [];
  for (const t of flexible) {
    const dur = t.duration_min || DEFAULT_DUR;
    const i = free.findIndex(([s, e]) => e - s >= dur);
    if (i === -1) { unscheduled.push(t); continue; }
    const s = free[i][0];
    slots.set(t.id, { start: s, end: s + dur, fixed: false });
    free = subtract(free, s, s + dur + GAP);
  }

  // ⑤ الجدول الزمني: الأحداث + المهام مرتّبة حسب الوقت
  const timeline = [
    ...evItems,
    ...ordered.filter(t => slots.has(t.id)).map(t => ({ kind: 'task', task: t, ...slots.get(t.id) }))
  ].sort((a, b) => (a.allDay ? -1 : b.allDay ? 1 : a.start - b.start));

  return { ordered, top3: ordered.slice(0, 3), slots, unscheduled, timeline, freeMinutes: free.reduce((n, [s, e]) => n + e - s, 0) };
}

// طرح فترة [s,e] من قائمة فترات الفراغ
function subtract(list, s, e) {
  const out = [];
  for (const [a, b] of list) {
    if (e <= a || s >= b) { out.push([a, b]); continue; }
    if (s > a) out.push([a, s]);
    if (e < b) out.push([e, b]);
  }
  return out;
}
const sameDay = (d, day) => {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` === day;
};

/* =====================================================================
   ⚠️ اكتشاف التداخل في الأوقات
   نقارن كل مهمة لها ساعة ثابتة مع: الحصص، وأحداث اليوم، والمهام الثابتة الأخرى
   ===================================================================== */
// \u2066…\u2069 = عزل اتجاه الأرقام حتى لا تنقلب الفترة داخل النص العربي
const label = (title, s, e) => `${title} (\u2066${fmt(s)}–${fmt(e)}\u2069)`;
const fmt = m => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

// كل الفترات المشغولة في يوم: حصص/أحداث + مهام بساعة ثابتة
function busyItems({ tasks, events, day, excludeId }) {
  const items = [];
  for (const e of events || []) {
    if (e.allDay) continue;
    const s = new Date(e.start), en = new Date(e.end);
    if (!sameDay(s, day)) continue;
    items.push({ id: null, kind: 'event', title: e.title, s: minOfDate(s), e: sameDay(en, day) ? minOfDate(en) : 24 * 60 });
  }
  for (const t of tasks || []) {
    if (t.id === excludeId || t.deleted || t.status === 'done' || !t.due_time || t.due_date !== day) continue;
    const s = toMin(t.due_time);
    items.push({ id: t.id, kind: 'task', title: t.title, s, e: s + (t.duration_min || DEFAULT_DUR) });
  }
  return items;
}

// خريطة: رقم المهمة ⇒ قائمة ما تتداخل معه
export function findConflicts({ tasks, events, day }) {
  const items = busyItems({ tasks, events, day });
  const out = new Map();
  const add = (id, other) => { if (!id) return; if (!out.has(id)) out.set(id, []); out.get(id).push(label(other.title, other.s, other.e)); };
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j];
      if (a.s < b.e && b.s < a.e) { add(a.id, b); add(b.id, a); }
    }
  }
  return out;
}

// فحص وقت مقترح قبل الحفظ: ما يتداخل معه + أقرب وقت فارغ بعده يتسع للمدة
export function checkSlot({ start, dur = DEFAULT_DUR, tasks, events, day, dayEnd = 22 * 60, excludeId }) {
  const items = busyItems({ tasks, events, day, excludeId });
  const end = start + dur;
  const conflicts = items.filter(x => start < x.e && x.s < end).map(x => label(x.title, x.s, x.e));
  let suggestion = null;
  if (conflicts.length) {
    // نجرّب البدء بعد نهاية كل فترة مشغولة (مع 5 دقائق راحة)، ونأخذ أول وقت لا يتداخل
    const candidates = items.map(x => x.e + GAP).filter(c => c > start).sort((a, b) => a - b);
    for (const c of candidates) {
      if (c + dur > dayEnd) break;
      if (!items.some(x => c < x.e && x.s < c + dur)) { suggestion = c; break; }
    }
  }
  return { conflicts, suggestion };
}
