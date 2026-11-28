/* =====================================================================
   settings.js — شاشة الإعدادات
   الحساب · Google Calendar · الإشعارات · يومي · الصوت · التطبيق
   ===================================================================== */
import * as sync from './sync.js';
import * as cal from './calendar.js';
import * as store from './store.js';
import { $, onShow, toast, chips, pref } from './ui.js';
import { esc, todayStr, DAY_SHORT, normalizeTimetable, SCHOOL_DOTS, SCHOOL_COLORS } from './util.js';

onShow('settings', render);
window.addEventListener('sek:sync', () => { if (!$('[data-screen="settings"]').hidden) renderAccount(); });

async function render() {
  renderAccount();
  renderPush();
  renderDay();
  renderTimetable();
  renderGradingGoal();
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

/* ---------- 🏫 جدول الحصص لمدرستين (كل أيام الأسبوع) ---------- */
let ttSchool = 'a';                       // المدرسة المعروضة في المحرّر
async function renderTimetable() {
  const st = await sync.getSettings();
  const tt = normalizeTimetable(st.timetable);
  const save = () => sync.saveSettings({ timetable: tt });     // نحفظ أولًا ثم نعيد الرسم
  const sch = tt.schools.find(x => x.id === ttSchool);

  // تبويبا المدرستين
  chips($('#tt-schools'), tt.schools.map(x => [x.id, `${SCHOOL_DOTS[x.id]} ${esc(x.name)}`]), ttSchool, v => { ttSchool = v; renderTimetable(); });
  const nm = $('#tt-name'); nm.value = sch.name;
  nm.onchange = async () => { sch.name = nm.value.trim().slice(0, 30) || (ttSchool === 'a' ? 'مدرسة أ' : 'مدرسة ب'); await save(); renderTimetable(); };
  $('#tt-bell-name').textContent = sch.name;

  // الشبكة: الأعمدة = الأيام، الصفوف = حصص المدرسة المختارة.
  // مربع حصة المدرسة الأخرى في نفس الوقت يظهر باهتًا (لتعرف أنك هناك)
  const grid = $('#tt-grid'), today = new Date().getDay();
  const other = tt.schools.find(x => x.id !== ttSchool);
  const toM = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const busyOther = (d, p) => (tt.days[d] || []).some(code => {
    if (code[0] === ttSchool) return false;
    const op = other.periods[+code.slice(1) - 1]; if (!op) return false;
    return toM(p.start) < toM(op.end) && toM(op.start) < toM(p.end);
  });
  grid.innerHTML = `<thead><tr><th></th>${DAY_SHORT.map((d, i) => `<th><button type="button" class="tt-day ${i === today ? 'today' : ''}" data-day="${i}">${d}</button></th>`).join('')}</tr></thead>
    <tbody>${sch.periods.map((p, pi) => `<tr><th class="tt-pn">${pi + 1}<small>${p.start}</small></th>${DAY_SHORT.map((_, d) => {
      const code = ttSchool + (pi + 1), on = tt.days[d].includes(code), clash = !on && busyOther(d, p);
      return `<td><button type="button" class="tt-cell ${on ? 'on' : ''} ${clash ? 'other' : ''}" style="--sc:${SCHOOL_COLORS[ttSchool]}" data-d="${d}" data-code="${code}" aria-pressed="${on}" aria-label="${DAY_SHORT[d]} حصة ${pi + 1}">${on ? SCHOOL_DOTS[ttSchool] : clash ? SCHOOL_DOTS[other.id] : ''}</button></td>`;
    }).join('')}</tr>`).join('')}</tbody>`;
  grid.onclick = async e => {
    const cell = e.target.closest('.tt-cell'), day = e.target.closest('.tt-day');
    if (cell) {
      const d = +cell.dataset.d, arr = tt.days[d], i = arr.indexOf(cell.dataset.code);
      i >= 0 ? arr.splice(i, 1) : arr.push(cell.dataset.code);
    } else if (day) {
      const d = +day.dataset.day, mine = tt.days[d].filter(c => c[0] === ttSchool);
      tt.days[d] = tt.days[d].filter(c => c[0] !== ttSchool);
      if (!mine.length) tt.days[d].push(...sch.periods.map((_, i) => ttSchool + (i + 1)));
    } else return;
    await save(); renderTimetable();
  };

  // 🚗 الطريق
  $('#tt-travel').textContent = tt.travel_min + ' د';
  $('#tt-tr-minus').onclick = async () => { tt.travel_min = Math.max(0, tt.travel_min - 5); await save(); renderTimetable(); };
  $('#tt-tr-plus').onclick = async () => { tt.travel_min = Math.min(120, tt.travel_min + 5); await save(); renderTimetable(); };

  // ⏰ أوقات جرس المدرسة المختارة
  $('#tt-periods').innerHTML = sch.periods.map((p, i) => `<li class="tt-prow">
      <span>حصة ${i + 1}</span>
      <input type="time" data-i="${i}" data-k="start" value="${p.start}" aria-label="بداية حصة ${i + 1}">
      <span>–</span>
      <input type="time" data-i="${i}" data-k="end" value="${p.end}" aria-label="نهاية حصة ${i + 1}"></li>`).join('');
  $('#tt-periods').onchange = async e => {
    const inp = e.target.closest('input[type="time"]'); if (!inp || !inp.value) return;
    sch.periods[+inp.dataset.i][inp.dataset.k] = inp.value;
    await save(); renderTimetable();
  };
  $('#tt-add').onclick = async () => {
    const last = sch.periods.at(-1) || { end: '08:00' };
    const t = toM(last.end), f = x => `${String(Math.floor(x / 60) % 24).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
    sch.periods.push({ start: f(t), end: f(t + 45) });
    await save(); renderTimetable();
  };
  $('#tt-remove').onclick = async () => {
    if (!sch.periods.length) return;
    const code = ttSchool + sch.periods.length;
    sch.periods.pop();
    for (let d = 0; d < 7; d++) tt.days[d] = tt.days[d].filter(c => c !== code);
    await save(); renderTimetable();
  };
}

/* ---------- 📝 هدف التصحيح اليومي ---------- */
async function renderGradingGoal() {
  const s = await sync.getSettings();
  let goal = s.grading_goal ?? 20;
  const paint = () => { $('#g-goal').textContent = goal || 'بلا هدف'; };
  const set = async v => { goal = Math.max(0, Math.min(200, v)); paint(); await sync.saveSettings({ grading_goal: goal }); };
  $('#g-goal-minus').onclick = () => set(goal - 5);
  $('#g-goal-plus').onclick = () => set(goal + 5);
  paint();
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
