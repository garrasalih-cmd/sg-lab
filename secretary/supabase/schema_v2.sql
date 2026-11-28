-- =====================================================================
-- سكرتيري — الإضافات للمراحل 2 إلى 5 (تُشغَّل بعد schema.sql)
-- =====================================================================

-- ---------- حقول جديدة للمهام ----------
alter table public.tasks
  add column if not exists sched_start    timestamptz,   -- المرحلة 3: وقت البدء المجدول في خطة اليوم
  add column if not exists recur          text check (recur in ('daily','weekly','monthly')),  -- المرحلة 5: التكرار
  add column if not exists parent_id      uuid,          -- المرحلة 5: المهمة الأم (للمهام الفرعية)
  add column if not exists focus_min      int not null default 0,  -- المرحلة 5: دقائق التركيز الفعلية
  add column if not exists gcal_event_id  text,          -- المرحلة 4: رقم الحدث في Google Calendar
  add column if not exists gcal_etag      text,          -- نسخة الحدث (لمعرفة من عدّل)
  add column if not exists gcal_synced_at timestamptz;   -- نسخة المهمة التي أُرسلت للتقويم
create index if not exists tasks_parent_idx on public.tasks (parent_id);
create index if not exists tasks_sched_idx on public.tasks (user_id, sched_start);

-- ---------- الإعدادات (صف واحد لكل مستخدم) ----------
create table if not exists public.settings (
  user_id        uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  name           text,
  tz             text not null default 'Asia/Jerusalem',
  day_start      time not null default '07:30',   -- بداية يومك
  day_end        time not null default '22:00',   -- نهاية يومك
  morning_time   time not null default '06:30',   -- إشعار الصباح
  evening_time   time not null default '20:30',   -- إشعار المساء
  push_morning   boolean not null default true,
  push_evening   boolean not null default true,
  push_reminders boolean not null default true,   -- تذكير قبل المهمة (إن لم يكن التقويم مربوطًا)
  updated_at     timestamptz not null default now()
);
alter table public.settings enable row level security;
drop policy if exists "own settings" on public.settings;
create policy "own settings" on public.settings for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------- اشتراكات الإشعارات (Push) لكل جهاز ----------
create table if not exists public.push_subs (
  endpoint   text primary key,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);
create index if not exists push_subs_user_idx on public.push_subs (user_id);
alter table public.push_subs enable row level security;
drop policy if exists "own subs" on public.push_subs;
create policy "own subs" on public.push_subs for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------- جداول خاصة بالخادم فقط (RLS بدون سياسات = لا يقرؤها التطبيق) ----------
-- مفاتيح Google لكل مستخدم
create table if not exists public.google_tokens (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  email         text,
  refresh_token text not null,
  access_token  text,
  expires_at    timestamptz,
  calendar_id   text,          -- رقم تقويم «سكرتيري»
  sync_token    text,          -- لمعرفة ما تغيّر في التقويم منذ آخر مرة
  last_sync_at  timestamptz,
  created_at    timestamptz not null default now()
);
alter table public.google_tokens enable row level security;

-- رموز مؤقتة أثناء تسجيل الدخول بـ Google (OAuth state)
create table if not exists public.oauth_states (
  state      text primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  return_url text not null,
  created_at timestamptz not null default now()
);
alter table public.oauth_states enable row level security;

-- سجل الإشعارات المُرسلة (حتى لا يتكرر الإشعار)
create table if not exists public.notif_log (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind    text not null,        -- morning / evening / reminder
  ref     text not null,        -- التاريخ أو رقم المهمة
  sent_at timestamptz not null default now(),
  primary key (user_id, kind, ref)
);
alter table public.notif_log enable row level security;

-- إعدادات سرية للخادم (مفتاح VAPID الخاص، كلمة سر المؤقّت)
create table if not exists public.app_config (
  key   text primary key,
  value text not null
);
alter table public.app_config enable row level security;

-- ---------- المؤقّت (pg_cron): كل 5 دقائق يستدعي الدالة cron ----------
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---------- بعد نشر دالة sek: المؤقّت كل 5 دقائق ----------
-- (كلمة سر المؤقّت محفوظة في Vault باسم sek_cron_secret وفي app_config)
-- select cron.schedule('sek-cron', '*/5 * * * *', $$
--   select net.http_post(
--     url := 'https://<project-ref>.supabase.co/functions/v1/sek',
--     headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',
--                (select decrypted_secret from vault.decrypted_secrets where name='sek_cron_secret')),
--     body := '{}'::jsonb, timeout_milliseconds := 60000);
-- $$);
