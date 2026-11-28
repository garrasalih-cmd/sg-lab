/* =====================================================================
   review.js — مراجعة المساء 🌙 والمراجعة الأسبوعية 📊 (المرحلة 5)
   ===================================================================== */
import * as store from './store.js';
import { $, show, onShow, toast, vibrate, goHome } from './ui.js';
import { CATS, todayStr, addDays, weekdayShort, fmtDuration, esc, isOverdue, fmtDue } from './util.js';

/* =====================================================================
   🌙 مراجعة المساء: «أنجزتُ X من Y» + ترحيل غير المنجز بأزرار
   ===================================================================== */
const E = { queue: [], i: 0, moved: 0 };

onShow('evening', async () => {
  const day = todayStr();
  const { open, done } = await store.planTasks(day);
  const x = done.length, y = open.length + done.length;
  E.queue = open; E.i = 0; E.moved = 0;
  $('#e-stat').innerHTML = y
    ? `<div class="hero-num">${x}<span> من ${y}</span></div>
       <div class="progress"><div style="width:${Math.round(x / y * 100)}%"></div></div>
       <p>${cheer(x, y)}</p>`
    : `<div class="hero-num small">🌿</div><p>لم تكن لديك مهام مخطّطة اليوم.</p>`;
  nextEvening();
});

function cheer(x, y) {
  const r = x / y;
  if (r === 1) return 'يوم كامل! أنجزتَ كل شيء 🏆';
  if (r >= 0.7) return 'يوم ممتاز 👏';
  if (r >= 0.4) return 'تقدّم جيد، وغدًا يوم جديد 💪';
  return 'لا بأس، المهم أن نرحّل الباقي بذكاء 🌱';
}

function nextEvening() {
  const box = $('#e-task');
  if (E.i >= E.queue.length) {
    box.innerHTML = E.queue.length
      ? `<p class="center">✨ رتّبنا ما تبقّى. تصبح على خير 🌙</p>`
      : `<p class="center">تصبح على خير 🌙</p>`;
    $('#e-actions').innerHTML = `<button class="btn-ghost" data-v="weekly">📊 المراجعة الأسبوعية</button>
      <button class="btn-primary" data-v="home">🏠 الرئيسية</button>`;
    return;
  }
  const t = E.queue[E.i], c = CATS[t.category] || CATS.personal;
  box.innerHTML = `<p class="muted center">لم تُنجز بعد (${E.i + 1} من ${E.queue.length})</p>
    <div class="card m-card"><div class="m-title">${esc(t.title)}</div><div class="m-meta">${c.icon} ${c.label}</div></div>`;
  $('#e-actions').innerHTML = `<div class="m-answers grid2">
      <button class="big-choice ok" data-v="done">✓ أنجزتها</button>
      <button class="big-choice" data-v="tomorrow">🌙 غدًا</button>
      <button class="big-choice" data-v="later">📥 لاحقًا</button>
      <button class="big-choice danger" data-v="delete">🗑️ حذف</button></div>`;
}

$('#e-actions').addEventListener('click', async e => {
  const b = e.target.closest('[data-v]'); if (!b) return;
  const v = b.dataset.v;
  if (v === 'weekly') { history.replaceState({ screen: 'weekly' }, ''); return show('weekly', { push: false }); }
  if (v === 'home') return goHome();
  const t = E.queue[E.i];
  vibrate(15);
  if (v === 'done') await store.complete(t.id);
  if (v === 'tomorrow') {
    // قرار المساء: تدخل خطة الغد مباشرة (لا يسألك عنها الصباح مرة أخرى)
    await store.update(t.id, { status: 'today', plan_date: addDays(todayStr(), 1), postpone_count: (t.postpone_count || 0) + 1, ...(t.due_time ? {} : { sched_start: null }) });
  }
  if (v === 'later') await store.update(t.id, { status: 'inbox', plan_date: null, sched_start: null, postpone_count: (t.postpone_count || 0) + 1 });
  if (v === 'delete') { await store.remove(t.id); toast('حُذفت', { label: 'تراجع', run: () => store.restore(t.id) }); }
  E.i++;
  nextEvening();
});
$('#e-close').onclick = () => goHome();

/* =====================================================================
   📊 المراجعة الأسبوعية: ما أُنجز، ما تأخر، وأكثر فئة أخذت وقتك
   ===================================================================== */
onShow('weekly', async () => {
  const t0 = todayStr(), from = addDays(t0, -6);
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const list = await store.all();
  const dayOf = t => t.completed_at ? todayStr(new Date(t.completed_at)) : null;
  const doneWeek = list.filter(t => t.status === 'done' && dayOf(t) >= from && dayOf(t) <= t0);

  // ① المنجز يوميًا (أعمدة)
  const perDay = days.map(d => doneWeek.filter(t => dayOf(t) === d).length);
  const max = Math.max(1, ...perDay);
  $('#w-total').innerHTML = `<div class="hero-num">${doneWeek.length}</div><p class="muted">مهمة أُنجزت في آخر 7 أيام</p>`;
  $('#w-days').innerHTML = days.map((d, i) => `<div class="bar-col" title="${perDay[i]} مهام">
      <span class="bar-val">${perDay[i] || ''}</span>
      <div class="bar" style="height:${Math.max(perDay[i] ? 8 : 2, perDay[i] / max * 100)}%"></div>
      <span class="bar-lbl ${d === t0 ? 'today' : ''}">${weekdayShort(d)}</span></div>`).join('');
  $('#w-days-table').innerHTML = days.map((d, i) => `<tr><td>${weekdayShort(d)} ${d.slice(8)}/${+d.slice(5, 7)}</td><td>${perDay[i]}</td></tr>`).join('');

  // ② الوقت حسب الفئة: دقائق التركيز الفعلية، أو المدة المقدّرة
  const mins = {};
  for (const t of doneWeek) mins[t.category] = (mins[t.category] || 0) + (t.focus_min || t.duration_min || 0);
  const counts = {};
  for (const t of doneWeek) counts[t.category] = (counts[t.category] || 0) + 1;
  const useMins = Object.values(mins).some(Boolean);
  const vals = Object.keys(CATS).map(k => [k, useMins ? (mins[k] || 0) : (counts[k] || 0)]).sort((a, b) => b[1] - a[1]);
  const top = vals[0];
  const vmax = Math.max(1, top[1]);
  $('#w-top').textContent = top[1] ? `أكثر فئة أخذت وقتك: ${CATS[top[0]].icon} ${CATS[top[0]].label}` : 'لا بيانات كافية بعد';
  $('#w-cats').innerHTML = vals.map(([k, v]) => `<div class="hbar-row">
      <span class="hbar-lbl">${CATS[k].icon} ${CATS[k].label}</span>
      <div class="hbar-track"><div class="hbar" style="width:${v / vmax * 100}%; background:var(--c-${k})"></div></div>
      <span class="hbar-val">${useMins ? fmtDuration(v) || '0' : v}</span></div>`).join('');
  $('#w-cats-note').textContent = useMins ? 'حسب دقائق التركيز أو المدة المقدّرة للمهام المنجزة' : 'عدد المهام المنجزة (حدّد المدد في وضع الصباح لترى الوقت)';

  // ③ ما تأخّر: متأخرة عن موعدها، أو أُجّلت مرتين فأكثر
  const late = list.filter(t => t.status !== 'done' && !t.parent_id && (isOverdue(t.due_date) || (t.postpone_count || 0) >= 2))
    .sort((a, b) => (b.postpone_count || 0) - (a.postpone_count || 0)).slice(0, 8);
  $('#w-late').innerHTML = late.length
    ? late.map(t => `<li>${CATS[t.category]?.icon || ''} ${esc(t.title)} <span class="muted small">${t.postpone_count ? `· أُجّلت ${t.postpone_count}` : ''}${isOverdue(t.due_date) ? ` · كانت ${fmtDue(t.due_date)}` : ''}</span></li>`).join('')
    : '<li class="muted">لا شيء متأخر 👏</li>';
});
