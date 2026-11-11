-- Hourly (time & materials) billing (2026-11-12): bill grading / tractor / clean-up work by the hour from the crew clock
-- (time_entries, 202611110070) or from hours the office types (subs, a forgotten clock). Nothing here is read unless the
-- company turns on the `hourlyBilling` switch (orgs.settings.features, default OFF), so applying it changes nothing for
-- anyone. Additive / nullable only. Payroll never reads any of this: the exact minutes stay in time_entries.
--
-- 1. production_jobs: billing_mode ('time_materials' = billed by the hour; NULL = as today), estimated_hours, and the
--    price-book item whose hourly price is the labor rate (hourly_rate_item_id).
-- 2. service_plans / service_plan_templates: billing_basis gains 'per_hour' (the plan's price = the hourly labor rate;
--    its visits are billed from "Hours to bill", never from "Ready to bill").
-- 3. billed_time_days: one row per (job or visit, local work day) the office approved — the billable lines after the
--    company's rules, the clocked seconds behind them, the edit reason, and the invoice it went on. At most ONE approved
--    row per job/visit per day (partial unique index): approved hours can never be billed twice. Un-approving is only
--    possible once that invoice is void (unapprove_billed_time). Service role only (RLS on, no policies).
-- 4. approve_billed_time(): THE writer. One transaction under the same per-company lock as create_service_invoice
--    (202611110060): checks the job / visit, refuses days already approved and a visit already on a live invoice,
--    writes the invoice (job invoice, or an invoice without a job for a visit), its lines (+ totals computed by the app's
--    ONE tax calculation, checked against the lines) and the approval rows — all or nothing.
--
-- Deploy: apply BEFORE the code. Needs 202611100040, 202611110030, 202611110040, 202611110060 (the invoice / plan / tax
-- columns it writes). Order-free with 202611110070 / 202611120010.
-- ROLLBACK (only while billed_time_days is empty): DROP FUNCTION approve_billed_time(uuid, uuid, uuid, uuid, jsonb, jsonb, jsonb),
--   unapprove_billed_time(uuid, uuid, uuid, text); DROP TABLE billed_time_days; ALTER TABLE production_jobs DROP COLUMN
--   billing_mode, estimated_hours, hourly_rate_item_id; restore the two billing_basis CHECKs from 202611110030
--   (only once no plan / template is 'per_hour').

begin;
set local lock_timeout = '5s';

-- ---- 1. Jobs billed by the hour ---------------------------------------------------------------------------------------
alter table public.production_jobs
  add column if not exists billing_mode text null,
  add column if not exists estimated_hours numeric(8, 2) null,
  add column if not exists hourly_rate_item_id uuid null references public.pricebook_items(id) on delete set null;
do $$ begin
  alter table public.production_jobs add constraint production_jobs_billing_mode_check check (billing_mode is null or billing_mode = 'time_materials');
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.production_jobs add constraint production_jobs_estimated_hours_check check (estimated_hours is null or (estimated_hours >= 0 and estimated_hours <= 100000));
exception when duplicate_object then null; end $$;
comment on column public.production_jobs.billing_mode is 'NULL = billed as sold (the contract). ''time_materials'' = billed by the hour from Hours to bill (feature hourlyBilling).';
comment on column public.production_jobs.hourly_rate_item_id is 'Time & materials: the price-book item (unit hour) whose price is the labor rate per hour.';

-- ---- 2. Plans billed by the hour --------------------------------------------------------------------------------------
alter table public.service_plans drop constraint if exists service_plans_billing_basis_check;
alter table public.service_plans add constraint service_plans_billing_basis_check
  check (billing_basis in ('per_visit', 'per_month', 'per_year', 'per_hour'));
alter table public.service_plan_templates drop constraint if exists service_plan_templates_billing_basis_check;
alter table public.service_plan_templates add constraint service_plan_templates_billing_basis_check
  check (billing_basis in ('per_visit', 'per_month', 'per_year', 'per_hour'));

-- ---- 3. Approved billable days ----------------------------------------------------------------------------------------
create table if not exists public.billed_time_days (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  production_job_id uuid null references public.production_jobs(id) on delete restrict,
  work_order_id uuid null references public.work_orders(id) on delete restrict,
  work_date date not null,
  status text not null default 'approved' check (status in ('approved', 'unapproved')),
  -- 'clock' = straight from the clock after the rules; 'typed' = no clock time, typed by the office; 'edited' = clock
  -- time changed by the office (edit_reason says why).
  source text not null check (source in ('clock', 'typed', 'edited')),
  edit_reason text null check (edit_reason is null or char_length(edit_reason) between 1 and 500),
  -- Labor person-seconds the clock had for this job/visit that day when it was approved (the audit trail).
  clocked_seconds integer not null default 0 check (clocked_seconds >= 0),
  billable_hours numeric(10, 2) not null default 0 check (billable_hours >= 0),
  -- The billed lines as approved: [{kind, description, hours, people, rate_cents, item_id, reasons[]}].
  lines jsonb not null default '[]'::jsonb,
  invoice_id uuid null references public.job_invoices(id) on delete restrict,
  approved_by uuid null references public.users(id) on delete set null,
  approved_at timestamptz not null default now(),
  unapproved_by uuid null references public.users(id) on delete set null,
  unapproved_at timestamptz null,
  unapprove_reason text null check (unapprove_reason is null or char_length(unapprove_reason) between 1 and 500),
  constraint billed_time_days_one_target check ((production_job_id is null) <> (work_order_id is null)),
  constraint billed_time_days_edit_reason check (source <> 'edited' or edit_reason is not null),
  constraint billed_time_days_unapproved check (status = 'approved' or (unapproved_at is not null and unapprove_reason is not null))
);
create unique index if not exists billed_time_days_job_day_once on public.billed_time_days (org_id, production_job_id, work_date)
  where status = 'approved' and production_job_id is not null;
create unique index if not exists billed_time_days_visit_day_once on public.billed_time_days (org_id, work_order_id, work_date)
  where status = 'approved' and work_order_id is not null;
create index if not exists billed_time_days_org_day_idx on public.billed_time_days (org_id, work_date desc);
create index if not exists billed_time_days_invoice_idx on public.billed_time_days (invoice_id) where invoice_id is not null;
alter table public.billed_time_days enable row level security;
revoke all on public.billed_time_days from anon, authenticated;

-- ---- 4. THE writer --------------------------------------------------------------------------------------------------
-- p_days:   [{ work_date, source, edit_reason?, clocked_seconds, billable_hours, lines }]
-- p_lines:  invoice lines [{ description, qty, unit_price_cents, taxable, unit?('hour'), service_date }]
-- p_totals: { subtotal_cents, taxable_subtotal_cents, tax_cents, tax_lines, total_cents } (lib/sales-tax.ts, by the customer)
-- Returns { invoice_id, invoice_number } or { invoice_id: null, skipped: [ { work_date } | { work_order_id } ] } — nothing
-- written when anything is skipped.
create or replace function public.approve_billed_time(
  p_org uuid, p_job uuid, p_visit uuid, p_created_by uuid, p_days jsonb, p_lines jsonb, p_totals jsonb
) returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_customer uuid;
  v_property uuid;
  v_status text;
  v_mode text;
  v_basis text;
  v_day jsonb;
  v_date date;
  v_dates date[] := '{}';
  v_skipped jsonb := '[]'::jsonb;
  v_line jsonb;
  v_subtotal bigint := 0;
  v_priced integer := 0;
  v_inv uuid;
  v_number text;
begin
  if (p_job is null) = (p_visit is null) then
    raise exception 'approve_billed_time: a job or a visit' using errcode = '22023';
  end if;
  if jsonb_typeof(p_days) is distinct from 'array' or jsonb_array_length(p_days) = 0 or jsonb_array_length(p_days) > 31 then
    raise exception 'approve_billed_time: 1–31 days' using errcode = '22023';
  end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 or jsonb_array_length(p_lines) > 300 then
    raise exception 'approve_billed_time: 1–300 lines' using errcode = '22023';
  end if;

  -- Same lock as create_service_invoice / the billed-visit guard: billing runs and approvals never cross.
  perform pg_advisory_xact_lock(hashtextextended('service_invoice:' || p_org::text, 0));

  if p_job is not null then
    select j.customer_id, j.status::text, j.billing_mode into v_customer, v_status, v_mode
      from public.production_jobs j where j.id = p_job and j.org_id = p_org;
    if not found then raise exception 'approve_billed_time: job not found' using errcode = 'P0002'; end if;
    if v_mode is distinct from 'time_materials' then
      raise exception 'This job is not billed by the hour' using errcode = '22023';
    end if;
    if v_status = 'cancelled' then raise exception 'This job is cancelled' using errcode = '22023'; end if;
  else
    select coalesce(w.customer_id, sp.customer_id), coalesce(w.property_id, sp.property_id), w.status, sp.billing_basis
      into v_customer, v_property, v_status, v_basis
      from public.work_orders w join public.service_plans sp on sp.id = w.service_plan_id and sp.org_id = w.org_id
     where w.id = p_visit and w.org_id = p_org and w.work_order_type = 'service_visit' and w.job_id is null;
    if not found then raise exception 'approve_billed_time: visit not found' using errcode = 'P0002'; end if;
    if v_basis is distinct from 'per_hour' then
      raise exception 'This visit''s plan is not billed by the hour' using errcode = '22023';
    end if;
    if v_status in ('cancelled', 'skipped') then raise exception 'This visit was not done' using errcode = '22023'; end if;
    if v_customer is null then raise exception 'This visit has no customer' using errcode = '22023'; end if;
    -- Already on a live invoice (here or from Ready to bill): never twice.
    if exists (select 1 from public.job_invoice_items it join public.job_invoices ji on ji.id = it.invoice_id
               where it.work_order_id = p_visit and ji.status <> 'void') then
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('work_order_id', p_visit));
    end if;
  end if;

  for v_day in select * from jsonb_array_elements(p_days) loop
    v_date := (v_day->>'work_date')::date;
    if v_date is null then raise exception 'approve_billed_time: a day needs work_date' using errcode = '22023'; end if;
    if v_date = any(v_dates) then raise exception 'approve_billed_time: a day is listed twice' using errcode = '22023'; end if;
    v_dates := v_dates || v_date;
    if coalesce(v_day->>'source', '') not in ('clock', 'typed', 'edited') then
      raise exception 'approve_billed_time: unknown source' using errcode = '22023';
    end if;
    if exists (select 1 from public.billed_time_days b
               where b.org_id = p_org and b.status = 'approved' and b.work_date = v_date
                 and (b.production_job_id = p_job or b.work_order_id = p_visit)) then
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('work_date', v_date));
    end if;
  end loop;

  if jsonb_array_length(v_skipped) > 0 then
    return jsonb_build_object('invoice_id', null, 'skipped', v_skipped);
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    if coalesce((v_line->>'unit_price_cents')::integer, -1) < 0 then
      raise exception 'approve_billed_time: a line needs a price of 0 or more' using errcode = '22023';
    end if;
    if coalesce((v_line->>'qty')::numeric, 0) <= 0 then
      raise exception 'approve_billed_time: a line needs hours above 0' using errcode = '22023';
    end if;
    if nullif(v_line->>'unit', '') is not null and v_line->>'unit' <> 'hour' then
      raise exception 'approve_billed_time: unknown unit' using errcode = '22023';
    end if;
    if not ((v_line->>'service_date')::date = any(v_dates)) then
      raise exception 'approve_billed_time: a line is for a day not being approved' using errcode = '22023';
    end if;
    v_subtotal := v_subtotal + round((v_line->>'qty')::numeric * (v_line->>'unit_price_cents')::integer);
    if (v_line->>'unit_price_cents')::integer > 0 then v_priced := v_priced + 1; end if;
  end loop;
  if v_priced = 0 then raise exception 'approve_billed_time: nothing to bill' using errcode = '22023'; end if;
  if jsonb_typeof(p_totals) is distinct from 'object'
     or (p_totals->>'subtotal_cents')::bigint is distinct from v_subtotal
     or (p_totals->>'total_cents')::bigint is distinct from v_subtotal + coalesce((p_totals->>'tax_cents')::bigint, 0) then
    raise exception 'approve_billed_time: totals do not match the lines' using errcode = '22023';
  end if;

  if p_job is not null then
    insert into public.job_invoices (job_id, created_by, status, invoice_kind,
                                     subtotal_cents, taxable_subtotal_cents, tax_cents, tax_lines, total_cents)
    values (p_job, p_created_by, 'draft', 'standard', v_subtotal,
            coalesce((p_totals->>'taxable_subtotal_cents')::integer, 0), coalesce((p_totals->>'tax_cents')::integer, 0),
            coalesce(p_totals->'tax_lines', '[]'::jsonb), (p_totals->>'total_cents')::integer)
    returning id, invoice_number into v_inv, v_number;
  else
    insert into public.job_invoices (org_id, customer_id, property_id, created_by, status, invoice_kind,
                                     subtotal_cents, taxable_subtotal_cents, tax_cents, tax_lines, total_cents)
    values (p_org, v_customer, v_property, p_created_by, 'draft', 'service', v_subtotal,
            coalesce((p_totals->>'taxable_subtotal_cents')::integer, 0), coalesce((p_totals->>'tax_cents')::integer, 0),
            coalesce(p_totals->'tax_lines', '[]'::jsonb), (p_totals->>'total_cents')::integer)
    returning id, invoice_number into v_inv, v_number;
  end if;

  insert into public.job_invoice_items (invoice_id, description, qty, unit_price_cents, line_total_cents, sort_order, taxable,
                                        work_order_id, service_date, unit)
  select v_inv,
         left(btrim(l->>'description'), 500),
         (l->>'qty')::numeric,
         (l->>'unit_price_cents')::integer,
         round((l->>'qty')::numeric * (l->>'unit_price_cents')::integer)::integer,
         (ord - 1)::integer,
         coalesce((l->>'taxable')::boolean, false),
         p_visit,
         (l->>'service_date')::date,
         nullif(l->>'unit', '')
  from jsonb_array_elements(p_lines) with ordinality as t(l, ord);

  insert into public.billed_time_days (org_id, production_job_id, work_order_id, work_date, status, source, edit_reason,
                                       clocked_seconds, billable_hours, lines, invoice_id, approved_by)
  select p_org, p_job, p_visit, (d->>'work_date')::date, 'approved', d->>'source', nullif(btrim(d->>'edit_reason'), ''),
         greatest(0, coalesce((d->>'clocked_seconds')::integer, 0)), greatest(0, coalesce((d->>'billable_hours')::numeric, 0)),
         coalesce(d->'lines', '[]'::jsonb), v_inv, p_created_by
  from jsonb_array_elements(p_days) d;

  return jsonb_build_object('invoice_id', v_inv, 'invoice_number', v_number, 'skipped', '[]'::jsonb);
end;
$$;

-- Un-approve: only once the invoice those hours went on is void (a void invoice never comes back), with a reason.
-- Returns true when un-approved, false when the row is not approved / its invoice is not void.
create or replace function public.unapprove_billed_time(p_org uuid, p_id uuid, p_user uuid, p_reason text)
returns boolean
language plpgsql
set search_path = public, pg_temp
as $$
declare v_n integer;
begin
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Say why' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('service_invoice:' || p_org::text, 0));
  update public.billed_time_days b
     set status = 'unapproved', unapproved_by = p_user, unapproved_at = now(), unapprove_reason = left(btrim(p_reason), 500)
   where b.id = p_id and b.org_id = p_org and b.status = 'approved'
     and (b.invoice_id is null or exists (select 1 from public.job_invoices ji where ji.id = b.invoice_id and ji.status = 'void'));
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

revoke all on function public.approve_billed_time(uuid, uuid, uuid, uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.approve_billed_time(uuid, uuid, uuid, uuid, jsonb, jsonb, jsonb) to service_role;
revoke all on function public.unapprove_billed_time(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.unapprove_billed_time(uuid, uuid, uuid, text) to service_role;

comment on table public.billed_time_days is 'Hours to bill: one approved row per job/visit per work day (never two). Billing only — payroll reads time_entries.';

commit;
