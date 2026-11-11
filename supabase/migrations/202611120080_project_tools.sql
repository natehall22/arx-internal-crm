-- Project tools (2026-11-12): budget vs actual by cost code, selections & allowances, job schedule stages, daily logs.
-- Nothing here is read unless the company turns on the `projectTools` switch (orgs.settings.features; home_builder
-- profile default ON, everyone else OFF), so applying it changes nothing for anyone. Additive only. The ONE cost ledger
-- stays job_cost_lines: a cost code is just a nullable label on a ledger line; a budget is a sibling table keyed
-- (job, cost code), never a second place costs live.
--
-- 1. org_cost_codes: a company's own cost code list. EMPTY = the built-in defaults (Materials, Labor, Sub, Permit, Dump,
--    Equipment, Other) in lib/cost-codes.ts. Codes are turned off, never deleted (old lines keep their code).
-- 2. job_cost_lines.cost_code: nullable. NULL = the code its cost_type maps to.
-- 3. job_budget_lines + job_budget_changes: the budget per job per code and every edit (old -> new, who, why).
--    set_job_budget_line() writes both in one transaction.
-- 4. job_selections: item, allowance, options, chosen option, price difference, due date, status; a customer link token;
--    change_order_id = the signed change order an overage turns into (job_change_orders, the existing system).
-- 5. job_stages: planned schedule stages per job (name, trade, start, workdays, depends on), optionally linked to the
--    trade's work_orders row (the booked crew/date stays on work_orders; this is the plan).
-- 6. job_daily_logs: one note + photos (photo ids on photos) + weather per day, optional summary sent to the customer.
--
-- All tables: RLS on, no policies (service role only, like service_visit_charges).
-- ROLLBACK: DROP FUNCTION set_job_budget_line(uuid,uuid,text,numeric,uuid,text); DROP TABLE job_daily_logs, job_stages,
--   job_selections, job_budget_changes, job_budget_lines, org_cost_codes; ALTER TABLE job_cost_lines DROP COLUMN cost_code.

begin;
set local lock_timeout = '5s';

create table if not exists public.org_cost_codes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  code text not null check (code ~ '^[a-z0-9_]{1,40}$'),
  label text not null check (length(btrim(label)) between 1 and 60),
  cost_type text null check (cost_type is null or cost_type in ('material','labor','permit','subcontractor','misc','other')),
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, code)
);
alter table public.org_cost_codes enable row level security;

alter table public.job_cost_lines add column if not exists cost_code text null;
comment on column public.job_cost_lines.cost_code is 'Company cost code (org_cost_codes.code or a built-in default). NULL = the code its cost_type maps to.';

create table if not exists public.job_budget_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  job_id uuid not null references public.production_jobs(id) on delete cascade,
  cost_code text not null,
  amount numeric(12,2) not null check (amount >= 0),
  updated_by uuid null references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, cost_code)
);
create index if not exists idx_job_budget_lines_org_job on public.job_budget_lines (org_id, job_id);
alter table public.job_budget_lines enable row level security;

create table if not exists public.job_budget_changes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  job_id uuid not null references public.production_jobs(id) on delete cascade,
  cost_code text not null,
  old_amount numeric(12,2) null,
  new_amount numeric(12,2) not null,
  reason text null,
  changed_by uuid null references public.users(id) on delete set null,
  changed_at timestamptz not null default now()
);
create index if not exists idx_job_budget_changes_job on public.job_budget_changes (org_id, job_id, changed_at desc);
alter table public.job_budget_changes enable row level security;

-- ONE writer for a budget amount: the line and its history row land together or not at all; an unchanged amount writes nothing.
create or replace function public.set_job_budget_line(p_org uuid, p_job uuid, p_code text, p_amount numeric, p_user uuid, p_reason text)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare v_old numeric(12,2); v_new numeric(12,2) := round(p_amount, 2);
begin
  if not exists (select 1 from production_jobs where id = p_job and org_id = p_org) then raise exception 'job_not_found' using errcode = 'P0002'; end if;
  if v_new is null or v_new < 0 then raise exception 'bad_amount' using errcode = '22023'; end if;
  select amount into v_old from job_budget_lines where job_id = p_job and org_id = p_org and cost_code = p_code for update;
  if found and v_old = v_new then return jsonb_build_object('changed', false, 'old', v_old, 'new', v_new); end if;
  insert into job_budget_lines (org_id, job_id, cost_code, amount, updated_by) values (p_org, p_job, p_code, v_new, p_user)
    on conflict (job_id, cost_code) do update set amount = excluded.amount, updated_by = excluded.updated_by, updated_at = now();
  insert into job_budget_changes (org_id, job_id, cost_code, old_amount, new_amount, reason, changed_by)
    values (p_org, p_job, p_code, v_old, v_new, nullif(btrim(coalesce(p_reason, '')), ''), p_user);
  return jsonb_build_object('changed', true, 'old', v_old, 'new', v_new);
end $$;
revoke all on function public.set_job_budget_line(uuid,uuid,text,numeric,uuid,text) from public, anon, authenticated;

create table if not exists public.job_selections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  job_id uuid not null references public.production_jobs(id) on delete cascade,
  item text not null check (length(btrim(item)) between 1 and 120),
  allowance numeric(12,2) not null default 0 check (allowance >= 0),
  options jsonb not null default '[]'::jsonb,
  chosen_option_id text null,
  chosen_label text null,
  chosen_price numeric(12,2) null check (chosen_price is null or chosen_price >= 0),
  due_date date null,
  status text not null default 'draft' check (status in ('draft','sent','chosen','cancelled')),
  link_token text null unique,
  token_expires_at timestamptz null,
  requested_by uuid null references public.users(id) on delete set null,
  requested_by_name text null,
  requested_signature text null,
  sent_at timestamptz null,
  chosen_at timestamptz null,
  chosen_by_name text null,
  chosen_source text null check (chosen_source is null or chosen_source in ('customer','staff')),
  change_order_id uuid null references public.job_change_orders(id) on delete set null,
  created_by uuid null references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_job_selections_job on public.job_selections (org_id, job_id);
alter table public.job_selections enable row level security;

create table if not exists public.job_stages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  job_id uuid not null references public.production_jobs(id) on delete cascade,
  stage_key text not null check (stage_key ~ '^[a-z0-9_]{1,40}$'),
  name text not null check (length(btrim(name)) between 1 and 80),
  trade text null,
  work_order_id uuid null references public.work_orders(id) on delete set null,
  start_date date not null,
  workdays integer not null default 1 check (workdays between 1 and 365),
  depends_on text[] not null default '{}',
  sort_order integer not null default 0,
  done_at timestamptz null,
  template_id text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, stage_key)
);
create index if not exists idx_job_stages_job on public.job_stages (org_id, job_id);
alter table public.job_stages enable row level security;

create table if not exists public.job_daily_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  job_id uuid not null references public.production_jobs(id) on delete cascade,
  log_date date not null,
  note text not null default '' check (length(note) <= 4000),
  weather text null check (weather is null or length(weather) <= 200),
  photo_ids uuid[] not null default '{}',
  work_order_id uuid null references public.work_orders(id) on delete set null,
  created_by uuid null references public.users(id) on delete set null,
  author_name text null,
  source text not null default 'staff' check (source in ('staff','crew')),
  summary_sent_at timestamptz null,
  summary_sent_to text null,
  created_at timestamptz not null default now()
);
create index if not exists idx_job_daily_logs_job on public.job_daily_logs (org_id, job_id, log_date desc, created_at desc);
alter table public.job_daily_logs enable row level security;

commit;
