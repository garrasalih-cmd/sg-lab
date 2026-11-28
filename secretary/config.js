/* =====================================================================
   سكرتيري — الإعدادات
   ضع هنا عنوان مشروع Supabase والمفتاح العام (Publishable / anon key).
   هذه القيم ليست سرية: المفتاح العام مصمَّم ليكون في المتصفح،
   والحماية الحقيقية هي سياسات RLS في ملف supabase/schema.sql.
   ⚠️ لا تضع هنا أبدًا مفتاح service_role أو secret.
   إذا تركتها فارغة: يعمل التطبيق على الهاتف فقط بدون مزامنة.
   ===================================================================== */
window.SEK_CONFIG = {
  SUPABASE_URL: 'https://duxhqrohiquqrvnfklez.supabase.co',   // مشروع sekretiri (فرانكفورت)
  SUPABASE_KEY: 'sb_publishable_nmMuTUyshVpBqYhpiVyxnw_q4zmBLQM', // المفتاح العام (Publishable)
  // المفتاح العام للإشعارات (VAPID public key). المفتاح الخاص محفوظ في الخادم فقط
  VAPID_PUBLIC: 'BGzeoTPv5l492ZTU7zaIBohVUvPmuDLwEESqHkjgLrA8fv98Jb_TmVMoln4xkfWebF6Q9YmPcYZoTVhA_n-xCZw'
};
