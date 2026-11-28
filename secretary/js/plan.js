/* =====================================================================
   plan.js — شاشة خطة اليوم 📋 (المرحلة 3)
   • أهم 3 مهام في الأعلى ⭐
   • الباقي موزّع على فترات الفراغ بين حصصك ومواعيدك
   • ✓ للإنهاء، ⋮⋮ اسحب لتغيير الترتيب، ▶️ وضع التركيز
   • 🔊 ملخص صوتي بالعربية (Text-to-Speech)
   ===================================================================== */
import * as store from './store.js';
import { planDay, findConflicts } from './planner.js';
import { eventsFor, gcal } from './calendar.js';
import { getSettings } from './sync.js';
import { $, show, onShow, toast, vibrate, enableSwipe } from './ui.js';
import { CATS, IMPORTANCE, todayStr, fromMin, fmtRange, localISO, fmtDuration, esc, longToday, timetableEvents, fmtDue,
  daySchools, homeFrom, gradingQuota, gradingToday, GRADE_MIN_DEFAULT, SCHOOL_DOTS } from './util.js';
import * as focus from './focus.js';
import { openAdd } from './home.js';

let last = null;   // آخر خطة محسوبة

onShow('plan', arg => render(true, arg));
window.addEventListener('sek:tasks', () => { if (!$('[data-screen="plan"]').hidden) render(false); });
window.addEventListener('sek:tasks-remote', () => { if (!$('[data-screen="plan"]').hidden) render(false); });

async function render(fetchEvents, arg) {
  const day = todayStr();
  $('#p-date').textContent = longToday();
  const settings = await getSettings();
  const { open: raw, done } = await store.planTasks(day);
  // 📝 رزمة تصحيح ⇒ مهمة مدتها (أوراق اليوم × دقائق الورقة)، وتُوضع بعد عودتك للبيت
  const home = homeFrom(settings.timetable, day);
  const by = settings.grade_by?.[day] || {};
  const all = raw.map(t => {
    if (!t.grade_total) return t;
    const g = gradingToday(t, by[t.id] || 0, day);
    return { ...t, _g: g, duration_min: Math.max(5, g.rem * (t.grade_min || GRADE_MIN_DEFAULT)), after: home ?? 0 };
  });
  // ✅ رزمة أنهيت حصة اليوم منها ⇒ لا تحتاج وقتًا في الجدول، وتظهر بإشارة ✓
  const open = all.filter(t => !t._g || t._g.rem > 0);
  const gradedDone = all.filter(t => t._g && t._g.rem === 0);
  // نعرض الأحداث المحفوظة فورًا، ثم نحدّثها من الإنترنت
  // 🏫 حصص اليوم من جدولك = أوقات مشغولة لا توضع فيها مهام
  const classes = timetableEvents(settings.timetable, day);
  let events = [...classes, ...await eventsFor(day, { refresh: false })];
  draw({ open, done, gradedDone, events, settings, day });
  if (fetchEvents && gcal.connected) {
    events = [...classes, ...await eventsFor(day, { refresh: true })];
    draw({ open, done, gradedDone, events, settings, day });
  }
  // قادم من «مهام من صورة»: نثبّت الأوقات تلقائيًا حتى تصلك إشعارات التذكير
  if (arg?.autoCommit && !$('#p-commit').disabled) $('#p-commit').click();
}

function draw({ open, done, gradedDone = [], events, settings, day }) {
  const plan = planDay({ tasks: open, events, settings, day });
  last = { plan, day };
  drawClasses(events, settings, day);
  drawGrading([...open, ...gradedDone], settings, day);
  // ⚠️ التداخل: مهام بساعة ثابتة تتقاطع مع حصة أو مع مهمة أخرى
  const conflicts = findConflicts({ tasks: open, events, day });
  const cb = $('#p-conflicts');
  cb.hidden = !conflicts.size;
  cb.innerHTML = conflicts.size ? `⚠️ <b>${conflicts.size === 1 ? 'مهمة واحدة تتداخل' : conflicts.size === 2 ? 'مهمتان تتداخلان' : conflicts.size + ' مهام تتداخل'}</b> مع حصة أو مع مهمة أخرى. اضغط المهمة لتغيير وقتها.` : '';
  const list = $('#p-list');
  // 🏫 حصص اليوم داخل القائمة، كل حصة بزر ✓
  const classes = events.filter(e => e.icon === '🏫' && e.code);
  const classDone = new Set(settings.class_done?.[day] || []);
  const nClassDone = classes.filter(c => classDone.has(c.code)).length;
  const total = done.length + open.length + gradedDone.length + classes.length;
  const ok = done.length + gradedDone.length + nClassDone;
  $('#p-empty').hidden = open.length + classes.length + gradedDone.length > 0;
  $('#p-done-count').textContent = ok ? `✅ أنجزتَ ${ok} من ${total}` : '';

  const nowMin0 = new Date().getHours() * 60 + new Date().getMinutes(), isToday = day === todayStr();
  const hm = iso => { const d = new Date(iso); return d.getHours() * 60 + d.getMinutes(); };
  const classLi = c => {
    const s = hm(c.start), e = hm(c.end), on = classDone.has(c.code);
    const state = on ? '✅ تمّت' : !isToday ? '' : nowMin0 >= e ? 'انتهت؟ اضغط ✓' : nowMin0 >= s ? '<b>الآن</b>' : '';
    return `<li class="plan-item class-item ${on ? 'is-done' : ''}" data-class="${c.code}" style="--cat:${c.color || 'var(--c-school)'}">
      <button class="act done ${on ? 'checked' : ''}" data-act="class" aria-pressed="${on}" aria-label="${on ? 'إلغاء إشارة الحصة' : 'أنهيت الحصة'}">✓</button>
      <div class="body"><div class="title">${SCHOOL_DOTS[c.school] || '🏫'} ${esc(c.title)} · ${esc(c.schoolName || '')}</div>
        <div class="meta">📌 ${fmtRange(s, e)}${state ? ' · ' + state : ''}</div></div></li>`;
  };
  // نضع كل حصة قبل أول مهمة يبدأ وقتها بعدها ⇒ القائمة تقرأ كيومك
  let ci = 0;
  const before = start => { let h = ''; while (ci < classes.length && hm(classes[ci].start) <= start) h += classLi(classes[ci++]); return h; };

  // ---- القائمة المرتّبة (قابلة للسحب) ----
  list.innerHTML = plan.ordered.map((t, i) => {
    const sl = plan.slots.get(t.id);
    return before(sl ? sl.start : -1) + taskLi(t, i);
  }).join('') + classes.slice(ci).map(classLi).join('') + gradedDone.map(t => `
    <li class="plan-item grading is-done" data-id="${t.id}" style="--cat:var(--c-school)">
      <button class="act done checked" data-act="gundo" aria-label="تراجع عن تصحيح اليوم">✓</button>
      <div class="body" data-act="open">
        <div class="title">📝 ${esc(t.title)}</div>
        <div class="meta">✅ أنهيت تصحيح اليوم (${t._g.doneToday} ${t._g.doneToday > 2 && t._g.doneToday < 11 ? 'أوراق' : 'ورقة'}) · بقي ${t.grade_total - (t.grade_done || 0)} للرزمة</div>
        <div class="gbar"><div style="width:${Math.round((t.grade_done || 0) / t.grade_total * 100)}%"></div></div>
      </div>
      <button class="act plus" data-act="g1" aria-label="صحّحت ورقة إضافية">+1</button>
    </li>`).join('');
  drawRest({ plan, open, done, day });

  function taskLi(t, i) {
    const slot = plan.slots.get(t.id);
    const c = CATS[t.category] || CATS.personal;
    // 📌 وقت ثابت حدّدته أنت، أو ⏱️ بدون وقت مع اقتراح من السكرتير
    const time = !slot ? '⚠️ لا فراغ له اليوم'
      : slot.fixed ? `📌 ${fmtRange(slot.start, slot.end)}`
      : `⏱️ بدون وقت · مقترح ${fromMin(slot.start)}`;
    const imp = t.importance ? IMPORTANCE[t.importance].icon : '';
    if (t.grade_total) {
      const pct = Math.round((t.grade_done || 0) / t.grade_total * 100), g = t._g;
      return `<li class="plan-item grading ${i < 3 ? 'top' : ''} ${i === 3 ? 'first-rest' : ''}" data-id="${t.id}" style="--cat:var(--c-school)">
        <span class="handle" aria-label="اسحب لتغيير الترتيب">⋮⋮</span>
        <button class="act done" data-act="gdone" aria-label="أنهيت تصحيح اليوم">✓</button>
        <div class="body" data-act="open">
          <div class="title">${i < 3 ? `<span class="star">⭐${i + 1}</span> ` : ''}📝 ${esc(t.title)}</div>
          <div class="meta">📝 اليوم <b>${g.doneToday} / ${g.quota}</b> · <span class="${slot ? '' : 'late'}">${slot ? fromMin(slot.start) : '⚠️ لا فراغ'}</span> · ${fmtDuration(t.duration_min)}</div>
          <div class="gbar"><div style="width:${pct}%"></div></div>
          <div class="meta">${t.grade_done || 0}/${t.grade_total} ✓ · بقي ${t.grade_total - (t.grade_done || 0)}</div>
        </div>
        <button class="act plus" data-act="g1" aria-label="صحّحت ورقة">+1</button>
        <button class="act" data-act="focus" aria-label="جلسة تصحيح مركّزة">▶️</button>
      </li>`;
    }
    return `<li class="plan-item ${i < 3 ? 'top' : ''} ${i === 3 ? 'first-rest' : ''}" data-id="${t.id}" style="--cat:var(--c-${t.category})">
      <span class="handle" aria-label="اسحب لتغيير الترتيب">⋮⋮</span>
      <button class="act done" data-act="done" aria-label="تمّت">✓</button>
      <div class="body" data-act="open">
        <div class="title">${i < 3 ? `<span class="star">⭐${i + 1}</span> ` : ''}${esc(t.title)}</div>
        <div class="meta">${imp} ${c.icon} · <span class="${slot ? '' : 'late'}">${time}</span>${t.duration_min ? ' · ' + fmtDuration(t.duration_min) : ''}</div>
        ${conflicts.has(t.id) ? `<div class="conflict">⚠️ تتداخل مع: ${conflicts.get(t.id).map(esc).join('، ')}</div>` : ''}
      </div>
      <button class="act" data-act="focus" aria-label="وضع التركيز">▶️</button>
      <button class="act" data-act="del" aria-label="حذف">🗑️</button>
    </li>`;
  }
}

function drawRest({ plan, open, done, day }) {
  // ---- الجدول الزمني (الأحداث + المهام) ----
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  let markerDone = false;
  $('#p-timeline').innerHTML = plan.timeline.map(it => {
    let marker = '';
    if (!markerDone && !it.allDay && it.start >= nowMin) { marker = `<li class="now-line">الآن ${fromMin(nowMin)}</li>`; markerDone = true; }
    if (it.kind === 'event') {
      return marker + `<li class="tl event">${it.allDay ? '<span class="tl-time">طوال اليوم</span>' : `<span class="tl-time">${fromMin(it.start)}</span>`}
        <span>${it.icon || '📅'} ${esc(it.title)}${it.schoolName ? ' · ' + esc(it.schoolName) : ''}</span></li>`;
    }
    return marker + `<li class="tl task" style="--cat:var(--c-${it.task.category})"><span class="tl-time">${fromMin(it.start)}</span>
      <span>${CATS[it.task.category]?.icon || ''} ${esc(it.task.title)}</span></li>`;
  }).join('') + (markerDone ? '' : `<li class="now-line">الآن ${fromMin(nowMin)}</li>`);
  $('#p-timeline-wrap').hidden = !plan.timeline.length;

  // ---- زر التثبيت: هل الأوقات المحفوظة تطابق الخطة؟ ----
  const pending = changesToCommit(plan, day);
  const btn = $('#p-commit');
  btn.hidden = !open.length;
  btn.disabled = !pending.length;
  btn.textContent = !pending.length ? '✓ الخطة مثبّتة' : gcal.connected ? '📌 ثبّت الخطة في Google Calendar' : '📌 ثبّت الأوقات (للتذكير)';

  // ---- المنجزة اليوم ----
  $('#p-done').innerHTML = done.map(t => `<li class="done-item" data-id="${t.id}">✓ ${esc(t.title)}
    <button class="link" data-act="undo">تراجع</button></li>`).join('');
  $('#p-clear-done').hidden = !done.length;
  $('#p-clear-done').textContent = `🧹 مسح المنجزة (${done.length})`;
}

// ما الذي تغيّر بين الخطة والأوقات المحفوظة؟
function changesToCommit(plan, day) {
  const out = [];
  for (const t of plan.ordered) {
    const slot = plan.slots.get(t.id);
    if (slot?.fixed) continue;
    const want = slot ? localISO(day, fromMin(slot.start)) : null;
    if ((t.sched_start || null) !== want) out.push([t.id, want]);
  }
  return out;
}

$('#p-commit').onclick = async () => {
  if (!last) return;
  const changes = changesToCommit(last.plan, last.day);
  for (const [id, sched_start] of changes) await store.update(id, { sched_start }, { silent: true });
  window.dispatchEvent(new Event('sek:tasks'));
  vibrate(20);
  toast(gcal.connected ? '📅 أُرسلت الخطة إلى تقويم «سكرتير صالح»' : '📌 ثُبّتت الأوقات');
};

/* ---------- النقر: ✓ / ▶️ / تراجع ---------- */
$('#p-list').addEventListener('click', async e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const li = b.closest('li'), id = li.dataset.id;
  if (b.dataset.act === 'class') {                  // 🏫 ✓ أنهيت الحصة
    vibrate(20);
    const on = await store.toggleClass(li.dataset.class);
    if (on) toast('✓ أنهيت الحصة', { label: 'تراجع', run: () => store.toggleClass(li.dataset.class) });
  } else if (b.dataset.act === 'gdone') {           // 📝 ✓ أنهيت تصحيح اليوم كله
    await markGradingDone(id);
  } else if (b.dataset.act === 'gundo') {
    toast('صحّحت حصة اليوم ✓ · اضغط +1 إن صحّحت أكثر، أو افتح الرزمة لتعديل العدد');
  } else if (b.dataset.act === 'done') {
    b.closest('li').classList.add('leaving');
    vibrate(30);
    await new Promise(r => setTimeout(r, 200));
    await store.complete(id);
    toast('أحسنت! ✓', { label: 'تراجع', run: () => store.reopen(id) });
  } else if (b.dataset.act === 'g1') {
    const t = await store.gradeStep(id, 1);       // 📝 ورقة أخرى
    vibrate(15);
    if (t) toast(t.grade_done >= t.grade_total ? '🎉 اكتملت الرزمة!' : `📝 ${t.grade_done}/${t.grade_total}`, { label: 'تراجع', run: () => store.gradeStep(id, -1) });
  } else if (b.dataset.act === 'focus') {
    focus.start(id);
  } else if (b.dataset.act === 'open') {
    show('details', { arg: id });                 // اضغط المهمة لتعديلها
  } else if (b.dataset.act === 'del') {
    b.closest('li').classList.add('leaving');
    await new Promise(r => setTimeout(r, 200));
    await store.remove(id);
    toast('🗑️ حُذفت المهمة', { label: 'تراجع', run: () => store.restore(id) });
  }
});

// ✓ على رزمة التصحيح = صحّحت كل حصة اليوم منها (الباقي من حصة اليوم دفعة واحدة)
async function markGradingDone(id) {
  const t = await store.get(id); if (!t?.grade_total) return;
  const day = todayStr(), s = await getSettings();
  const { rem } = gradingToday(t, s.grade_by?.[day]?.[id] || 0, day);
  if (!rem) return;
  vibrate(30);
  const r = await store.gradeStep(id, rem);
  toast(r && r.grade_done >= r.grade_total ? '🎉 اكتملت الرزمة كلها!' : `✅ أنهيت تصحيح اليوم (${rem}+)`, { label: 'تراجع', run: () => store.gradeStep(id, -rem) });
}

/* ---------- 👆 السحب: لليمين ✓ إنهاء، لليسار 🗑️ حذف ---------- */
enableSwipe($('#p-list'), {
  right: async id => {
    if ((await store.get(id))?.grade_total) return markGradingDone(id);
    await store.complete(id); toast('أحسنت! ✓', { label: 'تراجع', run: () => store.reopen(id) });
  },
  left: async id => { await store.remove(id); toast('🗑️ حُذفت', { label: 'تراجع', run: () => store.restore(id) }); }
});

/* ---------- ➕ إضافة سريعة لليوم، 📷 من صورة، 🧹 مسح المنجزة ---------- */
$('#p-add').onclick = () => openAdd({ today: true });
$('#p-photo').onclick = () => $('#photo-input').click();
$('#p-clear-done').onclick = async () => {
  const { done } = await store.planTasks(todayStr());
  if (!done.length || !confirm(`مسح ${done.length} من المهام المنجزة اليوم من القائمة؟`)) return;
  for (const t of done) await store.update(t.id, { deleted: true }, { silent: true });
  window.dispatchEvent(new Event('sek:tasks'));
  toast('🧹 مُسحت المهام المنجزة');
};
$('#p-done').addEventListener('click', e => {
  const b = e.target.closest('[data-act="undo"]'); if (b) store.reopen(b.closest('li').dataset.id);
});

/* ---------- السحب لتغيير الترتيب (Pointer Events: يعمل باللمس) ---------- */
$('#p-list').addEventListener('pointerdown', e => {
  const handle = e.target.closest('.handle'); if (!handle) return;
  e.preventDefault();
  const li = handle.closest('li'), list = li.parentElement;
  li.classList.add('dragging');
  vibrate(10);
  // نستمع على document (وليس العنصر) لأن نقل العنصر داخل الصفحة يُفقده تتبّع اللمس

  const move = ev => {
    const y = ev.clientY;
    for (const it of list.children) {
      if (it === li) continue;
      const r = it.getBoundingClientRect();
      if (y > r.top && y < r.bottom) {
        list.insertBefore(li, y < r.top + r.height / 2 ? it : it.nextSibling);
        break;
      }
    }
    // تمرير تلقائي قرب أطراف الشاشة
    if (y < 80) window.scrollBy(0, -12); else if (y > innerHeight - 100) window.scrollBy(0, 12);
  };
  const up = async () => {
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', up);
    document.removeEventListener('pointercancel', up);
    li.classList.remove('dragging');
    await store.reorder([...list.children].map(x => x.dataset.id).filter(Boolean));   // يعيد رسم الخطة
  };
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', up);
  document.addEventListener('pointercancel', up);
});

/* ---------- 🔊 الملخص الصوتي ---------- */
// العدد بالعربية: 1 مهمة واحدة، 2 مهمتان، 3–10 مهام، 11+ مهمة
const count = (n, one, two, few, many) => n === 1 ? one : n === 2 ? two : n <= 10 ? `${n} ${few}` : `${n} ${many}`;
export async function speakSummary() {
  if (!('speechSynthesis' in window)) return toast('القراءة الصوتية غير مدعومة هنا');
  if (speechSynthesis.speaking) { speechSynthesis.cancel(); return; }
  const day = todayStr();
  const settings = await getSettings();
  const { open } = await store.planTasks(day);
  const events = [...timetableEvents(settings.timetable, day), ...await eventsFor(day, { refresh: false })];
  const plan = planDay({ tasks: open, events, settings, day });
  const timed = events.filter(e => !e.allDay);

  const parts = [`صباح الخير${settings.name ? ' يا ' + settings.name : ''}.`];
  const where = daySchools(settings.timetable, day);
  if (where.length) parts.push('اليوم في ' + where.map(x => x.name).join(' ثم ') + '.');
  const quota = open.filter(t => t.grade_total).reduce((n, t) => n + gradingQuota(t, day), 0);
  if (quota) parts.push(`وعليك تصحيح ${quota} ورقة في البيت.`);
  parts.push(open.length ? `لديك اليوم ${count(open.length, 'مهمة واحدة', 'مهمتان', 'مهام', 'مهمة')}` : 'لا مهام لليوم');
  if (timed.length) parts.push(`و ${count(timed.length, 'موعد واحد', 'موعدان', 'مواعيد', 'موعدًا')} في التقويم، أولها ${timed[0].title} الساعة ${new Date(timed[0].start).toTimeString().slice(0, 5)}`);
  parts[parts.length - 1] += '.';
  if (plan.top3.length) {
    parts.push('أهم المهام:');
    plan.top3.forEach((t, i) => {
      const s = plan.slots.get(t.id);
      parts.push(`${['أولًا', 'ثانيًا', 'ثالثًا'][i]}، ${t.title}${s ? '، الساعة ' + fromMin(s.start) : ''}.`);
    });
  }
  parts.push('يوم موفّق!');

  const u = new SpeechSynthesisUtterance(parts.join(' '));
  u.lang = 'ar-SA';
  const voices = speechSynthesis.getVoices();
  const ar = voices.find(v => v.lang?.toLowerCase().startsWith('ar'));
  if (ar) u.voice = ar;
  else if (voices.length) toast('لا يوجد صوت عربي في الهاتف. ثبّته من: الإعدادات ← الإدارة العامة ← تحويل النص إلى كلام');
  u.rate = 0.95;
  speechSynthesis.speak(u);
}
$('#p-speak').onclick = speakSummary;
$('#p-morning').onclick = () => show('morning');


/* ---------- 🏫 بطاقات حصص اليوم: المنتهية باهتة، والحالية مميّزة ---------- */
function drawClasses(events, settings, day) {
  const box = $('#p-classes');
  const classes = events.filter(e => e.icon === '🏫');
  const hasTimetable = Object.values(settings.timetable?.days || {}).some(d => d.length);
  if (!classes.length) {
    box.hidden = hasTimetable;              // يوم بلا حصص ⇒ لا شيء
    if (!hasTimetable) {
      box.innerHTML = `<button type="button" class="note" id="p-tt-note">🏫 أدخل جدول حصصك من ⚙️ الإعدادات ليعرف السكرتير أوقات فراغك ←</button>`;
      $('#p-tt-note').onclick = () => show('settings');
    }
    return;
  }
  box.hidden = false;
  // «أين أنا اليوم؟» مثل: 🔵 مدرسة أ (2) ← 🟣 مدرسة ب (3) — والحصص نفسها في القائمة بالأسفل مع ✓
  const where = daySchools(settings.timetable, day).map(x => `${SCHOOL_DOTS[x.id]} ${esc(x.name)} (${x.count})`).join(' ← ');
  const doneSet = new Set(settings.class_done?.[day] || []);
  const n = classes.filter(c => doneSet.has(c.code)).length;
  box.innerHTML = `<h3>🏫 حصص اليوم <span class="badge">${n} / ${classes.length}</span>${n === classes.length ? ' ✅' : ''}</h3>
    <p class="where">${where}</p>`;
}


/* ---------- 📝 بطاقة التصحيح: الهدف اليومي ---------- */
function drawGrading(open, settings, day) {
  const box = $('#p-grading');
  const goal = settings.grading_goal ?? 20;
  const doneN = settings.grade_log?.[day] || 0;
  const batches = open.filter(t => t.grade_total);
  const pct = goal ? Math.min(100, Math.round(doneN / goal * 100)) : 0;
  box.innerHTML = `<div class="g-head"><h3>📝 تصحيح اليوم</h3><b class="g-count">${doneN}${goal ? ' / ' + goal : ''}</b></div>
    ${goal ? `<div class="gbar big"><div style="width:${pct}%"></div></div>` : ''}
    <p class="muted small">${goal && doneN >= goal ? '🎉 وصلتَ لهدف اليوم!' : batches.length ? (goal ? `بقي ${goal - doneN} لهدف اليوم · اضغط +1 بعد كل ورقة` : 'اضغط +1 بعد كل ورقة') : 'لا رزم تصحيح حاليًا'}</p>
    <button id="p-new-batch" class="btn-ghost" type="button">📦 رزمة تصحيح جديدة</button>`;
  $('#p-new-batch').onclick = () => show('batch');
}
