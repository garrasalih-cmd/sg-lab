/* =====================================================================
   util.js — أدوات صغيرة: الفئات، التواريخ، تخمين الفئة
   ===================================================================== */

// الفئات الأربع: المفتاح بالإنجليزية (يُخزَّن في القاعدة) والاسم والرمز للعرض
export const CATS = {
  school:   { label: 'مدرسة',  icon: '🏫' },
  home:     { label: 'بيت',    icon: '🏠' },
  family:   { label: 'عائلة',  icon: '👨‍👩‍👧' },
  personal: { label: 'شخصي',  icon: '👤' }
};

// مصفوفة أيزنهاور (الأهمية)
export const IMPORTANCE = {
  1: { label: 'عاجل ومهم', icon: '🔴' },
  2: { label: 'مهم وليس عاجلًا', icon: '🟢' },
  3: { label: 'عاجل وليس مهمًا', icon: '🟡' },
  4: { label: 'يمكن تأجيله', icon: '⚪' }
};
export const DURATIONS = [[15, '15 د'], [30, '30 د'], [60, 'ساعة'], [120, 'ساعتان+']];
export const RECUR = { daily: 'يوميًا', weekly: 'أسبوعيًا', monthly: 'شهريًا' };

/* ---------- التواريخ ----------
   نخزّن التاريخ نصًّا بصيغة YYYY-MM-DD حسب توقيت الهاتف المحلي
   (وليس UTC) حتى لا "يقفز" اليوم بعد منتصف الليل. */
const pad = n => String(n).padStart(2, '0');
export const dateStr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayStr = (d = new Date()) => dateStr(d);
const parse = str => { const [y, m, d] = str.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (str, n) => { const d = parse(str); d.setDate(d.getDate() + n); return dateStr(d); };
export const addMonths = (str, n) => {
  const d = parse(str), day = d.getDate();
  d.setDate(1); d.setMonth(d.getMonth() + n);
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate())); // 31 ⇒ آخر الشهر
  return dateStr(d);
};
// تاريخ + ساعة محليان ⇒ نص ISO عالمي (UTC)
export const localISO = (date, time) => { const d = parse(date); const [h, m] = time.split(':').map(Number); d.setHours(h, m, 0, 0); return d.toISOString(); };
// دقائق منذ منتصف الليل ⇔ "HH:MM"
export const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
export const fromMin = m => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
// فترة زمنية «من–إلى» معزولة الاتجاه حتى لا تنقلب داخل النص العربي
export const fmtRange = (s, e) => `\u2066${fromMin(s)}–${fromMin(e)}\u2069`;
export const minOfDate = d => d.getHours() * 60 + d.getMinutes();
export const fmtDuration = m => !m ? '' : m < 60 ? `${m} د` : m % 60 ? `${Math.floor(m / 60)} س ${m % 60} د` : `${m / 60} س`;

// u-nu-latn = أرقام 1 2 3 (وليس ١ ٢ ٣)
export const LOCALE = 'ar-u-nu-latn';
export const longToday = () =>
  new Intl.DateTimeFormat(LOCALE, { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
export const weekdayShort = str => new Intl.DateTimeFormat(LOCALE, { weekday: 'short' }).format(parse(str));

// عرض الموعد بشكل ودّي: "اليوم 14:00"، "غدًا"، "الأحد 30/11"
export function fmtDue(due_date, due_time) {
  if (!due_date) return '';
  const t = todayStr();
  const time = due_time ? ' ' + due_time.slice(0, 5) : '';
  if (due_date === t) return 'اليوم' + time;
  if (due_date === addDays(t, 1)) return 'غدًا' + time;
  if (due_date === addDays(t, -1)) return 'أمس' + time;
  const d = parse(due_date);
  const day = new Intl.DateTimeFormat(LOCALE, { weekday: 'long' }).format(d);
  return `${day} ${d.getDate()}/${d.getMonth() + 1}` + time;
}
export const isOverdue = due_date => !!due_date && due_date < todayStr();

/* ---------- تخمين الفئة من النص ----------
   حتى لا تحتاج لاختيار الفئة كل مرة: نبحث عن كلمات مفتاحية.
   يمكنك دائمًا تغيير الاختيار بإصبعك. أضف كلماتك هنا براحتك. */
const KEYWORDS = {
  school: ['حصة', 'حصه', 'درس', 'امتحان', 'اختبار', 'طلاب', 'طالب', 'الصف', 'مدرسة', 'مدرسه', 'علامات',
           'تصحيح', 'بجروت', 'بغروت', 'مدير', 'معلمين', 'ولي أمر', 'اولياء', 'أولياء', 'مختبر', 'arduino', 'esp32', 'مشروع الطلاب'],
  home:   ['البيت', 'بيت', 'تنظيف', 'غسيل', 'فاتورة', 'فاتوره', 'كهرباء', 'تصليح', 'مشتريات', 'سوبر', 'اغراض', 'أغراض', 'مطبخ', 'السيارة', 'السياره'],
  family: ['ماما', 'أمي', 'امي', 'أبي', 'ابوي', 'بابا', 'زوجتي', 'الأولاد', 'الاولاد', 'ابني', 'بنتي', 'العائلة', 'العيله',
           'عيد ميلاد', 'زيارة', 'زياره', 'خالتي', 'عمي', 'أخي', 'اخوي', 'أختي', 'اختي', 'سيدي', 'ستي'],
  personal: ['رياضة', 'رياضه', 'طبيب', 'دكتور', 'أسنان', 'اسنان', 'قراءة', 'نادي', 'حلاقة', 'حلاقه', 'مشي']
};
export function guessCategory(text) {
  const s = (text || '').toLowerCase();
  for (const [cat, words] of Object.entries(KEYWORDS)) {
    if (words.some(w => s.includes(w))) return cat;
  }
  return null;
}

// حماية من HTML داخل عناوين المهام (مثلًا نص منسوخ من واتساب)
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* =====================================================================
   قوالب مدرسية وشخصية جاهزة ⚡ (بضغطة واحدة: العنوان + الفئة + المدة + التكرار)
   أضف أو عدّل القوالب هنا براحتك
   ===================================================================== */
export const TEMPLATES = [
  { icon: '📝', title: 'تحضير حصة', category: 'school', duration_min: 45, recur: 'weekly' },
  { icon: '✍️', title: 'تصحيح امتحان', category: 'school', duration_min: 60 },
  { icon: '📞', title: 'اتصال بولي أمر', category: 'school', duration_min: 15 },
  { icon: '🚸', title: 'مناوبة', category: 'school', duration_min: 30, recur: 'weekly' },
  { icon: '👥', title: 'اجتماع طاقم', category: 'school', duration_min: 60 },
  { icon: '🔌', title: 'تجهيز المختبر', category: 'school', duration_min: 30 },
  { icon: '🛒', title: 'شراء أغراض', category: 'home', duration_min: 30 },
  { icon: '👨‍👩‍👧', title: 'زيارة الأهل', category: 'family', duration_min: 60 },
  { icon: '🏃', title: 'رياضة', category: 'personal', duration_min: 30, recur: 'daily' }
];

/* ---------- خيارات التذكير (بالدقائق قبل الموعد) ---------- */
export const REMIND_OPTS = [[0, '🔕 بدون'], [5, '5 د'], [15, '15 د'], [30, '30 د'], [60, 'ساعة']];
export const DEFAULT_REMIND = 15;

/* =====================================================================
   جدول الحصص 🏫 لمدرستين (كل أيام الأسبوع)
   schools: لكل مدرسة اسمها وأوقات جرسها · days: لكل يوم رموز الحصص مثل "a1" (مدرسة أ، حصة 1) أو "b3"
   travel_min: وقت الطريق بين المدرستين (يُحجز تلقائيًا عند الانتقال في نفس اليوم)
   ===================================================================== */
export const DAY_NAMES = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
export const DAY_SHORT = ['أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'];
export const SCHOOL_COLORS = { a: '#4f8ff0', b: '#9a6fe0' };
export const SCHOOL_DOTS = { a: '🔵', b: '🟣' };
const BELL = [
  { start: '08:00', end: '08:45' }, { start: '08:45', end: '09:30' },
  { start: '09:45', end: '10:30' }, { start: '10:30', end: '11:15' },
  { start: '11:30', end: '12:15' }, { start: '12:15', end: '13:00' },
  { start: '13:15', end: '14:00' }, { start: '14:00', end: '14:45' }
];
const emptyDays = () => ({ 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] });
export const DEFAULT_TIMETABLE = {
  v: 2, travel_min: 10,
  schools: [{ id: 'a', name: 'مدرسة أ', periods: BELL }, { id: 'b', name: 'مدرسة ب', periods: BELL }],
  days: emptyDays()
};

// يحوّل أي شكل قديم (مدرسة واحدة) إلى الشكل الجديد، ويكمل الناقص
export function normalizeTimetable(tt) {
  const clone = x => JSON.parse(JSON.stringify(x));
  if (!tt) return clone(DEFAULT_TIMETABLE);
  if (tt.v === 2) {
    const out = clone(tt);
    out.travel_min = out.travel_min ?? 10;
    for (const def of DEFAULT_TIMETABLE.schools) if (!out.schools.find(s => s.id === def.id)) out.schools.push(clone(def));
    for (let d = 0; d < 7; d++) out.days[d] = out.days?.[d] || [];
    return out;
  }
  const out = clone(DEFAULT_TIMETABLE);                 // الشكل القديم: periods + days:{d:[1,2]}
  if (tt.periods?.length) out.schools[0].periods = clone(tt.periods);
  for (let d = 0; d < 7; d++) out.days[d] = (tt.days?.[d] || []).map(n => 'a' + n);
  return out;
}
export const schoolName = (tt, id) => normalizeTimetable(tt).schools.find(s => s.id === id)?.name || '';

// حصص اليوم مرتّبة: [{sid, n, school, s, e}]
function dayClasses(tt, day) {
  return (tt.days[weekdayOf(day)] || []).map(code => {
    const sid = code[0], n = +code.slice(1);
    const school = tt.schools.find(x => x.id === sid);
    const p = school?.periods?.[n - 1];
    return p?.start && p?.end ? { sid, n, school, s: toMin(p.start), e: toMin(p.end) } : null;
  }).filter(Boolean).sort((a, b) => a.s - b.s);
}

// حصص يوم معيّن + أوقات التنقّل ⇒ «أحداث» مشغولة للخطة
export function timetableEvents(timetable, day) {
  const tt = normalizeTimetable(timetable);
  const list = dayClasses(tt, day);
  const at = m => `${day}T${fromMin(m)}:00`;
  const ev = list.map(x => ({
    title: `حصة ${x.n}`, icon: '🏫', school: x.sid, code: x.sid + x.n, schoolName: x.school.name, color: SCHOOL_COLORS[x.sid],
    cal: x.school.name, start: at(x.s), end: at(x.e), allDay: false
  }));
  // 🚗 بين حصتين متتاليتين من مدرستين مختلفتين: نحجز وقت الطريق قبل الحصة الثانية
  for (let i = 1; i < list.length; i++) {
    const prev = list[i - 1], cur = list[i];
    if (prev.sid === cur.sid || !(tt.travel_min > 0)) continue;
    const start = Math.max(prev.e, cur.s - tt.travel_min);
    const tight = cur.s - prev.e < tt.travel_min;
    ev.push({ title: `تنقّل إلى ${cur.school.name}${tight ? ' (⚠️ الوقت ضيّق)' : ''}`, icon: '🚗', travel: true,
      start: at(start), end: at(cur.s), allDay: false });
  }
  return ev.sort((a, b) => a.start.localeCompare(b.start));
}

// «أين أنا اليوم؟»: المدارس بالترتيب مع عدد الحصص [{id, name, count}]
export function daySchools(timetable, day) {
  const tt = normalizeTimetable(timetable);
  const out = [];
  for (const x of dayClasses(tt, day)) {
    const last = out.at(-1);
    if (last?.id === x.sid) last.count++; else out.push({ id: x.sid, name: x.school.name, count: 1 });
  }
  return out;
}
// نهاية يوم المدرسة (آخر حصة) + الطريق ⇒ من متى أنت في البيت (بالدقائق)، أو null إن لا حصص
export function homeFrom(timetable, day) {
  const tt = normalizeTimetable(timetable);
  const list = dayClasses(tt, day);
  return list.length ? Math.max(...list.map(x => x.e)) + (tt.travel_min || 0) : null;
}

/* =====================================================================
   📝 رزم التصحيح
   ===================================================================== */
export const GRADE_MIN_DEFAULT = 8;           // دقائق الورقة الافتراضية
export const GRADING_GOAL_DEFAULT = 20;       // الهدف اليومي
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T12:00:00') - Date.parse(a + 'T12:00:00')) / 864e5);
export const gradeLeft = t => Math.max(0, (t.grade_total || 0) - (t.grade_done || 0));
// كم ورقة يجب تصحيحها اليوم حتى تُنهي قبل يوم التسليم
export function gradingQuota(t, day = todayStr()) {
  const left = gradeLeft(t);
  if (!left) return 0;
  if (!t.due_date || t.due_date <= day) return left;
  return Math.ceil(left / Math.max(1, daysBetween(day, t.due_date)));
}

// حصة اليوم من رزمة: نثبّتها من بداية اليوم (لا تصغر كلما صحّحت)
// doneToday = ما صحّحته اليوم من هذه الرزمة ⇒ {quota: حصة اليوم، doneToday، rem: الباقي منها اليوم}
export function gradingToday(t, doneToday = 0, day = todayStr()) {
  const quota = gradingQuota({ ...t, grade_done: Math.max(0, (t.grade_done || 0) - doneToday) }, day);
  return { quota, doneToday, rem: Math.max(0, quota - doneToday) };
}

/* =====================================================================
   🔄 التكرار المخصص
   القيم: daily · weekly · monthly · every:N (كل N أيام) · days:0,2,4 (أيام محددة، 0 = الأحد)
   ===================================================================== */
export const weekdayOf = str => { const [y, m, d] = str.split('-').map(Number); return new Date(y, m - 1, d).getDay(); };
export const parseDays = r => (r || '').startsWith('days:') ? r.slice(5).split(',').map(Number) : [];

// اسم التكرار للعرض: «كل يومين»، «أيام: أحد، ثلاثاء»…
export function recurLabel(r) {
  if (!r) return '';
  if (RECUR[r]) return RECUR[r];
  if (r.startsWith('every:')) {
    const n = +r.slice(6);
    return n === 1 ? 'يوميًا' : n === 2 ? 'كل يومين' : n <= 10 ? `كل ${n} أيام` : `كل ${n} يومًا`;
  }
  const days = parseDays(r);
  if (days.length === 7) return 'يوميًا';
  return days.length ? 'أيام: ' + days.map(d => DAY_SHORT[d]).join('، ') : '';
}

// أول تاريخ (من تاريخ معيّن فصاعدًا) يناسب «أيام محددة»
export function firstMatchingDay(r, from) {
  const days = parseDays(r);
  if (!days.length) return from;
  for (let i = 0; i < 7; i++) { const x = addDays(from, i); if (days.includes(weekdayOf(x))) return x; }
  return from;
}
