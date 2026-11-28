/* =====================================================================
   ui.js — أدوات الواجهة المشتركة: التنقل بين الشاشات، Toast، أزرار الفئات
   ===================================================================== */
import { CATS } from './util.js';

export const $ = s => document.querySelector(s);
export const $$ = s => [...document.querySelectorAll(s)];

/* ---------- تفضيلات صغيرة في الهاتف (localStorage) ---------- */
export const pref = {
  get: (k, d) => { try { return localStorage.getItem('sek:' + k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem('sek:' + k, v); } catch { /* وضع خاص */ } }
};

/* ---------- التنقل: شاشة واحدة ظاهرة في كل مرة ----------
   كل شاشة يمكنها تسجيل دالة onShow تُستدعى عند ظهورها.
   زر الرجوع في Android يعيدك للشاشة السابقة (History API). */
const onShowFns = {};
export const onShow = (name, fn) => { onShowFns[name] = fn; };
export const ROOT = 'plan';          // الصفحة الأولى: مهام اليوم
export let current = ROOT;
export const TABS = ['plan', 'home', 'weekly'];

export function show(name, { push = true, arg } = {}) {
  $$('[data-screen]').forEach(s => { s.hidden = s.dataset.screen !== name; });
  if (push && name !== current && !TABS.includes(name)) history.pushState({ screen: name, arg }, '');
  if (TABS.includes(name)) history.replaceState({ screen: name }, '');   // التبويبات لا تتراكم في السجل
  current = name;
  // شريط التنقل السفلي يظهر فقط في الشاشات الرئيسية
  $('#tabbar').hidden = !TABS.includes(name);
  $$('#tabbar [data-tab]').forEach(b => b.setAttribute('aria-current', b.dataset.tab === name ? 'page' : 'false'));
  window.scrollTo(0, 0);
  onShowFns[name]?.(arg);
}
window.addEventListener('popstate', e => show(e.state?.screen || ROOT, { push: false, arg: e.state?.arg }));
export const back = () => history.back();
// الذهاب للرئيسية مع تنظيف السجل
// العودة للتبويب الذي جئنا منه (أو لصفحة اليوم)
export function goHome() {
  if (history.state?.screen && !TABS.includes(history.state.screen)) history.back();
  else show(ROOT, { push: false });
}

/* ---------- Toast: رسالة قصيرة مع زر اختياري (مثل «تراجع») ---------- */
let toastTimer;
export function toast(msg, action) {
  const el = $('#toast'), btn = $('#toast-action');
  $('#toast-msg').textContent = msg;
  btn.hidden = !action;
  if (action) {
    btn.textContent = action.label;
    btn.onclick = () => { el.hidden = true; action.run(); };
  }
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, action ? 5000 : 3000);
}
export const hideToast = () => { $('#toast').hidden = true; };

/* ---------- أزرار الفئات (شبكة 2×2) ---------- */
export function catButtons(container, selected, onPick) {
  container.innerHTML = Object.entries(CATS).map(([key, c]) =>
    `<button type="button" class="cat" role="radio" data-cat="${key}" aria-checked="${key === selected}">
       <span>${c.icon}</span><span>${c.label}</span></button>`).join('');
  container.onclick = e => {
    const b = e.target.closest('.cat'); if (!b) return;
    selectCat(container, b.dataset.cat);
    onPick(b.dataset.cat);
  };
}
export const selectCat = (container, key) =>
  container.querySelectorAll('.cat').forEach(x => x.setAttribute('aria-checked', x.dataset.cat === key));

/* ---------- رقائق اختيار عامة (chips) ----------
   options: [[value, label], ...] — onPick(value) */
export function chips(container, options, selected, onPick) {
  container.innerHTML = options.map(([v, l]) =>
    `<button type="button" data-v="${v}" aria-checked="${String(v) === String(selected)}">${l}</button>`).join('');
  container.onclick = e => {
    const b = e.target.closest('button[data-v]'); if (!b) return;
    container.querySelectorAll('button').forEach(x => x.setAttribute('aria-checked', x === b));
    onPick(b.dataset.v);
  };
}

export const vibrate = ms => { try { navigator.vibrate?.(ms); } catch { /* */ } };

// فتح منتقي التاريخ/الوقت الأصلي في الهاتف
export function openPicker(input) {
  try { input.showPicker(); } catch { input.focus(); input.click(); }
}

/* =====================================================================
   👆 سحب المهمة بالإصبع: لليمين ⇒ ✓ إنهاء، لليسار ⇒ 🗑️ حذف
   list: عنصر القائمة <ul> · كل مهمة <li data-id="…">
   نتجاهل السحب إذا بدأ على زر أو على مقبض الترتيب ⋮⋮
   ===================================================================== */
export function enableSwipe(list, { right, left }) {
  const LIMIT = 90;   // المسافة اللازمة لتنفيذ الإجراء (بالبكسل)
  let li = null, x0 = 0, y0 = 0, dx = 0, swiping = false, id = null;

  list.addEventListener('pointerdown', e => {
    if (e.target.closest('button, .handle, input')) return;
    li = e.target.closest('li[data-id]'); if (!li) return;
    x0 = e.clientX; y0 = e.clientY; dx = 0; swiping = false; id = e.pointerId;
  });
  list.addEventListener('pointermove', e => {
    if (!li || e.pointerId !== id) return;
    dx = e.clientX - x0;
    const dy = e.clientY - y0;
    if (!swiping) {
      if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { li = null; return; }   // تمرير عمودي عادي
      if (Math.abs(dx) < 12) return;
      swiping = true;
      try { li.setPointerCapture(id); } catch { /* */ }
    }
    li.style.transition = 'none';
    li.style.transform = `translateX(${dx}px)`;
    li.classList.toggle('swipe-done', dx > 30);
    li.classList.toggle('swipe-del', dx < -30);
  });
  const end = async () => {
    if (!li) return;
    const el = li, d = dx, was = swiping; li = null;
    el.style.transition = '';
    if (!was) return;
    // نمنع «النقرة» التي تأتي بعد السحب
    el.dataset.swiped = '1'; setTimeout(() => delete el.dataset.swiped, 400);
    if (d > LIMIT || d < -LIMIT) {
      el.style.transform = `translateX(${d > 0 ? 120 : -120}%)`;
      el.style.opacity = '0';
      vibrate(25);
      await new Promise(r => setTimeout(r, 180));
      (d > 0 ? right : left)(el.dataset.id);
    } else {
      el.style.transform = '';
      el.classList.remove('swipe-done', 'swipe-del');
    }
  };
  list.addEventListener('pointerup', end);
  list.addEventListener('pointercancel', end);
  // نقرة بعد سحب ⇒ تُلغى
  list.addEventListener('click', e => { if (e.target.closest('li')?.dataset.swiped) { e.stopPropagation(); e.preventDefault(); } }, true);
}
