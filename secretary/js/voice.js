/* =====================================================================
   voice.js — الإملاء الصوتي (Web Speech API → SpeechRecognition)
   ملاحظات صريحة:
   • يعمل في Chrome على Android (هاتفك Galaxy A56 ✔). لا يعمل في Samsung Internet.
   • يحتاج إنترنت: Google تحوّل الصوت إلى نص على خوادمها.
   • يحتاج HTTPS (Netlify يوفره تلقائيًا) وإذن الميكروفون أول مرة.
   ===================================================================== */

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const supported = !!SR;

let rec = null;
export const isListening = () => !!rec;

/**
 * يبدأ الاستماع.
 * lang     : لهجة التعرّف، مثل 'ar-PS' (فلسطين) أو 'ar-SA'
 * onText   : تُستدعى مع النص كلما تحسّن التعرّف (interim) ثم النص النهائي
 * onEnd    : عند انتهاء الاستماع
 * onError  : رسالة خطأ بالعربية
 */
export function start({ lang = 'ar-PS', onText, onEnd, onError }) {
  if (!SR || rec) return;
  rec = new SR();
  rec.lang = lang;
  rec.interimResults = true;   // نعرض الكلمات أثناء الكلام
  rec.continuous = false;      // يتوقف تلقائيًا عند السكوت
  rec.maxAlternatives = 1;

  rec.onresult = e => {
    let text = '';
    for (const r of e.results) text += r[0].transcript;
    const isFinal = e.results[e.results.length - 1].isFinal;
    onText?.(text.trim(), isFinal);
  };
  rec.onerror = e => {
    const msg = {
      'not-allowed': 'اسمح للتطبيق باستخدام الميكروفون من إعدادات المتصفح 🎤',
      'service-not-allowed': 'اسمح للتطبيق باستخدام الميكروفون من إعدادات المتصفح 🎤',
      'network': 'الإملاء الصوتي يحتاج إنترنت 📶',
      'no-speech': 'لم أسمع شيئًا… جرّب مرة أخرى',
      'audio-capture': 'لم أجد ميكروفونًا يعمل',
      'language-not-supported': 'هذه اللهجة غير مدعومة، غيّرها من الإعدادات'
    }[e.error];
    if (e.error !== 'aborted') onError?.(msg || 'تعذّر الإملاء الصوتي');
  };
  rec.onend = () => { rec = null; onEnd?.(); };
  try { rec.start(); } catch { rec = null; onError?.('تعذّر تشغيل الميكروفون'); }
}

export function stop() { rec?.stop(); }
