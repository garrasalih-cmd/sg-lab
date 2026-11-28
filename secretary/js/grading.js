/* =====================================================================
   grading.js — 📦 رزمة تصحيح جديدة
   اسم الامتحان + المدرسة + عدد الأوراق + موعد الإعادة + دقائق الورقة
   ⇒ السكرتير يحسب كم ورقة يوميًا، ويضعها في وقتك بالبيت بعد المدرسة
   ===================================================================== */
import * as store from './store.js';
import { $, onShow, toast, chips, openPicker, back, vibrate } from './ui.js';
import { todayStr, addDays, fmtDue, fmtDuration, gradingQuota, normalizeTimetable, SCHOOL_DOTS, GRADE_MIN_DEFAULT, DAY_NAMES, weekdayOf } from './util.js';
import { getSettings } from './sync.js';

const QUICK = ['امتحان', 'اختبار قصير', 'بجروت تجريبي', 'وظيفة بيتية', 'مشروع'];
const f = { count: 20, min: GRADE_MIN_DEFAULT, due: null, school: null };

onShow('batch', async () => {
  const s = await getSettings();
  const tt = normalizeTimetable(s.timetable);
  const t0 = todayStr();
  Object.assign(f, { count: 20, min: GRADE_MIN_DEFAULT, due: addDays(t0, 3), school: null });
  $('#b-title').value = '';
  $('#b-quick').innerHTML = QUICK.map(q => `<button type="button" class="tpl">${q}</button>`).join('');
  $('#b-quick').onclick = e => { const b = e.target.closest('.tpl'); if (b) { $('#b-title').value = b.textContent + ' '; $('#b-title').focus(); } };
  chips($('#b-school'), [['', 'بدون'], ...tt.schools.map(x => [x.id, `${SCHOOL_DOTS[x.id]} ${x.name}`])], '', v => { f.school = v || null; });
  chips($('#b-count-chips'), [[10, '10'], [20, '20'], [30, '30'], [40, '40']], '', v => { f.count = +v; paint(); });
  // مواعيد سريعة: غدًا، بعد يومين، بعد 3 أيام، بعد أسبوع، أو تاريخ
  const opts = [[addDays(t0, 1), 'غدًا'], [addDays(t0, 2), 'بعد يومين'], [addDays(t0, 3), DAY_NAMES[weekdayOf(addDays(t0, 3))]], [addDays(t0, 7), 'بعد أسبوع'], ['pick', '📅 تاريخ']];
  chips($('#b-due'), opts, f.due, v => {
    if (v === 'pick') { $('#b-date').min = addDays(t0, 1); return openPicker($('#b-date')); }
    f.due = v; paint();
  });
  paint();
});

$('#b-date').addEventListener('change', e => { if (e.target.value) { f.due = e.target.value; paint(); } });
document.querySelector('[data-screen="batch"]').addEventListener('click', e => {
  const b = e.target.closest('[data-n],[data-m]'); if (!b) return;
  if (b.dataset.n) f.count = Math.min(999, Math.max(1, f.count + +b.dataset.n));
  if (b.dataset.m) f.min = Math.min(60, Math.max(1, f.min + +b.dataset.m));
  vibrate(8); paint();
});

function paint() {
  $('#b-count').textContent = f.count;
  $('#b-min').textContent = f.min + ' د';
  const q = gradingQuota({ grade_total: f.count, grade_done: 0, due_date: f.due });
  $('#b-summary').innerHTML = `📊 ≈ <b>${q}</b> ${q > 2 && q < 11 ? 'أوراق' : 'ورقة'} يوميًا (${fmtDuration(q * f.min)})، والإعادة ${fmtDue(f.due)}<br>⏱️ المجموع ≈ ${fmtDuration(f.count * f.min)}`;
}

$('#b-save').onclick = async () => {
  const title = $('#b-title').value.trim() || 'تصحيح امتحان';
  await store.add({
    title, category: 'school', school: f.school, due_date: f.due,
    grade_total: f.count, grade_min: f.min, duration_min: f.count * f.min, source: 'grading'
  });
  toast(`📦 أُضيفت: ${title} (${f.count} ورقة)`);
  back();
};
