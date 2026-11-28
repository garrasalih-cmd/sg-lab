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
