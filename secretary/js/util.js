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
