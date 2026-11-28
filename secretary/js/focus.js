/* =====================================================================
   focus.js — وضع التركيز 🎯 (المرحلة 5) — طريقة بومودورو Pomodoro
   25 دقيقة تركيز على مهمة واحدة ⇒ 5 دقائق استراحة ⇒ وهكذا
   • المؤقّت يعتمد على "وقت الانتهاء" فيبقى دقيقًا حتى لو أغلقت الشاشة
   • Wake Lock يُبقي الشاشة مضاءة أثناء التركيز (إن دعمه الهاتف)
   ⚠️ صراحة: إذا أغلقت التطبيق تمامًا قد يتأخر تنبيه النهاية حتى تفتحه
   ===================================================================== */
import * as store from './store.js';
import { $, show, onShow, toast, vibrate, back, pref } from './ui.js';
import { esc } from './util.js';

const FOCUS = 25 * 60, BREAK = 5 * 60;
let S = load();
let tick = null, wakeLock = null;

function load() { try { return JSON.parse(pref.get('focus', 'null')); } catch { return null; } }
function save() { pref.set('focus', JSON.stringify(S)); }

export function start(taskId) {
  if (!S || S.taskId !== taskId) S = { taskId, mode: 'focus', endAt: Date.now() + FOCUS * 1000, paused: null, sessions: 0, startedAt: Date.now() };
  save();
  show('focus');
}
export const active = () => !!S;

onShow('focus', async () => {
  if (!S) return back();
  const t = await store.get(S.taskId);
  $('#f-task').textContent = t ? t.title : '';
  // نطلب إذن الإشعارات لتنبيه نهاية الجلسة (مرة واحدة)
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
  requestWake();
  clearInterval(tick);
  tick = setInterval(update, 500);
  update();
});

function remaining() { return S.paused != null ? S.paused : Math.max(0, Math.round((S.endAt - Date.now()) / 1000)); }

function update() {
  if (!S || $('[data-screen="focus"]').hidden) { clearInterval(tick); releaseWake(); return; }
  const r = remaining(), total = S.mode === 'focus' ? FOCUS : BREAK;
  $('#f-time').textContent = `${String(Math.floor(r / 60)).padStart(2, '0')}:${String(r % 60).padStart(2, '0')}`;
  $('#f-mode').textContent = S.mode === 'focus' ? '🎯 تركيز' : '☕ استراحة';
  $('#f-sessions').textContent = S.sessions ? `🍅 ${S.sessions} ${S.sessions === 1 ? 'جلسة' : 'جلسات'}` : '';
  $('#f-pause').textContent = S.paused != null ? '▶️ متابعة' : '⏸️ إيقاف مؤقت';
  // حلقة التقدم: محيط الدائرة 2πr (r=90)
  const C = 2 * Math.PI * 90;
  const ring = $('#f-ring');
  ring.style.strokeDasharray = C;
  ring.style.strokeDashoffset = C * (r / total);
  ring.classList.toggle('break', S.mode === 'break');
  document.title = `${$('#f-time').textContent} · سكرتيري`;
  if (r === 0 && S.paused == null) phaseEnd();
}

async function phaseEnd() {
  vibrate([200, 100, 200]);
  beep();
  if (S.mode === 'focus') {
    S.sessions++;
    const t = await store.get(S.taskId);
    if (t) await store.update(S.taskId, { focus_min: (t.focus_min || 0) + 25 }, { silent: true });
    notifyUser('☕ وقت الاستراحة', '25 دقيقة تركيز رائعة! خذ 5 دقائق راحة');
    S.mode = 'break'; S.endAt = Date.now() + BREAK * 1000;
  } else {
    notifyUser('🎯 نعود للتركيز', 'انتهت الاستراحة');
    S.mode = 'focus'; S.endAt = Date.now() + FOCUS * 1000;
  }
  save();
}

// حفظ الدقائق التي ركّزتها قبل الإنهاء المبكر
async function saveElapsed() {
  if (S?.mode !== 'focus') return;
  const used = Math.round((FOCUS - remaining()) / 60);
  if (used >= 1) {
    const t = await store.get(S.taskId);
    if (t) await store.update(S.taskId, { focus_min: (t.focus_min || 0) + used }, { silent: true });
  }
}

$('#f-pause').onclick = () => {
  if (S.paused != null) { S.endAt = Date.now() + S.paused * 1000; S.paused = null; }
  else S.paused = remaining();
  save(); update();
};
$('#f-done').onclick = async () => {
  await saveElapsed();
  await store.complete(S.taskId);
  S = null; save();
  toast('🎉 أحسنت! أنهيت المهمة');
  back();
};
$('#f-stop').onclick = async () => {
  await saveElapsed();
  S = null; save();
  back();
};

/* ---------- أدوات ---------- */
async function requestWake() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* غير مدعوم */ }
}
function releaseWake() { try { wakeLock?.release(); } catch { /* */ } wakeLock = null; document.title = 'سكرتيري'; }
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !$('[data-screen="focus"]').hidden) requestWake();
});

// صوت تنبيه قصير بدون ملفات (Web Audio API)
function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.35].forEach(t => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.3, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.3);
      o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.3);
    });
  } catch { /* */ }
}
async function notifyUser(title, body) {
  if (document.visibilityState === 'visible' || Notification?.permission !== 'granted') return toast(title);
  const reg = await navigator.serviceWorker?.ready;
  reg?.showNotification(title, { body, icon: 'icons/icon-192.png', tag: 'focus', dir: 'rtl', lang: 'ar', vibrate: [200, 100, 200] });
}

