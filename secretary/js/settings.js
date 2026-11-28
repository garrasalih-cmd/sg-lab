/* =====================================================================
   settings.js — شاشة الإعدادات
   الحساب · Google Calendar · الإشعارات · يومي · الصوت · التطبيق
   ===================================================================== */
import * as sync from './sync.js';
import * as cal from './calendar.js';
import * as store from './store.js';
import { $, onShow, toast, chips, pref } from './ui.js';
import { esc, todayStr, DAY_SHORT, DEFAULT_TIMETABLE } from './util.js';

onShow('settings', render);
window.addEventListener('sek:sync', () => { if (!$('[data-screen="settings"]').hidden) renderAccount(); });

async function render() {
  renderAccount();
  renderPush();
  renderDay();
  renderTimetable();
  renderVoice();
  renderApp();
}

/* ---------- ☁️ الحساب ---------- */
function renderAccount() {
  const box = $('#account');
  if (!sync.configured) {
    box.innerHTML = `<p class="muted">لم يُربط Supabase بعد. المهام تُحفظ على هذا الهاتف فقط.</p>`;
    return;
  }
  const s = sync.state;
  if (s.user) {
    const label = { ok: '✅ متزامن', syncing: '🔄 جارٍ المزامنة…', offline: '📴 بلا إنترنت، ستتم المزامنة لاحقًا', error: '⚠️ تعذّرت المزامنة', local: '' }[s.status];
    const when = s.lastSync ? ` · آخر مزامنة ${s.lastSync.toLocaleTimeString('ar-u-nu-latn', { hour: '2-digit', minute: '2-digit' })}` : '';
    box.innerHTML = `<p class="account-line">👤 ${esc(s.user.email || '')}</p>
      <p class="muted small">${label}${when}${s.error ? '<br>' + esc(s.error) : ''}</p>
      <div class="btn-row"><button id="sync-now" class="btn-ghost">🔄 مزامنة الآن</button>
      <button id="sign-out" class="btn-ghost">خروج</button></div>`;
    $('#sync-now').onclick = () => sync.syncNow();
    $('#sign-out').onclick = async () => {
      const warn = (await sync.hasUnsynced()) ? '\n⚠️ توجد مهام لم تُرفع بعد وستضيع!' : '';
      if (confirm('الخروج يمسح المهام من هذا الهاتف (تبقى محفوظة في السحابة).' + warn + '\nهل تريد الخروج؟')) sync.signOut();
    };
    return;
  }
  box.innerHTML = `<p class="muted small">سجّل الدخول لحفظ مهامك في السحابة، ولتفعيل التقويم والإشعارات.</p>
    <div class="form">
      <input id="email" type="email" placeholder="البريد الإلكتروني" autocomplete="email" dir="ltr">
      <input id="password" type="password" placeholder="كلمة المرور (6 أحرف على الأقل)" autocomplete="current-password" dir="ltr">
      <div class="btn-row"><button id="sign-in" class="btn-primary">دخول</button><button id="sign-up" class="btn-ghost">حساب جديد</button></div>
    </div><p id="auth-msg" class="msg"></p>`;
  const msg = (t, ok) => { const m = $('#auth-msg'); m.textContent = t; m.className = 'msg ' + (ok ? 'ok' : 'err'); };
  const creds = () => [$('#email').value.trim(), $('#password').value];
  $('#sign-in').onclick = async () => {
    const [e, p] = creds(); if (!e || !p) return msg('أدخل البريد وكلمة المرور');
    msg('…', true);
    const r = await sync.signIn(e, p);
    r.ok ? toast('أهلًا بك! ☁️ جارٍ المزامنة') : msg(r.msg);
  };
  $('#sign-up').onclick = async () => {
    const [e, p] = creds(); if (!e || !p) return msg('أدخل البريد وكلمة المرور');
    msg('…', true);
    const r = await sync.signUp(e, p);
    if (!r.ok) return msg(r.msg);
    msg(r.needsConfirm ? '📧 أرسلنا رسالة تأكيد إلى بريدك. افتحها واضغط الرابط، ثم عُد واضغط «دخول».' : '✓ تمّ إنشاء الحساب', true);
  };
}

/* ---------- 🔔 الإشعارات ---------- */
async function renderPush() {
  const s = await sync.getSettings();
  const st = await cal.pushState();
  const label = { unsupported: 'المتصفح لا يدعم الإشعارات', denied: '🚫 الإشعارات محظورة: فعّلها من إعدادات Chrome ← إعدادات المواقع ← الإشعارات', on: '✅ الإشعارات مفعّلة على هذا الهاتف', off: '' }[st];
  $('#push-state').textContent = label;
  $('#push-enable').hidden = st !== 'off';
  $('#push-test').hidden = st !== 'on';
  $('#push-opts').hidden = st !== 'on';
  $('#push-enable').onclick = async () => {
    const r = await cal.enablePush();
    toast(r.error ? '⚠️ ' + r.error : '🔔 تم تفعيل الإشعارات');
    renderPush();
  };
  $('#push-test').onclick = async () => {
    const r = await cal.testPush();
    toast(r.error ? '⚠️ ' + r.error : r.sent ? '📨 أُرسل إشعار تجريبي' : '⚠️ لم يصل، جرّب إعادة التفعيل');
  };
  const bind = (id, key) => { const el = $(id); el.checked = !!s[key]; el.onchange = () => sync.saveSettings({ [key]: el.checked }); };
  bind('#push-morning', 'push_morning');
  bind('#push-evening', 'push_evening');
  bind('#push-rem', 'push_reminders');
  const tbind = (id, key) => { const el = $(id); el.value = s[key]; el.onchange = () => el.value && sync.saveSettings({ [key]: el.value }); };
  tbind('#morning-time', 'morning_time');
  tbind('#evening-time', 'evening_time');
}

/* ---------- 🏫 جدول الحصص (كل أيام الأسبوع) ---------- */
async function renderTimetable() {
  const s = await sync.getSettings();
  // نسخة قابلة للتعديل (مع ضمان وجود الأيام السبعة)
  const tt = JSON.parse(JSON.stringify(s.timetable || DEFAULT_TIMETABLE));
  for (let d = 0; d < 7; d++) tt.days[d] = tt.days?.[d] || [];
  // نحفظ أولًا ثم نعيد الرسم (حتى لا تضيع ضغطة سريعة)
  const save = () => sync.saveSettings({ timetable: tt });

  // الشبكة: الأعمدة = الأيام، الصفوف = الحصص. اضغط مربعًا لتبديله، أو اسم اليوم لتحديد/مسح اليوم كله
  const grid = $('#tt-grid');
  const today = new Date().getDay();
  grid.innerHTML = `<thead><tr><th></th>${DAY_SHORT.map((d, i) => `<th><button type="button" class="tt-day ${i === today ? 'today' : ''}" data-day="${i}">${d}</button></th>`).join('')}</tr></thead>
    <tbody>${tt.periods.map((p, pi) => `<tr><th class="tt-pn">${pi + 1}<small>${p.start}</small></th>${DAY_SHORT.map((_, d) => {
      const on = tt.days[d].includes(pi + 1);
      return `<td><button type="button" class="tt-cell ${on ? 'on' : ''}" data-d="${d}" data-p="${pi + 1}" aria-pressed="${on}" aria-label="${DAY_SHORT[d]} حصة ${pi + 1}">${on ? '🏫' : ''}</button></td>`;
    }).join('')}</tr>`).join('')}</tbody>`;
  grid.onclick = async e => {
    const cell = e.target.closest('.tt-cell'), day = e.target.closest('.tt-day');
    if (cell) {
      const d = +cell.dataset.d, p = +cell.dataset.p, arr = tt.days[d];
      const i = arr.indexOf(p); i >= 0 ? arr.splice(i, 1) : arr.push(p);
      arr.sort((a, b) => a - b);
    } else if (day) {
      const d = +day.dataset.day;
      tt.days[d] = tt.days[d].length ? [] : tt.periods.map((_, i) => i + 1);
    } else return;
    await save(); renderTimetable();
  };

  // أوقات الجرس
  $('#tt-periods').innerHTML = tt.periods.map((p, i) => `<li class="tt-prow">
      <span>حصة ${i + 1}</span>
      <input type="time" data-i="${i}" data-k="start" value="${p.start}" aria-label="بداية حصة ${i + 1}">
      <span>–</span>
      <input type="time" data-i="${i}" data-k="end" value="${p.end}" aria-label="نهاية حصة ${i + 1}"></li>`).join('');
  $('#tt-periods').onchange = async e => {
    const inp = e.target.closest('input[type="time"]'); if (!inp || !inp.value) return;
    tt.periods[+inp.dataset.i][inp.dataset.k] = inp.value;
    await save(); renderTimetable();
  };
  $('#tt-add').onclick = async () => {
    const last = tt.periods.at(-1) || { end: '08:00' };
    const [h, m] = last.end.split(':').map(Number), t = h * 60 + m;
    const f = x => `${String(Math.floor(x / 60) % 24).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
    tt.periods.push({ start: f(t), end: f(t + 45) });
    await save(); renderTimetable();
  };
  $('#tt-remove').onclick = async () => {
    if (!tt.periods.length) return;
    const n = tt.periods.length;
    tt.periods.pop();
    for (let d = 0; d < 7; d++) tt.days[d] = tt.days[d].filter(p => p !== n);
    await save(); renderTimetable();
  };
}

/* ---------- 🕐 يومي ---------- */
async function renderDay() {
  const s = await sync.getSettings();
  const n = $('#my-name'); n.value = s.name || '';
  n.onchange = () => sync.saveSettings({ name: n.value.trim().slice(0, 40) });
  const ds = $('#day-start'), de = $('#day-end');
  ds.value = s.day_start; de.value = s.day_end;
  ds.onchange = () => ds.value && sync.saveSettings({ day_start: ds.value });
  de.onchange = () => de.value && sync.saveSettings({ day_end: de.value });
}

/* ---------- 🎤 الصوت ---------- */
const LANGS = [['ar-PS', 'فلسطيني'], ['ar-IL', 'عربي (إسرائيل)'], ['ar-JO', 'أردني'], ['ar-SA', 'فصحى/سعودي']];
function renderVoice() {
  chips($('#lang-chips'), LANGS, pref.get('lang', 'ar-PS'), v => pref.set('lang', v));
  const hasAr = () => speechSynthesis?.getVoices().some(v => v.lang?.toLowerCase().startsWith('ar'));
  $('#tts-note').textContent = !('speechSynthesis' in window) ? 'القراءة الصوتية غير مدعومة.'
    : hasAr() ? '✅ يوجد صوت عربي للقراءة' : 'إن لم تسمع العربية: الإعدادات ← الإدارة العامة ← تحويل النص إلى كلام ← محرك Google ← ثبّت العربية';
  $('#tts-test').onclick = () => {
    const u = new SpeechSynthesisUtterance('مرحبًا، أنا سكرتيرك. يوم موفّق!');
    u.lang = 'ar-SA';
    const ar = speechSynthesis.getVoices().find(v => v.lang?.toLowerCase().startsWith('ar'));
    if (ar) u.voice = ar;
    speechSynthesis.speak(u);
  };
}

/* ---------- 📲 التطبيق ---------- */
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; });
window.addEventListener('appinstalled', () => toast('🎉 تم التثبيت! ستجد سكرتير صالح على شاشتك'));

function renderApp() {
  const standalone = matchMedia('(display-mode: standalone)').matches;
  $('#install-btn').hidden = !deferredInstall;
  $('#install-note').textContent = standalone ? '✅ التطبيق مثبّت على هاتفك'
    : deferredInstall ? '' : 'للتثبيت: من قائمة Chrome ⋮ اختر «إضافة إلى الشاشة الرئيسية».';
}
$('#install-btn').onclick = async () => {
  if (!deferredInstall) return;
  deferredInstall.prompt();
  await deferredInstall.userChoice;
  deferredInstall = null; renderApp();
};
$('#export-btn').onclick = async () => {
  const data = JSON.stringify(await store.all(), null, 2);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
  a.download = `sekretiri-${todayStr()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
