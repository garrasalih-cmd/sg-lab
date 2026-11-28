/* =====================================================================
   settings.js — شاشة الإعدادات
   الحساب · Google Calendar · الإشعارات · يومي · الصوت · التطبيق
   ===================================================================== */
import * as sync from './sync.js';
import * as cal from './calendar.js';
import * as store from './store.js';
import { $, onShow, toast, chips, pref } from './ui.js';
import { esc, todayStr } from './util.js';

onShow('settings', render);
window.addEventListener('sek:sync', () => { if (!$('[data-screen="settings"]').hidden) renderAccount(); });
window.addEventListener('sek:gcal', () => { if (!$('[data-screen="settings"]').hidden) renderGoogle(); });

async function render() {
  renderAccount();
  renderGoogle();
  renderPush();
  renderDay();
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
    <button id="g-signin" class="btn-google" type="button"><span class="g-logo">G</span> الدخول بحساب Google</button>
    <p class="muted small center">دخول واحد: يحفظ مهامك، ويربط Google Calendar و Google Tasks معًا</p>
    <details class="more"><summary>أو الدخول بالبريد الإلكتروني</summary>
    <div class="form">
      <input id="email" type="email" placeholder="البريد الإلكتروني" autocomplete="email" dir="ltr">
      <input id="password" type="password" placeholder="كلمة المرور (6 أحرف على الأقل)" autocomplete="current-password" dir="ltr">
      <div class="btn-row"><button id="sign-in" class="btn-primary">دخول</button><button id="sign-up" class="btn-ghost">حساب جديد</button></div>
    </div></details><p id="auth-msg" class="msg"></p>`;
  const msg = (t, ok) => { const m = $('#auth-msg'); m.textContent = t; m.className = 'msg ' + (ok ? 'ok' : 'err'); };
  // الدخول بحساب Google: ينقلك إلى صفحة Google ثم يعيدك للتطبيق
  $('#g-signin').onclick = async () => {
    msg('⏳ جارٍ فتح صفحة Google…', true);
    const r = await sync.signInWithGoogle();
    if (!r.ok) msg(r.msg);
  };
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

/* ---------- 📅 Google Calendar ---------- */
async function renderGoogle() {
  const box = $('#google');
  if (!sync.state.user) { box.innerHTML = '<p class="muted small">سجّل الدخول أولًا (☁️ الحساب).</p>'; return; }
  const g = cal.gcal;
  if (g.known && !g.configured) {
    box.innerHTML = `<p class="muted small">الخادم ينتظر مفاتيح Google Cloud. اتبع الدليل <b>GOOGLE_SETUP.md</b> (مرة واحدة، 15 دقيقة).</p>
      <button class="btn-ghost" id="g-recheck">🔄 تحقّق مرة أخرى</button>`;
    $('#g-recheck').onclick = async () => { await cal.refreshStatus(); };
    return;
  }
  if (g.connected) {
    box.innerHTML = `<p class="account-line">✅ مربوط: ${esc(g.email || '')}</p>
      <p class="muted small">المهام المجدولة تظهر في تقويم «سكرتيري» مع تنبيه قبل 10 دقائق. أي تعديل هناك يعود للتطبيق.</p>
      <p class="small">${g.tasks_ok === false ? '⚠️ Google Tasks: لم تُمنح الصلاحية. اضغط «فصل» ثم اربط من جديد' : g.tasks_ok ? '✅ Google Tasks: متزامن (كل مهمة تضيفها هناك تصل هنا)' : '📝 Google Tasks: ستبدأ المزامنة خلال دقائق'}</p>
      <div class="btn-row"><button class="btn-ghost" id="g-sync">🔄 مزامنة الآن</button><button class="btn-ghost" id="g-off">فصل</button></div>`;
    $('#g-sync').onclick = async () => { toast('🔄 جارٍ مزامنة التقويم…'); const r = await cal.syncCalendarNow(); toast(r.error ? '⚠️ ' + r.error : '✅ تمت المزامنة'); };
    $('#g-off').onclick = async () => { if (confirm('فصل Google Calendar؟ الأحداث الموجودة تبقى في التقويم.')) { await cal.disconnect(); renderGoogle(); } };
    return;
  }
  box.innerHTML = `<p class="muted small">اربط حسابك مرة واحدة: يقرأ التطبيق حصصك ومواعيدك ليعرف أوقات فراغك، ويكتب مهامك في تقويم خاص اسمه «سكرتيري»، ويسحب مهامك من Google Tasks.</p>
    <button class="btn-primary" id="g-connect">🔗 ربط Google Calendar</button>`;
  $('#g-connect').onclick = async () => {
    const r = await cal.connect();
    if (r.error) toast(r.error === 'google_not_configured' ? 'الخادم ينتظر مفاتيح Google Cloud (راجع GOOGLE_SETUP.md)' : '⚠️ ' + r.error);
  };
  if (!g.known) cal.refreshStatus();
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
window.addEventListener('appinstalled', () => toast('🎉 تم التثبيت! ستجد سكرتيري على شاشتك'));

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
