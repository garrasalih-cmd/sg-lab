// =====================================================================
// shared.ts — أدوات مشتركة لدالة الخادم sek
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2.49.4';

export const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// عميل بصلاحية الخادم (service role): يتجاوز RLS، لذلك يُستخدم هنا فقط وليس في التطبيق أبدًا
export const admin = createClient(SB_URL, SERVICE_KEY, { auth: { persistSession: false } });

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS'
};
export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// قراءة قيمة من جدول app_config (مفاتيح VAPID وكلمة سر المؤقّت)
const cfgCache: Record<string, string> = {};
export async function cfg(key: string): Promise<string> {
  if (cfgCache[key]) return cfgCache[key];
  const { data } = await admin.from('app_config').select('value').eq('key', key).maybeSingle();
  return (cfgCache[key] = data?.value ?? '');
}

// تاريخ ووقت محليان حسب منطقة المستخدم الزمنية (مثل Asia/Jerusalem)
export function localParts(iso: string | Date, tz: string) {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(d).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, minutes: +p.hour * 60 + +p.minute };
}
export const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

export type Settings = {
  name: string | null; tz: string; day_start: string; day_end: string; morning_time: string; evening_time: string;
  push_morning: boolean; push_evening: boolean; push_reminders: boolean;
};
export const DEFAULT_SETTINGS: Settings = {
  name: null, tz: 'Asia/Jerusalem', day_start: '07:30', day_end: '22:00', morning_time: '06:30', evening_time: '20:30',
  push_morning: true, push_evening: true, push_reminders: true
};
export async function getSettings(userId: string): Promise<Settings> {
  const { data } = await admin.from('settings').select('*').eq('user_id', userId).maybeSingle();
  return { ...DEFAULT_SETTINGS, ...(data || {}) };
}
