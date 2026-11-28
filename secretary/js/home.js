/* =====================================================================
   home.js — الشاشة الرئيسية: إضافة مهمة + القائمة + تفاصيل المهمة
   ===================================================================== */
import * as store from './store.js';
import * as voice from './voice.js';
import { startFromFile } from './ocr.js';
import { $, show, onShow, toast, catButtons, selectCat, chips, pref, vibrate, openPicker, back } from './ui.js';
import { CATS, IMPORTANCE, DURATIONS, RECUR, todayStr, addDays, fmtDue, isOverdue, guessCategory, esc } from './util.js';

/* ---------- حالة نموذج الإضافة ---------- */
const form = {
  cat: pref.get('cat', 'school'),
  catTouched: false,     // هل اخترت الفئة بيدك لهذه المهمة؟
  due: 'none',           // none | today | tomorrow | pick
  pickDate: null,
  recur: '',
  source: null
};
const input = $('#task-input');

export function setupHome() {
  catButtons($('#cats'), form.cat, key => { form.cat = key; form.catTouched = true; pref.set('cat', key); });

  // تخمين الفئة تلقائيًا من النص (ما لم تخترها بيدك)
  input.addEventListener('input', () => {
    if (form.catTouched) return;
    const g = guessCategory(input.value);
    if (g && g !== form.cat) { form.cat = g; selectCat($('#cats'), g); }
  });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addTask(true); } });

  // رقائق الموعد
  const dueChips = $('#due-chips'), dateInput = $('#date-input');
  dueChips.onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.due === 'pick') { dateInput.min = todayStr(); return openPicker(dateInput); }
    form.due = b.dataset.due; paintDue();
  };
  dateInput.addEventListener('change', () => {
    if (!dateInput.value) return;
    form.due = 'pick'; form.pickDate = dateInput.value; paintDue();
  });
  $('#time-clear').onclick = () => { $('#time-input').value = ''; };

  // التكرار (المرحلة 5)
  chips($('#recur-chips'), [['', 'لا'], ['daily', 'يوميًا'], ['weekly', 'أسبوعيًا'], ['monthly', 'شهريًا']], '', v => {
    form.recur = v;
    if (v && form.due === 'none') { form.due = 'today'; paintDue(); }   // التكرار يحتاج تاريخ بداية
  });

  paintDue();
  $('#add-btn').onclick = () => addTask(false);
  setupMic();
  // 📷 مهام من صورة
  const photoInput = $('#photo-input');
  $('#photo-btn').onclick = () => photoInput.click();
  photoInput.addEventListener('change', () => {
    const f = photoInput.files?.[0];
    photoInput.value = '';          // حتى نستطيع اختيار نفس الصورة مرة أخرى
    if (f) startFromFile(f);
  });
  $('#task-list').addEventListener('click', onListClick);
}

function paintDue() {
  $('#due-chips').querySelectorAll('button').forEach(b => b.setAttribute('aria-checked', b.dataset.due === form.due));
  $('#pick-label').textContent = form.due === 'pick' && form.pickDate ? fmtDue(form.pickDate) : 'تاريخ';
  $('#time-row').hidden = form.due === 'none';
}

async function addTask(keepFocus) {
  const title = input.value.trim();
  if (!title) {
    input.classList.remove('shake'); void input.offsetWidth; input.classList.add('shake');
    return toast('اكتب المهمة أو اضغط 🎤 وقلها');
  }
  const due_date = { none: null, today: todayStr(), tomorrow: addDays(todayStr(), 1), pick: form.pickDate }[form.due];
  const due_time = due_date ? ($('#time-input').value || null) : null;
  const cat = form.cat, source = form.source || 'manual', recur = form.recur || null;

  // تهيئة النموذج للمهمة التالية (قبل الحفظ، حتى لا نمسح ما تكتبه بعدها مباشرة)
  input.value = ''; form.source = null; form.catTouched = false;
  form.due = 'none'; form.pickDate = null; $('#time-input').value = ''; paintDue();
  form.recur = ''; chips($('#recur-chips'), [['', 'لا'], ['daily', 'يوميًا'], ['weekly', 'أسبوعيًا'], ['monthly', 'شهريًا']], '', v => {
    form.recur = v; if (v && form.due === 'none') { form.due = 'today'; paintDue(); }
  });
  $('#more-opts').open = false;
  form.cat = pref.get('cat', 'school'); selectCat($('#cats'), form.cat);
  if (keepFocus) input.focus(); else input.blur();

  await store.add({ title, category: cat, due_date, due_time, source, recur });
  toast(`✓ أُضيفت إلى ${CATS[cat].icon} ${CATS[cat].label}${recur ? ' 🔄' : ''}`);
}

/* ---------- الميكروفون ---------- */
function setupMic() {
  const btn = $('#mic-btn');
  if (!voice.supported) {
    btn.onclick = () => toast('الإملاء غير مدعوم هنا. افتح التطبيق من Chrome، أو استخدم 🎤 في لوحة المفاتيح');
    return;
  }
  btn.onclick = () => {
    if (voice.isListening()) return voice.stop();
    const before = input.value.trim();
    btn.classList.add('listening');
    toast('🎙️ أسمعك… تكلّم الآن');
    voice.start({
      lang: pref.get('lang', 'ar-PS'),
      onText: text => {
        input.value = (before ? before + ' ' : '') + text;
        input.dispatchEvent(new Event('input'));
        form.source = 'voice';
      },
      onEnd: () => { btn.classList.remove('listening'); $('#toast').hidden = true; },
      onError: msg => toast(msg)
    });
  };
}

/* ---------- قائمة المهام المعلّقة ---------- */
export async function renderList() {
  const list = await store.pending();
  const all = await store.all();
  const kids = id => all.filter(t => t.parent_id === id);
  $('#count').textContent = list.length || '';
  $('#empty').hidden = list.length > 0;
  const done = await store.doneTodayCount();
  $('#done-today').textContent = done ? `أنجزتَ اليوم ${done} 💪` : '';

  $('#task-list').innerHTML = list.map(t => {
    const c = CATS[t.category] || CATS.personal;
    const due = fmtDue(t.due_date, t.due_time);
    const late = isOverdue(t.due_date);
    const k = kids(t.id);
    const steps = k.length ? ` · 🪜 ${k.filter(x => x.status === 'done').length}/${k.length}` : '';
    const planned = t.status === 'today' && t.plan_date === todayStr() ? ' · ☀️ اليوم' : '';
    return `<li class="task" data-id="${t.id}" style="--cat:var(--c-${t.category})">
      <button class="act done" data-act="done" aria-label="تمّت">✓</button>
      <button class="body" data-act="open">
        <div class="title">${esc(t.title)}</div>
        <div class="meta">${c.icon} ${c.label}${due ? ' · ' + (late ? `<span class="late">متأخرة · ${due}</span>` : due) : ''}${t.recur ? ' · 🔄' : ''}${steps}${planned}</div>
      </button>
      <button class="act" data-act="del" aria-label="حذف">🗑️</button>
    </li>`;
  }).join('');
}

async function onListClick(e) {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const li = b.closest('.task'), id = li.dataset.id;
  if (b.dataset.act === 'open') return show('details', { arg: id });
  li.classList.add('leaving');
  await new Promise(r => setTimeout(r, 220));
  if (b.dataset.act === 'done') {
    await store.complete(id);
    vibrate(30);
    toast('أحسنت! ✓', { label: 'تراجع', run: () => store.reopen(id) });
  } else {
    await store.remove(id);
    toast('حُذفت المهمة', { label: 'تراجع', run: () => store.restore(id) });
  }
}

/* =====================================================================
   تفاصيل المهمة: تعديل كل شيء + المهام الفرعية (الخطوات)
   كل تغيير يُحفظ فورًا.
   ===================================================================== */
let detailId = null;
onShow('details', id => { detailId = id; renderDetails(); });
window.addEventListener('sek:tasks-remote', () => { if (!$('[data-screen="details"]').hidden) renderDetails(); });

async function renderDetails() {
  const t = await store.get(detailId);
  if (!t || t.deleted) return back();
  const save = patch => store.update(t.id, patch);

  const title = $('#d-title');
  title.value = t.title;
  title.onchange = () => { const v = title.value.trim(); if (v) save({ title: v.slice(0, 500) }); };

  catButtons($('#d-cats'), t.category, v => save({ category: v }));
  chips($('#d-imp'), [['', '—'], ...Object.entries(IMPORTANCE).map(([k, v]) => [k, `${v.icon} ${k}`])], t.importance ?? '', v => save({ importance: v ? +v : null }));
  chips($('#d-dur'), [['', '—'], ...DURATIONS], t.duration_min ?? '', v => save({ duration_min: v ? +v : null }));
  chips($('#d-recur'), [['', 'لا'], ...Object.entries(RECUR)], t.recur ?? '', v => save({ recur: v || null, ...(v && !t.due_date ? { due_date: todayStr() } : {}) }));

  const d = $('#d-date'), tm = $('#d-time');
  d.value = t.due_date || ''; tm.value = t.due_time || '';
  d.onchange = () => save({ due_date: d.value || null });
  tm.onchange = () => save({ due_time: tm.value || null });
  $('#d-date-clear').onclick = () => { save({ due_date: null, due_time: null, sched_start: null }); d.value = ''; tm.value = ''; };
  $('#d-help').textContent = importanceHelp(t);

  // الخطوات الفرعية
  const kids = await store.children(t.id);
  $('#d-steps').innerHTML = kids.map(k => `<li class="step ${k.status === 'done' ? 'is-done' : ''}" data-id="${k.id}">
      <button class="act done" data-act="toggle">${k.status === 'done' ? '↩' : '✓'}</button>
      <span>${esc(k.title)}</span>
      <button class="act" data-act="del">🗑️</button></li>`).join('') || '<li class="muted small">لا خطوات بعد. قسّم المهمة الكبيرة إلى خطوات صغيرة.</li>';
  $('#d-steps').onclick = async e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const kid = b.closest('li').dataset.id, k = kids.find(x => x.id === kid);
    if (b.dataset.act === 'toggle') k.status === 'done' ? await store.reopen(kid) : await store.complete(kid);
    else await store.remove(kid);
    renderDetails();
  };
  const stepIn = $('#d-step-input');
  const addStep = async () => { const v = stepIn.value.trim(); if (!v) return; stepIn.value = ''; await store.addStep(t.id, v); renderDetails(); };
  $('#d-step-add').onclick = addStep;
  stepIn.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); addStep(); } };
  chips($('#d-split'), [[2, '✂️ قسّم إلى 2'], [3, '3'], [4, '4']], '', async n => { await store.split(t.id, +n); renderDetails(); });
  $('#d-split').hidden = kids.length > 0;

  $('#d-done').textContent = t.status === 'done' ? '↩ إعادة فتح' : '✓ أنهيت المهمة';
  $('#d-done').onclick = async () => { t.status === 'done' ? await store.reopen(t.id) : await store.complete(t.id); back(); };
  $('#d-delete').onclick = async () => { await store.remove(t.id); toast('حُذفت', { label: 'تراجع', run: () => store.restore(t.id) }); back(); };
}

function importanceHelp(t) {
  const bits = [];
  if (t.postpone_count) bits.push(`أُجّلت ${t.postpone_count} مرات`);
  if (t.focus_min) bits.push(`ركّزتَ عليها ${t.focus_min} دقيقة`);
  if (t.gcal_event_id) bits.push('📅 موجودة في تقويم «سكرتير صالح»');
  if (t.gtask_id) bits.push('📝 من Google Tasks (متزامنة)');
  return bits.join(' · ');
}

/* ---------- استقبال المشاركة (Web Share Target) ---------- */
export function handleIncomingShare() {
  const p = new URLSearchParams(location.search);
  if (!location.pathname.endsWith('/share-target')) return false;
  const parts = [p.get('title'), p.get('text'), p.get('url')].map(s => (s || '').trim()).filter(Boolean);
  const text = [...new Set(parts)].join(' — ').slice(0, 500);
  history.replaceState(null, '', './');
  if (!text) return false;

  $('#share-text').value = text;
  catButtons($('#share-cats'), guessCategory(text), async key => {
    const title = $('#share-text').value.trim();
    if (!title) return toast('النص فارغ');
    await store.add({ title, category: key, source: 'share' });
    pref.set('cat', key);
    back();
    toast(`✓ حُفظت في ${CATS[key].label}`);
  });
  $('#share-cancel').onclick = () => back();
  history.replaceState({ screen: 'home' }, '');
  show('share');
  return true;
}

export const focusInput = () => setTimeout(() => input.focus(), 300);
