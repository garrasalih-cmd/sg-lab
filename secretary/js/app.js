/* =====================================================================
   app.js — نقطة البداية: ربط الشاشات والأزرار
   الشاشات: home (الرئيسية) · share (مهمة من مشاركة) · settings (الإعدادات)
   ===================================================================== */
import * as store from './store.js';
import * as sync from './sync.js';
import * as voice from './voice.js';
import { CATS, todayStr, addDays, longToday, fmtDue, isOverdue, guessCategory, esc } from './util.js';

const $ = s => document.querySelector(s);

/* ---------- تفضيلات صغيرة محفوظة في الهاتف (localStorage) ---------- */
const pref = {
  get: (k, d) => { try { return localStorage.getItem('sek:' + k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem('sek:' + k, v); } catch {} }
};

/* ---------- حالة نموذج الإضافة ---------- */
const form = {
  cat: pref.get('cat', 'school'),  // آخر فئة اخترتها
  catTouched: false,               // هل اخترت الفئة بيدك لهذه المهمة؟
  due: 'none',                     // none | today | tomorrow | pick
  pickDate: null
};

/* =====================================================================
   التنقل بين الشاشات + زر الرجوع في Android
   ===================================================================== */
function show(name, push = true) {
  document.querySelectorAll('[data-screen]').forEach(s => { s.hidden = s.dataset.screen !== name; });
  if (push && name !== 'home') history.pushState({ screen: name }, '');
  if (name === 'settings') renderSettings();
  window.scrollTo(0, 0);
}
window.addEventListener('popstate', e => show(e.state?.screen || 'home', false));
document.querySelectorAll('[data-back]').forEach(b => b.addEventListener('click', () => history.back()));

/* =====================================================================
   Toast: رسالة قصيرة مع زر تراجع اختياري
   ===================================================================== */
let toastTimer;
function toast(msg, action) {
  const el = $('#toast'), btn = $('#toast-action');
  $('#toast-msg').textContent = msg;
  btn.hidden = !action;
  if (action) { btn.textContent = action.label; btn.onclick = () => { el.hidden = true; action.run(); }; }
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, action ? 5000 : 3000);
}

/* =====================================================================
   أزرار الفئات (تُبنى من CATS)
   ===================================================================== */
function catButtons(container, selected, onPick) {
  container.innerHTML = Object.entries(CATS).map(([key, c]) =>
    `<button type="button" class="cat" role="radio" data-cat="${key}" aria-checked="${key === selected}">
       <span>${c.icon}</span><span>${c.label}</span></button>`).join('');
  container.onclick = e => {
    const b = e.target.closest('.cat'); if (!b) return;
    container.querySelectorAll('.cat').forEach(x => x.setAttribute('aria-checked', x === b));
    onPick(b.dataset.cat);
  };
}
const selectCat = (container, key) =>
  container.querySelectorAll('.cat').forEach(x => x.setAttribute('aria-checked', x.dataset.cat === key));

/* =====================================================================
   الشاشة الرئيسية: إضافة مهمة
   ===================================================================== */
const input = $('#task-input');

function setupCapture() {
  catButtons($('#cats'), form.cat, key => { form.cat = key; form.catTouched = true; pref.set('cat', key); });

  // تخمين الفئة تلقائيًا من النص (ما لم تخترها بيدك)
  input.addEventListener('input', () => {
    if (form.catTouched) return;
    const g = guessCategory(input.value);
    if (g && g !== form.cat) { form.cat = g; selectCat($('#cats'), g); }
  });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addTask(true); } });

  // رقائق الموعد
  const chips = $('#due-chips'), dateInput = $('#date-input');
  const paintDue = () => {
    chips.querySelectorAll('button').forEach(b => b.setAttribute('aria-checked', b.dataset.due === form.due));
    $('#pick-label').textContent = form.due === 'pick' && form.pickDate ? fmtDue(form.pickDate) : 'تاريخ';
    $('#time-row').hidden = form.due === 'none';
  };
  chips.onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.due === 'pick') {
      // نفتح منتقي التاريخ الأصلي في Android
      dateInput.min = todayStr();
      try { dateInput.showPicker(); } catch { dateInput.click(); }
      return;
    }
    form.due = b.dataset.due; paintDue();
  };
  dateInput.addEventListener('change', () => {
    if (!dateInput.value) return;
    form.due = 'pick'; form.pickDate = dateInput.value; paintDue();
  });
  $('#time-clear').onclick = () => { $('#time-input').value = ''; };
  form.paintDue = paintDue;
  paintDue();

  $('#add-btn').onclick = () => addTask(false);
  setupMic();
}

async function addTask(keepFocus) {
  const title = input.value.trim();
  if (!title) {
    input.classList.remove('shake'); void input.offsetWidth; input.classList.add('shake');
    return toast('اكتب المهمة أو اضغط 🎤 وقلها');
  }
  const due_date = { none: null, today: todayStr(), tomorrow: addDays(todayStr(), 1), pick: form.pickDate }[form.due];
  const due_time = due_date ? ($('#time-input').value || null) : null;
  const cat = form.cat, source = form.source || 'manual';

  // تهيئة النموذج للمهمة التالية (قبل الحفظ، حتى لا نمسح ما تكتبه بعدها مباشرة)
  input.value = ''; form.source = null; form.catTouched = false;
  form.due = 'none'; form.pickDate = null; $('#time-input').value = ''; form.paintDue();
  form.cat = pref.get('cat', 'school'); selectCat($('#cats'), form.cat);
  if (keepFocus) input.focus(); else input.blur();
  await store.add({ title, category: cat, due_date, due_time, source });
  toast(`✓ أُضيفت إلى ${CATS[cat].icon} ${CATS[cat].label}`);
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
        input.dispatchEvent(new Event('input'));   // لتخمين الفئة
        form.source = 'voice';
      },
      onEnd: () => { btn.classList.remove('listening'); $('#toast').hidden = true; },
      onError: msg => toast(msg)
    });
  };
}

/* =====================================================================
   قائمة المهام المعلّقة
   ===================================================================== */
async function renderList() {
  const list = await store.pending();
  $('#count').textContent = list.length || '';
  $('#empty').hidden = list.length > 0;
  const done = await store.doneTodayCount();
  $('#done-today').textContent = done ? `أنجزتَ اليوم ${done} 💪` : '';

  $('#task-list').innerHTML = list.map(t => {
    const c = CATS[t.category] || CATS.personal;
    const due = fmtDue(t.due_date, t.due_time);
    const late = t.status !== 'done' && isOverdue(t.due_date);
    return `<li class="task" data-id="${t.id}" style="--cat:var(--c-${t.category})">
      <button class="act done" data-act="done" aria-label="تمّت">✓</button>
      <div class="body">
        <div class="title">${esc(t.title)}</div>
        <div class="meta">${c.icon} ${c.label}${due ? ' · ' + (late ? `<span class="late">متأخرة · ${due}</span>` : due) : ''}</div>
      </div>
      <button class="act" data-act="del" aria-label="حذف">🗑️</button>
    </li>`;
  }).join('');
}

$('#task-list').addEventListener('click', async e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const li = b.closest('.task'), id = li.dataset.id;
  li.classList.add('leaving');                 // حركة خروج لطيفة
  await new Promise(r => setTimeout(r, 220));
  if (b.dataset.act === 'done') {
    await store.complete(id);
    if (navigator.vibrate) navigator.vibrate(30);
    toast('أحسنت! ✓', { label: 'تراجع', run: () => store.reopen(id) });
  } else {
    await store.remove(id);
    toast('حُذفت المهمة', { label: 'تراجع', run: () => store.restore(id) });
  }
});

/* =====================================================================
   استقبال المشاركة (Web Share Target) من واتساب وغيره
   Android يفتح: /share-target?title=...&text=...&url=...
   ===================================================================== */
function handleIncomingShare() {
  const p = new URLSearchParams(location.search);
  const isShare = location.pathname.endsWith('/share-target');
  if (p.has('new')) { history.replaceState(null, '', './'); setTimeout(() => input.focus(), 300); }
  if (!isShare) return;

  // نجمع النص: واتساب يرسله في text، وبعض التطبيقات ترسل title أو url
  const parts = [p.get('title'), p.get('text'), p.get('url')].map(s => (s || '').trim()).filter(Boolean);
  const text = [...new Set(parts)].join(' — ').slice(0, 500);
  history.replaceState(null, '', './');        // تنظيف العنوان
  if (!text) return;

  $('#share-text').value = text;
  catButtons($('#share-cats'), guessCategory(text), async key => {
    const title = $('#share-text').value.trim();
    if (!title) return toast('النص فارغ');
    await store.add({ title, category: key, source: 'share' });
    pref.set('cat', key);
    history.back();                            // عودة للرئيسية
    toast(`✓ حُفظت في ${CATS[key].label}`);
  });
  $('#share-cancel').onclick = () => history.back();
  history.replaceState({ screen: 'home' }, '');
  show('share');
}

/* =====================================================================
   الإعدادات
   ===================================================================== */
function renderSyncDot() {
  $('#sync-dot').dataset.status = sync.state.status;
  if (!$('[data-screen="settings"]').hidden) renderAccount();
}

function renderAccount() {
  const box = $('#account');
  if (!sync.configured) {
    box.innerHTML = `<p class="muted">لم يُربط Supabase بعد، لذلك تُحفظ المهام على هذا الهاتف فقط.<br>
      ضع عنوان المشروع والمفتاح في الملف <b>config.js</b> (الشرح في README).</p>`;
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
  box.innerHTML = `<p class="muted small">سجّل الدخول لحفظ مهامك في السحابة ومزامنتها. المهام الموجودة على الهاتف تُرفع تلقائيًا.</p>
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

const LANGS = [['ar-PS', 'فلسطيني'], ['ar-IL', 'عربي (إسرائيل)'], ['ar-JO', 'أردني'], ['ar-SA', 'فصحى/سعودي']];
function renderSettings() {
  renderAccount();
  const cur = pref.get('lang', 'ar-PS');
  const chips = $('#lang-chips');
  chips.innerHTML = LANGS.map(([k, l]) => `<button type="button" data-lang="${k}" aria-checked="${k === cur}">${l}</button>`).join('');
  chips.onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    pref.set('lang', b.dataset.lang);
    chips.querySelectorAll('button').forEach(x => x.setAttribute('aria-checked', x === b));
  };
  $('#voice-note').textContent = voice.supported
    ? 'إذا لم يفهمك جيدًا، جرّب لهجة أخرى. الإملاء يحتاج إنترنت.'
    : 'متصفحك لا يدعم الإملاء. افتح التطبيق في Chrome.';

  const standalone = matchMedia('(display-mode: standalone)').matches;
  $('#install-btn').hidden = !deferredInstall;
  $('#install-note').textContent = standalone ? '✅ التطبيق مثبّت على هاتفك'
    : deferredInstall ? '' : 'للتثبيت: من قائمة Chrome ⋮ اختر «إضافة إلى الشاشة الرئيسية» أو «تثبيت التطبيق».';
}

// زر التثبيت (Chrome يطلق هذا الحدث عندما يصبح التطبيق قابلًا للتثبيت)
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; });
$('#install-btn').onclick = async () => {
  if (!deferredInstall) return;
  deferredInstall.prompt();
  await deferredInstall.userChoice;
  deferredInstall = null; renderSettings();
};
window.addEventListener('appinstalled', () => toast('🎉 تم التثبيت! ستجد سكرتيري على شاشتك'));

// نسخة احتياطية: ملف JSON بكل المهام
$('#export-btn').onclick = async () => {
  const data = JSON.stringify(await store.all(), null, 2);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
  a.download = `sekretiri-${todayStr()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

/* =====================================================================
   التشغيل
   ===================================================================== */
$('#today-label').textContent = longToday();
$('#settings-btn').onclick = () => show('settings');
$('#morning-btn').onclick = () => toast('☀️ وضع الصباح يصل في المرحلة 2');

window.addEventListener('sek:tasks', () => { renderList(); sync.schedule(); });
window.addEventListener('sek:sync', renderSyncDot);

setupCapture();
handleIncomingShare();
renderList();
sync.init();

// Service Worker: يجعل التطبيق يعمل بدون إنترنت
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(err => console.warn('SW', err));
}
// نطلب من المتصفح ألّا يمسح بياناتنا عند امتلاء الذاكرة
navigator.storage?.persist?.();
