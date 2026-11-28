/* =====================================================================
   db.js — التخزين المحلي في الهاتف (IndexedDB)
   IndexedDB = قاعدة بيانات صغيرة داخل المتصفح، تبقى حتى بدون إنترنت.
   فيها مخزنان (object stores):
     • tasks : المهام (المفتاح id)
     • kv    : قيم متفرقة (key-value) مثل مؤشر المزامنة
   ===================================================================== */

const DB_NAME = 'sekretiri';
const DB_VERSION = 1;
let dbPromise = null;

// فتح القاعدة مرة واحدة فقط وإعادة استخدامها
function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      // يعمل أول مرة فقط (أو عند رفع الإصدار): إنشاء المخازن
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('tasks')) db.createObjectStore('tasks', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

// دالة مساعدة: تنفّذ عملية داخل transaction وتعيد النتيجة
async function run(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/* ---------- المهام ---------- */
export const getAllTasks = () => run('tasks', 'readonly', s => s.getAll());
export const getTask = id => run('tasks', 'readonly', s => s.get(id));
export const putTask = task => run('tasks', 'readwrite', s => s.put(task));
export const clearTasks = () => run('tasks', 'readwrite', s => s.clear());

/* ---------- قيم متفرقة ---------- */
export const kvGet = key => run('kv', 'readonly', s => s.get(key));
export const kvSet = (key, value) => run('kv', 'readwrite', s => s.put(value, key));
export const kvDel = key => run('kv', 'readwrite', s => s.delete(key));
