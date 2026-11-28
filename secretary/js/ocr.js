/* =====================================================================
   ocr.js — مهام من صورة 📷
   1) تختار صورة (كاميرا أو معرض): خط يد، لقطة شاشة، ورقة مطبوعة
   2) نحسّن الصورة (رمادي + تباين) ثم نقرأ النص بالعربية داخل الهاتف (Tesseract)
      ⇒ مجاني، والصورة لا تُرفع لأي خادم
   3) نقسّم النص إلى مهام ونكتشف التواريخ والأوقات والفئة
   4) تراجعها وتؤكد ⇒ تُضاف إلى جدول اليوم وتُرتَّب تلقائيًا
   ⚠️ صراحة: القراءة ممتازة للنص المطبوع ولقطات الشاشة، وأضعف مع خط اليد.
   ===================================================================== */
import * as store from './store.js';
import { $, show, onShow, toast, back } from './ui.js';
import { CATS, todayStr, addDays, fmtDue, guessCategory, esc } from './util.js';

// المكتبة وبيانات اللغة العربية تُحمَّل من CDN أول مرة فقط (ثم تُحفظ في الهاتف)
const TESS_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.esm.min.js';
const TESS_OPTS = {
  workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',
  corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1',
  langPath: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/ara@1.0.0/4.0.0_best_int'
};

let workerPromise = null;
let onProgress = null;   // دالة تحديث شريط التقدم الحالية

function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const mod = await import(TESS_URL);
      const Tesseract = mod.default || mod;
      return Tesseract.createWorker('ara', 1, { ...TESS_OPTS, logger: m => onProgress?.(m) });
    })();
    workerPromise.catch(() => { workerPromise = null; });   // نسمح بإعادة المحاولة
  }
  return workerPromise;
}

/* ---------- تحسين الصورة قبل القراءة ----------
   تكبير الصور الصغيرة، تصغير الكبيرة جدًا، تحويل للرمادي، وتمديد التباين */
async function prepare(file) {
  const bmp = await createImageBitmap(file);
  const big = Math.max(bmp.width, bmp.height);
  const scale = big > 2200 ? 2200 / big : big < 1200 ? 1200 / big : 1;
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  let min = 255, max = 0;
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    d[i] = g; if (g < min) min = g; if (g > max) max = g;
  }
  const range = Math.max(1, max - min);
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.max(0, Math.min(255, ((d[i] - min) / range) * 255));
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/* =====================================================================
   تحويل النص إلى مهام
   ===================================================================== */
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩', FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const normDigits = s => s.replace(/[٠-٩]/g, ch => AR_DIGITS.indexOf(ch)).replace(/[۰-۹]/g, ch => FA_DIGITS.indexOf(ch));
const WEEKDAYS = [['الأحد', 'الاحد'], ['الاثنين', 'الإثنين', 'الاتنين'], ['الثلاثاء', 'الثلاثا'], ['الأربعاء', 'الاربعاء', 'الاربعا'],
  ['الخميس'], ['الجمعة', 'الجمعه'], ['السبت']];

// اكتشاف التاريخ والوقت داخل سطر
export function detectDue(line) {
  const s = normDigits(line);
  const t0 = todayStr();
  let due_date = null, due_time = null;

  if (/بعد\s*(غد|بكر)/.test(s)) due_date = addDays(t0, 2);
  else if (/(غدا|غدًا|غداً|بكرا|بكره|بكرة)/.test(s)) due_date = addDays(t0, 1);
  else if (/اليوم/.test(s)) due_date = t0;
  else {
    const wd = WEEKDAYS.findIndex(names => names.some(n => s.includes(n)));
    if (wd >= 0) {
      const today = new Date().getDay();            // 0 = الأحد
      due_date = addDays(t0, (wd - today + 7) % 7);  // أقرب يوم بهذا الاسم (اليوم إن تطابق)
    }
  }
  // تاريخ رقمي: 30/11 أو 30.11 أو 30-11-2026
  const dm = s.match(/(?<!\d)(\d{1,2})[\/.\-](\d{1,2})(?:[\/.\-](\d{2,4}))?(?!\d)/);
  if (dm) {
    const d = +dm[1], m = +dm[2];
    let y = dm[3] ? +dm[3] : new Date().getFullYear();
    if (y < 100) y += 2000;
    if (d >= 1 && d <= 31 && m >= 1 && m <= 12) {
      const pad = n => String(n).padStart(2, '0');
      let iso = `${y}-${pad(m)}-${pad(d)}`;
      if (!dm[3] && iso < addDays(t0, -30)) iso = `${y + 1}-${pad(m)}-${pad(d)}`;   // تاريخ مضى ⇒ السنة القادمة
      due_date = iso;
    }
  }
  // وقت: 14:30 أو 8.15 مع ص/م اختياريًا، أو «الساعة 5»
  const tm = s.match(/(?<![\d\/.\-])(\d{1,2})[:](\d{2})\s*(ص|م|am|pm)?/i) || s.match(/الساعة\s*(\d{1,2})(?:[:.](\d{2}))?\s*(ص|م|am|pm)?/i);
  if (tm) {
    let h = +tm[1]; const min = tm[2] ? +tm[2] : 0; const ap = (tm[3] || '').toLowerCase();
    if ((ap === 'م' || ap === 'pm') && h < 12) h += 12;
    if ((ap === 'ص' || ap === 'am') && h === 12) h = 0;
    if (!ap && /الساعة/.test(tm[0]) && h >= 1 && h <= 6) h += 12;   // «الساعة 5» غالبًا مساءً
    if (h < 24 && min < 60) due_time = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  }
  if (due_time && !due_date) due_date = t0;
  return { due_date, due_time };
}

// تنظيف السطر: إزالة النقاط والترقيم وعلامات الصح من بدايته
const cleanLine = l => l
  .replace(/[‎‏‪-‮]/g, '')                 // علامات اتجاه خفية
  .replace(/^[\s\-–—•·*●○◦▪■□☐☑✓✔✗×>»«|_~=+]+/, '')
  .replace(/^[٠0oO°]\s+/, '').replace(/\s+[٠0oO°]\s*$/, '')    // نقطة القائمة «•» تُقرأ أحيانًا «٠»
  .replace(/^\(?\s*[0-9٠-٩]{1,2}\s*[\).\-:](?![0-9٠-٩])\s*/, '') // ترقيم «1.» أو «2)» (وليس وقتًا مثل 17:30)
  .replace(/\s+/g, ' ')
  .trim();

export function textToTasks(text) {
  const seen = new Set(), out = [];
  for (const raw of (text || '').split(/\r?\n/)) {
    const title = cleanLine(raw);
    const letters = (title.match(/[\p{L}]/gu) || []).length;
    if (letters < 3) continue;                                   // أرقام أو رموز فقط
    if (/^(\d{1,2}[:.]\d{2}\s*(ص|م|am|pm)?)$/i.test(normDigits(title))) continue;   // وقت رسالة واتساب وحده
    const key = title.replace(/\s/g, '');
    if (seen.has(key)) continue;
    seen.add(key);
    const { due_date, due_time } = detectDue(title);
    out.push({ title: title.slice(0, 500), due_date, due_time, category: guessCategory(title) || 'personal', selected: true });
    if (out.length >= 30) break;
  }
  return out;
}

/* =====================================================================
   الشاشة
   ===================================================================== */
let pendingFile = null;
let items = [];
let lastText = '';

export function startFromFile(file) {
  if (!file) return;
  pendingFile = file;
  show('photo');
}

onShow('photo', async () => {
  if (!pendingFile) return back();
  const file = pendingFile; pendingFile = null;
  items = []; lastText = '';
  $('#ph-preview').src = URL.createObjectURL(file);
  $('#ph-list').innerHTML = '';
  $('#ph-actions').hidden = true;
  $('#ph-raw-wrap').hidden = true;
  setStatus('⏳ نجهّز الصورة…', 5);

  try {
    const canvas = await prepare(file);
    onProgress = m => {
      if (m.status === 'recognizing text') setStatus(`🔎 أقرأ النص… ${Math.round(m.progress * 100)}%`, 30 + m.progress * 70);
      else if (/load|initializ/.test(m.status)) setStatus('⬇️ أحمّل قارئ العربية (أول مرة فقط، يحتاج إنترنت)…', 10 + (m.progress || 0) * 20);
    };
    const worker = await getWorker();
    const { data } = await worker.recognize(canvas);
    lastText = data.text || '';
    items = textToTasks(lastText);
    setStatus(items.length ? `✅ وجدتُ ${items.length} ${items.length > 2 && items.length < 11 ? 'مهام' : 'مهمة'}. راجعها ثم أكّد:` : '🤔 لم أجد نصًا واضحًا في الصورة.', 100);
    renderItems();
  } catch (e) {
    console.warn('ocr', e);
    setStatus(navigator.onLine ? '⚠️ تعذّرت قراءة الصورة. جرّب صورة أوضح.' : '📶 أول قراءة تحتاج إنترنت لتحميل قارئ العربية.', 100);
  } finally {
    onProgress = null;
  }
});

function setStatus(text, pct) {
  $('#ph-status').textContent = text;
  $('#ph-bar').style.width = `${Math.min(100, pct)}%`;
}

function renderItems() {
  $('#ph-raw').value = lastText;
  $('#ph-raw-wrap').hidden = !lastText.trim();
  $('#ph-actions').hidden = !items.length;
  $('#ph-list').innerHTML = items.map((it, i) => {
    const c = CATS[it.category];
    return `<li class="ph-item ${it.selected ? '' : 'off'}" data-i="${i}" style="--cat:var(--c-${it.category})">
      <button class="ph-check" data-act="toggle" aria-label="تحديد">${it.selected ? '☑️' : '⬜'}</button>
      <div class="ph-body">
        <input type="text" class="ph-title" value="${esc(it.title)}" aria-label="نص المهمة">
        <div class="ph-meta">
          <button class="ph-chip" data-act="cat">${c.icon} ${c.label}</button>
          ${it.due_date ? `<button class="ph-chip" data-act="due">📅 ${fmtDue(it.due_date, it.due_time)} ✕</button>` : ''}
        </div>
      </div>
    </li>`;
  }).join('');
  const n = items.filter(x => x.selected).length;
  $('#ph-add-plan').textContent = `📋 أضف ${n} إلى جدول اليوم`;
  $('#ph-add-inbox').textContent = `📥 أضف ${n} إلى المهام فقط`;
  $('#ph-add-plan').disabled = $('#ph-add-inbox').disabled = !n;
}

// النقر: تحديد/إلغاء، تغيير الفئة بالدوران، حذف التاريخ المكتشف
$('#ph-list').addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const it = items[+b.closest('li').dataset.i];
  if (b.dataset.act === 'toggle') it.selected = !it.selected;
  if (b.dataset.act === 'cat') { const keys = Object.keys(CATS); it.category = keys[(keys.indexOf(it.category) + 1) % keys.length]; }
  if (b.dataset.act === 'due') { it.due_date = null; it.due_time = null; }
  renderItems();
});
// تعديل النص (اختياري)
$('#ph-list').addEventListener('input', e => {
  if (!e.target.classList.contains('ph-title')) return;
  items[+e.target.closest('li').dataset.i].title = e.target.value;
});

// التأكيد: إضافة المهام المحددة
async function addSelected(toPlan) {
  const chosen = items.filter(x => x.selected && x.title.trim());
  const t0 = todayStr();
  for (const it of chosen) {
    const forToday = toPlan && (!it.due_date || it.due_date <= t0);
    await store.add({
      title: it.title, category: it.category, due_date: it.due_date, due_time: it.due_time, source: 'photo',
      ...(forToday ? { status: 'today', plan_date: t0 } : {})
    });
  }
  toast(`✅ أُضيفت ${chosen.length} من الصورة`);
  if (toPlan) {
    // ننتقل لجدول اليوم ونثبّت الأوقات تلقائيًا (للتذكير بالإشعارات)
    history.replaceState({ screen: 'plan' }, '');
    show('plan', { push: false, arg: { autoCommit: true } });
  } else back();
}
$('#ph-add-plan').onclick = () => addSelected(true);
$('#ph-add-inbox').onclick = () => addSelected(false);
$('#ph-close').onclick = () => back();
$('#ph-retry').onclick = () => $('#photo-input').click();
