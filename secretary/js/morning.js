/* =====================================================================
   morning.js — وضع الصباح ☀️ (المرحلة 2)
   مهمة واحدة في كل مرة، وثلاثة أسئلة بأزرار كبيرة فقط (بدون كتابة):
     ① الأهمية  ② المدة  ③ القرار (اليوم / غدًا / حذف)
   إذا أُجّلت مهمة 3 مرات ⇒ [احذفها] [قسّمها] [حدّد لها وقتًا]
   ===================================================================== */
import * as store from './store.js';
import { $, show, onShow, toast, vibrate, chips, openPicker, goHome } from './ui.js';
import { CATS, IMPORTANCE, DURATIONS, fmtDue, fmtDuration, todayStr, addDays, esc } from './util.js';
import { getSettings } from './sync.js';

const S = { queue: [], i: 0, step: 'imp', task: null, history: [], stats: { today: 0, tomorrow: 0, deleted: 0 }, when: {} };

export function start() { show('morning'); }

onShow('morning', async () => {
  S.queue = await store.morningQueue();
  S.i = 0; S.history = [];
  S.stats = { today: 0, tomorrow: 0, deleted: 0 };
  const s = await getSettings();
  $('#m-hello').textContent = `☀️ صباح الخير${s.name ? ' يا ' + s.name : ''}`;
  next(true);
});

// الانتقال للمهمة التالية
async function next(first = false) {
  if (!first) S.i++;
  if (S.i >= S.queue.length) return finish();
  S.task = await store.get(S.queue[S.i].id);
  if (!S.task || S.task.deleted || S.task.status === 'done') return next();
  // إذا عرفنا الأهمية والمدة من قبل ⇒ نقفز مباشرة للقرار (أسرع)
  S.step = S.task.importance && S.task.duration_min ? 'dec' : 'imp';
  S.history = [];
  render();
}

function go(step) { S.history.push(S.step); S.step = step; render(); }

function render() {
  const t = S.task, c = CATS[t.category] || CATS.personal;
  const total = S.queue.length;
  $('#m-progress').textContent = `${S.i + 1} / ${total}`;
  $('#m-bar').style.width = `${(S.i / total) * 100}%`;
  $('#m-back').hidden = !S.history.length;

  const meta = [
    `${c.icon} ${c.label}`,
    t.due_date ? '📅 ' + fmtDue(t.due_date, t.due_time) : '',
    t.postpone_count ? `🔁 أُجّلت ${t.postpone_count} ${t.postpone_count === 1 ? 'مرة' : 'مرات'}` : '',
    t.recur ? '🔄 متكررة' : ''
  ].filter(Boolean).join(' · ');
  $('#m-card').innerHTML = `<div class="m-title">${esc(t.title)}</div><div class="m-meta">${meta}</div>
    ${t.importance && S.step === 'dec' ? `<button class="m-known" id="m-edit">${IMPORTANCE[t.importance].icon} ${IMPORTANCE[t.importance].label} · ⏱️ ${fmtDuration(t.duration_min)} · ✏️ تعديل</button>` : ''}`;
  $('#m-edit')?.addEventListener('click', () => go('imp'));

  const Q = $('#m-question'), A = $('#m-answers');
  A.className = 'm-answers';
  switch (S.step) {
    case 'imp':
      Q.textContent = 'ما أهميتها؟';
      A.innerHTML = Object.entries(IMPORTANCE).map(([k, v]) =>
        `<button class="big-choice imp-${k}" data-v="${k}"><b>${k}</b> ${v.icon} ${v.label}</button>`).join('');
      A.onclick = pick(async v => { await store.update(t.id, { importance: +v }); S.task.importance = +v; go('dur'); });
      break;

    case 'dur':
      Q.textContent = 'كم تحتاج من الوقت؟';
      A.classList.add('grid2');
      A.innerHTML = DURATIONS.map(([m, l]) => `<button class="big-choice" data-v="${m}">⏱️ ${l}</button>`).join('');
      A.onclick = pick(async v => { await store.update(t.id, { duration_min: +v }); S.task.duration_min = +v; go('dec'); });
      break;

    case 'dec':
      Q.textContent = 'متى تنجزها؟';
      A.classList.add('grid3');
      A.innerHTML = `<button class="big-choice tall ok" data-v="today">☀️<br>اليوم</button>
        <button class="big-choice tall" data-v="tomorrow">🌙<br>غدًا</button>
        <button class="big-choice tall danger" data-v="delete">🗑️<br>حذف</button>`;
      A.onclick = pick(decide);
      break;

    case 'alert':
      Q.innerHTML = `أجّلتَ هذه المهمة ${t.postpone_count + 1} مرات 🤔<br><small>ماذا نفعل بها؟</small>`;
      A.innerHTML = `<button class="big-choice danger" data-v="delete">🗑️ احذفها، لم تعد مهمة</button>
        <button class="big-choice" data-v="split">✂️ قسّمها إلى خطوات صغيرة</button>
        <button class="big-choice ok" data-v="when">📅 حدّد لها وقتًا ثابتًا</button>
        <button class="link center" data-v="force">أجّلها مع ذلك</button>`;
      A.onclick = pick(async v => {
        if (v === 'delete') return decide('delete');
        if (v === 'split') return go('split');
        if (v === 'when') return go('when');
        if (v === 'force') return postpone();
      });
      break;

    case 'split':
      Q.textContent = 'إلى كم خطوة نقسّمها؟';
      A.classList.add('grid3');
      A.innerHTML = [2, 3, 4].map(n => `<button class="big-choice tall" data-v="${n}">${n}<br>خطوات</button>`).join('');
      A.onclick = pick(async n => {
        const kids = await store.split(t.id, +n);
        // نضيف الخطوات الجديدة للطابور الآن، لنسأل عن كل واحدة
        S.queue.splice(S.i + 1, 0, ...kids);
        toast(`✂️ قُسّمت إلى ${n} خطوات. لنرتّبها الآن`);
        next();
      });
      break;

    case 'when': {
      // تحديد وقت ثابت: أزرار للتاريخ + منتقي الساعة الأصلي (بدون كتابة)
      Q.textContent = 'متى بالضبط؟';
      const t0 = todayStr();
      S.when = { date: t0, time: '' };
      A.innerHTML = `<div class="chips" id="w-days"></div>
        <button class="big-choice" id="w-time-btn">⏰ <span id="w-time-label">اختر الساعة</span></button>
        <input type="time" id="w-time" class="visually-hidden" tabindex="-1">
        <button class="btn-primary" id="w-save" disabled>✓ ثبّت الموعد</button>`;
      chips($('#w-days'), [[t0, 'اليوم'], [addDays(t0, 1), 'غدًا'], [addDays(t0, 2), 'بعد غد'], [addDays(t0, 7), 'بعد أسبوع']], t0, v => { S.when.date = v; });
      const ti = $('#w-time');
      $('#w-time-btn').onclick = () => openPicker(ti);
      ti.onchange = () => { S.when.time = ti.value; $('#w-time-label').textContent = 'الساعة ' + ti.value; $('#w-save').disabled = !ti.value; };
      $('#w-save').onclick = async () => {
        const { date, time } = S.when;
        await store.update(t.id, {
          due_date: date, due_time: time, plan_date: date, status: 'today', postpone_count: 0
        });
        date === t0 ? S.stats.today++ : S.stats.tomorrow++;
        vibrate(20); toast(`📅 ثُبّتت: ${fmtDue(date, time)}`);
        next();
      };
      A.onclick = null;
      break;
    }
  }
}

// غلاف للنقر: يقرأ data-v من الزر
const pick = fn => e => {
  const b = e.target.closest('[data-v]'); if (!b) return;
  vibrate(15);
  fn(b.dataset.v);
};

async function decide(v) {
  const t = S.task, t0 = todayStr();
  if (v === 'today') {
    await store.update(t.id, { status: 'today', plan_date: t0 });
    S.stats.today++;
    return next();
  }
  if (v === 'delete') {
    await store.remove(t.id);
    S.stats.deleted++;
    toast('حُذفت', { label: 'تراجع', run: () => store.restore(t.id) });
    return next();
  }
  if (v === 'tomorrow') {
    // التأجيل الثالث ⇒ تنبيه
    if ((t.postpone_count || 0) + 1 >= 3) return go('alert');
    return postpone();
  }
}

async function postpone() {
  const t = S.task;
  await store.update(t.id, {
    status: 'inbox', plan_date: addDays(todayStr(), 1),
    postpone_count: (t.postpone_count || 0) + 1,
    // نلغي الوقت المجدول إلا إذا كانت لها ساعة ثابتة
    ...(t.due_time ? {} : { sched_start: null })
  });
  S.stats.tomorrow++;
  next();
}

function finish() {
  const { today, tomorrow, deleted } = S.stats;
  $('#m-bar').style.width = '100%';
  $('#m-progress').textContent = '';
  $('#m-back').hidden = true;
  $('#m-card').innerHTML = S.queue.length
    ? `<div class="m-title">✨ رتّبنا يومك</div>
       <div class="m-summary"><div><b>${today}</b>لليوم</div><div><b>${tomorrow}</b>لغدٍ</div><div><b>${deleted}</b>حُذفت</div></div>`
    : `<div class="m-title">🎉 لا مهام تنتظر الترتيب</div><div class="m-meta">كل شيء مرتّب. يوم موفّق!</div>`;
  $('#m-question').textContent = '';
  const A = $('#m-answers');
  A.className = 'm-answers';
  A.innerHTML = `<button class="btn-primary" data-v="plan">📋 اعرض خطة اليوم</button>
    <button class="btn-ghost" data-v="home">🏠 الرئيسية</button>`;
  A.onclick = pick(v => {
    if (v === 'plan') { history.replaceState({ screen: 'plan' }, ''); show('plan', { push: false }); }
    else goHome();
  });
}

$('#m-back').onclick = () => { if (S.history.length) { S.step = S.history.pop(); render(); } };
$('#m-close').onclick = () => goHome();
