-- =====================================================================
-- سكرتيري — قاعدة البيانات (Supabase / PostgreSQL)
-- كيف تستخدمه: افتح مشروعك في Supabase ← SQL Editor ← New query
-- الصق هذا الملف كاملًا ← اضغط Run. (يكفي مرة واحدة فقط)
-- =====================================================================

-- جدول المهام (tasks)
create table if not exists public.tasks (
  id             uuid primary key,                         -- المعرّف يُنشأ في الهاتف (يعمل أوفلاين)
  user_id        uuid not null default auth.uid()
                 references auth.users(id) on delete cascade,  -- صاحب المهمة
  title          text not null check (char_length(title) between 1 and 500),
  category       text not null default 'personal'
                 check (category in ('school','home','family','personal')),
  due_date       date,                                     -- تاريخ اختياري
  due_time       time,                                     -- ساعة اختيارية
  importance     smallint check (importance between 1 and 4),  -- المرحلة 2: مصفوفة أيزنهاور
  duration_min   smallint check (duration_min > 0),        -- المرحلة 2: المدة بالدقائق
  status         text not null default 'inbox'
                 check (status in ('inbox','today','done')),
  plan_date      date,                                     -- المرحلة 2-3: يوم التنفيذ
  postpone_count smallint not null default 0,              -- عدد مرات التأجيل
  order_index    int,                                      -- المرحلة 3: الترتيب في خطة اليوم
  source         text not null default 'manual',           -- manual / voice / share
  completed_at   timestamptz,
  deleted        boolean not null default false,           -- حذف ناعم (soft delete) حتى تصل المزامنة لكل الأجهزة
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),       -- وقت التعديل في الهاتف (الأحدث يفوز)
  synced_at      timestamptz not null default now()        -- وقت الكتابة في الخادم (مؤشر السحب pull cursor)
);

-- فهرس لتسريع السحب: "أعطني ما تغيّر بعد وقت معيّن"
create index if not exists tasks_user_synced_idx on public.tasks (user_id, synced_at);

-- ---------------------------------------------------------------------
-- Trigger: قبل كل كتابة
--  1) يضع synced_at = الآن (حتى تعرف الأجهزة الأخرى أن هناك تغييرًا)
--  2) "الأحدث يفوز" (Last-Write-Wins): إذا وصل تعديل أقدم من الموجود، نتجاهله
-- ---------------------------------------------------------------------
create or replace function public.tasks_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.user_id := old.user_id;                    -- لا يمكن نقل مهمة لمستخدم آخر
    if new.updated_at < old.updated_at then
      return old;                                  -- تعديل قديم: لا تغيّر شيئًا
    end if;
  end if;
  new.synced_at := now();
  return new;
end;
$$;

drop trigger if exists tasks_before_write on public.tasks;
create trigger tasks_before_write
  before insert or update on public.tasks
  for each row execute function public.tasks_before_write();

-- ---------------------------------------------------------------------
-- الأمان: Row Level Security (RLS)
-- كل مستخدم يرى ويعدّل مهامه فقط. بدون هذا يستطيع أي أحد قراءة الجدول!
-- ---------------------------------------------------------------------
alter table public.tasks enable row level security;

drop policy if exists "own tasks" on public.tasks;
create policy "own tasks" on public.tasks
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
