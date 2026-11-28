/* =====================================================================
   plan.js — شاشة خطة اليوم 📋 (المرحلة 3)
   • أهم 3 مهام في الأعلى ⭐
   • الباقي موزّع على فترات الفراغ بين حصصك ومواعيدك
   • ✓ للإنهاء، ⋮⋮ اسحب لتغيير الترتيب، ▶️ وضع التركيز
   • 🔊 ملخص صوتي بالعربية (Text-to-Speech)
   ===================================================================== */
import * as store from './store.js';
import { planDay } from './planner.js';
import { eventsFor, gcal } from './calendar.js';
import { getSettings } from './sync.js';
import { $, show, onShow, toast, vibrate } from './ui.js';
import { CATS, IMPORTANCE, todayStr, fromMin, localISO, fmtDuration, esc, longToday } from './util.js';
import * as focus from './focus.js';

let last = null;   // آخر خطة محسوبة

onShow('plan', () => render(true));
window.addEventListener('sek:tasks', () => { if (!$('[data-screen="plan"]').hidden) render(false); });
window.addEventListener('sek:tasks-remote', () => { if (!$('[data-screen="plan"]').hidden) render(false); });

async function render(fetchEvents) {
  const day = todayStr();
  $('#p-date').textContent = longToday();
  const settings = await getSettings();
  const { open, done } = await store.planTasks(day);
  // نعرض الأحداث المحفوظة فورًا، ثم نحدّثها من الإنترنت
  let events = await eventsFor(day, { refresh: false });
  draw({ open, done, events, settings, day });
  if (fetchEvents && gcal.connected) {
    events = await eventsFor(day, { refresh: true });
    draw({ open, done, events, settings, day });
  }
}

function draw({ open, done, events, settings, day }) {
  const plan = planDay({ tasks: open, events, settings, day });
  last = { plan, day };
  const list = $('#p-list');
  $('#p-empty').hidden = open.length > 0;
  $('#p-cal-note').hidden = gcal.connected;
  $('#p-done-count').textContent = done.length ? `✅ أنجزتَ ${done.length} من ${done.length + open.length}` : '';

  // ---- القائمة المرتّبة (قابلة للسحب) ----
  list.innerHTML = plan.ordered.map((t, i) => {
    const slot = plan.slots.get(t.id);
    const c = CATS[t.category] || CATS.personal;
    const time = slot ? `${fromMin(slot.start)}–${fromMin(slot.end)}${slot.fixed ? ' 📌' : ''}` : '⚠️ لا وقت اليوم';
    const imp = t.importance ? IMPORTANCE[t.importance].icon : '';
    return `<li class="plan-item ${i < 3 ? 'top' : ''} ${i === 3 ? 'first-rest' : ''}" data-id="${t.id}" style="--cat:var(--c-${t.category})">
      <span class="handle" aria-label="اسحب لتغيير الترتيب">⋮⋮</span>
      <button class="act done" data-act="done" aria-label="تمّت">✓</button>
      <div class="body">
        <div class="title">${i < 3 ? `<span class="star">⭐${i + 1}</span> ` : ''}${esc(t.title)}</div>
        <div class="meta">${imp} ${c.icon} · <span class="${slot ? '' : 'late'}">${time}</span>${t.duration_min ? ' · ' + fmtDuration(t.duration_min) : ''}</div>
      </div>
      <button class="act" data-act="focus" aria-label="وضع التركيز">▶️</button>
    </li>`;
  }).join('');

  // ---- الجدول الزمني (الأحداث + المهام) ----
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  let markerDone = false;
  $('#p-timeline').innerHTML = plan.timeline.map(it => {
    let marker = '';
    if (!markerDone && !it.allDay && it.start >= nowMin) { marker = `<li class="now-line">الآن ${fromMin(nowMin)}</li>`; markerDone = true; }
    if (it.kind === 'event') {
      return marker + `<li class="tl event">${it.allDay ? '<span class="tl-time">طوال اليوم</span>' : `<span class="tl-time">${fromMin(it.start)}</span>`}
        <span>📅 ${esc(it.title)}</span></li>`;
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
  toast(gcal.connected ? '📅 أُرسلت الخطة إلى تقويم «سكرتيري»' : '📌 ثُبّتت الأوقات');
};

/* ---------- النقر: ✓ / ▶️ / تراجع ---------- */
$('#p-list').addEventListener('click', async e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const id = b.closest('li').dataset.id;
  if (b.dataset.act === 'done') {
    b.closest('li').classList.add('leaving');
    vibrate(30);
    await new Promise(r => setTimeout(r, 200));
    await store.complete(id);
    toast('أحسنت! ✓', { label: 'تراجع', run: () => store.reopen(id) });
  } else if (b.dataset.act === 'focus') {
    focus.start(id);
  }
});
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
    await store.reorder([...list.children].map(x => x.dataset.id));   // يعيد رسم الخطة
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
  const events = await eventsFor(day, { refresh: false });
  const plan = planDay({ tasks: open, events, settings, day });
  const timed = events.filter(e => !e.allDay);

  const parts = [`صباح الخير${settings.name ? ' يا ' + settings.name : ''}.`];
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
$('#p-cal-note').onclick = () => show('settings');
