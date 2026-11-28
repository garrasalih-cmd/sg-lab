/* =====================================================================
   app.js — نقطة البداية: يربط كل الوحدات ويفتح الشاشة المناسبة
   ===================================================================== */
import * as sync from './sync.js';
import * as cal from './calendar.js';
import { $, show, toast } from './ui.js';
import { longToday } from './util.js';
import { setupHome, renderList, handleIncomingShare, focusInput } from './home.js';
import './morning.js';
import './plan.js';
import './review.js';
import './settings.js';
import * as focus from './focus.js';

/* ---------- الشريط العلوي والتنقل ---------- */
$('#today-label').textContent = longToday();
$('#settings-btn').onclick = () => show('settings');
$('#morning-btn').onclick = () => show('morning');
$('#evening-btn').onclick = () => show('evening');
document.querySelectorAll('[data-back]').forEach(b => b.addEventListener('click', () => history.back()));
document.querySelectorAll('#tabbar [data-tab]').forEach(b => b.addEventListener('click', () => {
  const tab = b.dataset.tab;
  if (tab === 'home') { if (history.state?.screen && history.state.screen !== 'home') history.back(); return; }
  history.replaceState({ screen: 'home' }, '');   // التبويبات لا تتراكم في السجل
  show(tab);
}));

// بعد الساعة 4 عصرًا يظهر زر «مراجعة المساء» بجانب «صباح الخير»
function paintDayButtons() {
  const evening = new Date().getHours() >= 16;
  $('#evening-btn').hidden = !evening;
  $('#morning-btn').classList.toggle('compact', evening);
}

/* ---------- تحديث الشاشات عند تغيّر البيانات ---------- */
window.addEventListener('sek:tasks', () => { renderList(); sync.schedule(); });   // تعديل محلي ⇒ مزامنة
window.addEventListener('sek:tasks-remote', renderList);                         // وصل من السحابة
window.addEventListener('sek:sync', () => { $('#sync-dot').dataset.status = sync.state.status; });

/* ---------- التشغيل ---------- */
setupHome();
renderList();
paintDayButtons();
setInterval(paintDayButtons, 10 * 60 * 1000);
await cal.loadCachedStatus();
sync.init();

// فتح شاشة حسب الرابط: من الإشعارات، الاختصارات، المشاركة، أو العودة من Google
const p = new URLSearchParams(location.search);
const clean = () => history.replaceState({ screen: 'home' }, '', './');
if (!handleIncomingShare()) {
  if (p.has('morning')) { clean(); show('morning'); }
  else if (p.has('evening')) { clean(); show('evening'); }
  else if (p.has('plan')) { clean(); show('plan'); }
  else if (p.has('new')) { clean(); focusInput(); }
  else if (p.has('gcal')) {
    const r = p.get('gcal'); clean();
    toast(r === 'ok' ? '✅ تم ربط Google Calendar' : r === 'denied' ? 'لم تتم الموافقة على الربط' : '⚠️ تعذّر الربط، حاول مرة أخرى');
    show('settings');
    setTimeout(() => cal.refreshStatus(), 1500);
  } else if (focus.active()) {
    toast('🎯 لديك جلسة تركيز جارية', { label: 'افتحها', run: () => show('focus') });
  }
}

// Service Worker: العمل بلا إنترنت + استقبال الإشعارات
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(err => console.warn('SW', err));
  // نقرة على إشعار والتطبيق مفتوح ⇒ ينتقل للشاشة المطلوبة
  navigator.serviceWorker.addEventListener('message', e => {
    if (e.data?.type === 'open') {
      const u = new URL(e.data.url, location.href).searchParams;
      if (u.has('morning')) show('morning'); else if (u.has('evening')) show('evening'); else if (u.has('plan')) show('plan');
    }
  });
}
navigator.storage?.persist?.();
