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

/* ---------- التواريخ ----------
   نخزّن التاريخ نصًّا بصيغة YYYY-MM-DD حسب توقيت الهاتف المحلي
   (وليس UTC) حتى لا "يقفز" اليوم بعد منتصف الليل. */
const pad = n => String(n).padStart(2, '0');
export const dateStr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayStr = () => dateStr(new Date());
export const addDays = (str, n) => {
  const [y, m, d] = str.split('-').map(Number);
  return dateStr(new Date(y, m - 1, d + n));
};

// u-nu-latn = أرقام 1 2 3 (وليس ١ ٢ ٣)
const LOCALE = 'ar-u-nu-latn';
export const longToday = () =>
  new Intl.DateTimeFormat(LOCALE, { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());

// عرض الموعد بشكل ودّي: "اليوم 14:00"، "غدًا"، "متأخرة · أمس"، "الأحد 30/11"
export function fmtDue(due_date, due_time) {
  if (!due_date) return '';
  const t = todayStr();
  const time = due_time ? ' ' + due_time.slice(0, 5) : '';
  if (due_date === t) return 'اليوم' + time;
  if (due_date === addDays(t, 1)) return 'غدًا' + time;
  if (due_date === addDays(t, -1)) return 'أمس' + time;
  const [y, m, d] = due_date.split('-').map(Number);
  const day = new Intl.DateTimeFormat(LOCALE, { weekday: 'long' }).format(new Date(y, m - 1, d));
  return `${day} ${d}/${m}` + time;
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
  return null; // لم نعرف: نترك اختيارك كما هو
}

// حماية من HTML داخل عناوين المهام (مثلًا نص منسوخ من واتساب)
export const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
