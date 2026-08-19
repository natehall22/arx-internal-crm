-- Job Run Sheet overrides — ops-editable text for the printable one-page job sheet.
--
-- Every column is nullable: NULL means "use the value the CRM computed". A non-null value is an
-- explicit ops override that wins on the sheet until it is cleared. Additive only; nothing here
-- changes how production_jobs / projects / proposals behave.

create table if not exists public.job_run_sheet_overrides (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  job_id uuid not null references public.production_jobs(id) on delete cascade,
  -- NULL = fall back to the computed value from proposal / project review / job record.
  schedule_note text,
  scope_of_work text,
  materials_and_products text,
  tear_off_and_decking text,
  accessories text,
  add_ons_sold text,
  heads_up text,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One override row per job; the API upserts on this constraint.
create unique index if not exists job_run_sheet_overrides_job_id_key
  on public.job_run_sheet_overrides (job_id);

create index if not exists job_run_sheet_overrides_org_id_idx
  on public.job_run_sheet_overrides (org_id);

alter table public.job_run_sheet_overrides enable row level security;

drop policy if exists "Users can view job run sheet overrides in their org" on public.job_run_sheet_overrides;
create policy "Users can view job run sheet overrides in their org"
  on public.job_run_sheet_overrides
  for select
  using (org_id = get_user_org_id(auth.uid()));

drop policy if exists "Users can insert job run sheet overrides in their org" on public.job_run_sheet_overrides;
create policy "Users can insert job run sheet overrides in their org"
  on public.job_run_sheet_overrides
  for insert
  with check (org_id = get_user_org_id(auth.uid()));

drop policy if exists "Users can update job run sheet overrides in their org" on public.job_run_sheet_overrides;
create policy "Users can update job run sheet overrides in their org"
  on public.job_run_sheet_overrides
  for update
  using (org_id = get_user_org_id(auth.uid()))
  with check (org_id = get_user_org_id(auth.uid()));

drop policy if exists "Users can delete job run sheet overrides in their org" on public.job_run_sheet_overrides;
create policy "Users can delete job run sheet overrides in their org"
  on public.job_run_sheet_overrides
  for delete
  using (org_id = get_user_org_id(auth.uid()));

comment on table public.job_run_sheet_overrides is
  'Ops edits to the printable job run sheet. NULL column = use the CRM-computed value.';
