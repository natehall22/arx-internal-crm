-- Invoices without a job: recurring service (lawn visits, a roof & gutter care plan) billed on the ONE invoice system,
-- job_invoices (+ items, payments). Additive / nullable only; every job invoice keeps working exactly as today.
--
-- APPLY ORDER: after 202611100040 (job_invoices.org_id), 202611110030 (service plans) and 202611110040 (sales tax:
-- job_invoice_items.taxable). Before the code that bills visits (the code reads "not ready" until then and offers nothing).
--
-- 1. job_invoices.job_id becomes NULLABLE. A row has a job (as today) OR a customer (+ optional property) — CHECK.
--    For a job invoice nothing changes: org_id from the job (trigger), INV-<YY>-<job_number>-<seq>.
--    For a customer invoice: org_id is given by the writer and the trigger checks the customer (and property) belong to
--    that company; number INV-<YY>-<5-digit seq per company per year> (can't collide with the 5-part job format).
--    invoice_kind gains 'service'.
-- 2. job_invoice_items gain what a service line needs: work_order_id (the visit billed), service_date, service_plan_id +
--    billing_month (a monthly plan's month, always the 1st), unit ('hour' = time & materials: qty hours × rate).
-- 3. job_payments.job_id becomes NULLABLE so a customer invoice can be paid on the same ledger: such a row carries
--    org_id + customer_id (CHECK + trigger: customer in that company). Every existing reader filters job_payments by
--    job id (verified 2026-11-11: 16 app files, rpt_* views join production_jobs), so these rows never reach a job total,
--    payroll or the paid-in-full rule (lib/job-collection.ts). Browser RLS joins the job, so they are service-role only.
-- 4. create_service_invoice(): THE writer of billed service lines. One transaction under a per-company advisory lock:
--    a visit (work_order_id) or a plan-month (service_plan_id + billing_month) already on a non-void invoice is skipped,
--    so a double tap, two office people, or a retried batch can never bill it twice. Voiding the invoice frees them.
--
-- ROLLBACK (only while no customer invoice / payment exists):
--   drop function public.create_service_invoice(uuid, uuid, uuid, uuid, jsonb);
--   drop function public.generate_customer_invoice_number(uuid); drop function public.job_payments_customer_guard() cascade;
--   restore set_invoice_number (053b) and job_invoices_set_org (202611100040) bodies, the trigger column list, the kind CHECK;
--   alter table job_invoice_items drop column work_order_id, service_date, service_plan_id, billing_month, unit;
--   alter table job_invoices drop constraint job_invoices_job_or_customer, drop column customer_id, property_id;
--   alter table job_payments drop constraint job_payments_job_or_customer, drop column org_id, customer_id;
--   alter table job_invoices / job_payments alter column job_id set not null.

begin;
set local lock_timeout = '5s';

-- ---- 1. job_invoices ------------------------------------------------------------------------------------------------
alter table public.job_invoices
  add column if not exists customer_id uuid null references public.customers(id) on delete restrict,
  add column if not exists property_id uuid null references public.properties(id) on delete set null;
alter table public.job_invoices alter column job_id drop not null;

do $$ begin
  alter table public.job_invoices add constraint job_invoices_job_or_customer
    check (job_id is not null or (customer_id is not null and org_id is not null));
exception when duplicate_object then null; end $$;

alter table public.job_invoices drop constraint if exists job_invoices_kind_check;
alter table public.job_invoices add constraint job_invoices_kind_check
  check (invoice_kind in ('deposit', 'final', 'standard', 'service'));

create index if not exists job_invoices_customer_idx on public.job_invoices (org_id, customer_id) where customer_id is not null;

-- org_id: a job invoice's is ALWAYS its job's (unchanged); a customer invoice's is the writer's, checked against the
-- customer and property. A customer named on any invoice must be in the invoice's company.
create or replace function public.job_invoices_set_org()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
begin
  if new.job_id is not null then
    select pj.org_id into v_org from public.production_jobs pj where pj.id = new.job_id;
    if v_org is null then
      raise exception 'job_invoices: job % has no org', new.job_id;
    end if;
    new.org_id := v_org;
  elsif new.org_id is null then
    raise exception 'job_invoices: an invoice without a job needs org_id' using errcode = '23502';
  end if;
  if new.customer_id is not null
     and not exists (select 1 from public.customers c where c.id = new.customer_id and c.org_id = new.org_id) then
    raise exception 'job_invoices: customer is not in this company' using errcode = '42501';
  end if;
  if new.property_id is not null
     and not exists (select 1 from public.properties p
                     where p.id = new.property_id and p.org_id = new.org_id and p.customer_id = new.customer_id) then
    raise exception 'job_invoices: property is not this customer''s' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trigger_job_invoices_org on public.job_invoices;
create trigger trigger_job_invoices_org
  before insert or update of job_id, org_id, customer_id, property_id on public.job_invoices
  for each row execute function public.job_invoices_set_org();

-- Customer invoice numbers: INV-<YY>-<seq 5+ digits>, per company per year, serialized per company.
create or replace function public.generate_customer_invoice_number(p_org uuid)
returns text
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_prefix text := 'INV-' || to_char(now(), 'YY') || '-';
  v_seq integer;
  v_number text;
begin
  perform pg_advisory_xact_lock(hashtextextended('job_invoices:customer:' || p_org::text, 0));
  select count(*) + 1 into v_seq from public.job_invoices
   where org_id = p_org and job_id is null and invoice_number like v_prefix || '%';
  loop
    v_number := v_prefix || lpad(v_seq::text, 5, '0');
    exit when not exists (select 1 from public.job_invoices where org_id = p_org and invoice_number = v_number);
    v_seq := v_seq + 1;
  end loop;
  return v_number;
end;
$$;

create or replace function public.set_invoice_number()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.invoice_number is null or new.invoice_number = '' then
    if new.job_id is null then
      new.invoice_number := generate_customer_invoice_number(new.org_id);
    else
      new.invoice_number := generate_invoice_number(new.job_id);
    end if;
  end if;
  return new;
end;
$$;

-- ---- 2. job_invoice_items -------------------------------------------------------------------------------------------
alter table public.job_invoice_items
  add column if not exists work_order_id uuid null references public.work_orders(id) on delete set null,
  add column if not exists service_date date null,
  add column if not exists service_plan_id uuid null references public.service_plans(id) on delete set null,
  add column if not exists billing_month date null,
  add column if not exists unit text null;

do $$ begin
  alter table public.job_invoice_items add constraint job_invoice_items_unit_check check (unit is null or unit = 'hour');
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.job_invoice_items add constraint job_invoice_items_billing_month_check
    check (billing_month is null or (extract(day from billing_month) = 1 and service_plan_id is not null));
exception when duplicate_object then null; end $$;

create index if not exists job_invoice_items_work_order_idx on public.job_invoice_items (work_order_id) where work_order_id is not null;
create index if not exists job_invoice_items_plan_month_idx on public.job_invoice_items (service_plan_id, billing_month) where billing_month is not null;

-- ---- 3. job_payments ------------------------------------------------------------------------------------------------
alter table public.job_payments
  add column if not exists org_id uuid null references public.orgs(id) on delete cascade,
  add column if not exists customer_id uuid null references public.customers(id) on delete restrict;
alter table public.job_payments alter column job_id drop not null;

do $$ begin
  alter table public.job_payments add constraint job_payments_job_or_customer
    check (job_id is not null or (org_id is not null and customer_id is not null));
exception when duplicate_object then null; end $$;

create index if not exists job_payments_customer_idx on public.job_payments (org_id, customer_id) where job_id is null;

create or replace function public.job_payments_customer_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.customer_id is not null
     and not exists (select 1 from public.customers c where c.id = new.customer_id and c.org_id = new.org_id) then
    raise exception 'job_payments: customer is not in this company' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists job_payments_customer_guard on public.job_payments;
create trigger job_payments_customer_guard
  before insert or update of org_id, customer_id on public.job_payments
  for each row execute function public.job_payments_customer_guard();

-- ---- 4. THE writer of billed service lines ---------------------------------------------------------------------------
-- p_lines: [{ description, qty, unit_price_cents, taxable, work_order_id?, service_date?, service_plan_id?, billing_month?, unit? }]
-- Returns { invoice_id (null when nothing is left to bill), skipped: [ { work_order_id } | { service_plan_id, billing_month } ] }.
create or replace function public.create_service_invoice(
  p_org uuid, p_customer uuid, p_property uuid, p_created_by uuid, p_lines jsonb
) returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_line jsonb;
  v_wo uuid;
  v_plan uuid;
  v_month date;
  v_kept jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_billed_months jsonb := '[]'::jsonb; -- plan-months kept on THIS invoice ("<plan>|<month>")
  v_priced integer := 0;
  v_inv uuid;
begin
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 or jsonb_array_length(p_lines) > 500 then
    raise exception 'create_service_invoice: 1–500 lines' using errcode = '22023';
  end if;
  if not exists (select 1 from public.customers c where c.id = p_customer and c.org_id = p_org) then
    raise exception 'create_service_invoice: customer is not in this company' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('service_invoice:' || p_org::text, 0));

  -- Pass 1: plan-month lines and priced visit lines.
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_wo := nullif(v_line->>'work_order_id', '')::uuid;
    v_plan := nullif(v_line->>'service_plan_id', '')::uuid;
    v_month := nullif(v_line->>'billing_month', '')::date;
    if v_plan is not null and not exists (
      select 1 from public.service_plans sp where sp.id = v_plan and sp.org_id = p_org and sp.customer_id = p_customer) then
      raise exception 'create_service_invoice: plan is not this customer''s' using errcode = '42501';
    end if;
    if v_month is not null then
      if v_plan is null then raise exception 'create_service_invoice: a month line needs its plan' using errcode = '22023'; end if;
      if exists (select 1 from public.job_invoice_items it join public.job_invoices ji on ji.id = it.invoice_id
                 where it.service_plan_id = v_plan and it.billing_month = v_month and ji.status <> 'void') then
        v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('service_plan_id', v_plan, 'billing_month', v_month));
        continue;
      end if;
      v_billed_months := v_billed_months || to_jsonb(v_plan::text || '|' || v_month::text);
      v_kept := v_kept || jsonb_build_array(v_line);
      v_priced := v_priced + 1;
    elsif v_wo is not null then
      if not exists (select 1 from public.work_orders w
                     where w.id = v_wo and w.org_id = p_org and w.customer_id = p_customer
                       and w.work_order_type = 'service_visit' and w.status = 'completed'
                       and (v_plan is null or w.service_plan_id = v_plan)) then
        raise exception 'create_service_invoice: % is not a done visit of this customer', v_wo using errcode = '22023';
      end if;
      if exists (select 1 from public.job_invoice_items it join public.job_invoices ji on ji.id = it.invoice_id
                 where it.work_order_id = v_wo and ji.status <> 'void') then
        v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('work_order_id', v_wo));
        continue;
      end if;
      if coalesce((v_line->>'unit_price_cents')::integer, 0) > 0 then
        v_kept := v_kept || jsonb_build_array(v_line);
        v_priced := v_priced + 1;
      end if;
    else
      v_kept := v_kept || jsonb_build_array(v_line); -- a plain line (e.g. hours) rides along; it never makes an invoice alone
    end if;
  end loop;

  -- Pass 2: $0 visit lines (a monthly plan's visits, listed) only beside their own plan-month line on this invoice.
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_wo := nullif(v_line->>'work_order_id', '')::uuid;
    v_plan := nullif(v_line->>'service_plan_id', '')::uuid;
    if v_wo is null or nullif(v_line->>'billing_month', '') is not null or coalesce((v_line->>'unit_price_cents')::integer, 0) > 0 then
      continue;
    end if;
    if v_plan is null or nullif(v_line->>'service_date', '') is null
       or not (v_billed_months ? (v_plan::text || '|' || date_trunc('month', (v_line->>'service_date')::date)::date::text)) then
      continue;
    end if;
    if exists (select 1 from public.job_invoice_items it join public.job_invoices ji on ji.id = it.invoice_id
               where it.work_order_id = v_wo and ji.status <> 'void') then
      continue;
    end if;
    v_kept := v_kept || jsonb_build_array(v_line);
  end loop;

  if v_priced = 0 then
    return jsonb_build_object('invoice_id', null, 'skipped', v_skipped);
  end if;

  insert into public.job_invoices (org_id, customer_id, property_id, created_by, status, invoice_kind)
  values (p_org, p_customer, p_property, p_created_by, 'draft', 'service')
  returning id into v_inv;

  insert into public.job_invoice_items (
    invoice_id, description, qty, unit_price_cents, line_total_cents, sort_order, taxable,
    work_order_id, service_date, service_plan_id, billing_month, unit)
  select v_inv,
         left(btrim(l->>'description'), 500),
         coalesce((l->>'qty')::numeric, 1),
         (l->>'unit_price_cents')::integer,
         round(coalesce((l->>'qty')::numeric, 1) * (l->>'unit_price_cents')::integer)::integer,
         (ord - 1)::integer,
         coalesce((l->>'taxable')::boolean, false),
         nullif(l->>'work_order_id', '')::uuid,
         nullif(l->>'service_date', '')::date,
         nullif(l->>'service_plan_id', '')::uuid,
         nullif(l->>'billing_month', '')::date,
         nullif(l->>'unit', '')
  from jsonb_array_elements(v_kept) with ordinality as t(l, ord);

  return jsonb_build_object('invoice_id', v_inv, 'skipped', v_skipped);
end;
$$;

revoke all on function public.create_service_invoice(uuid, uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.create_service_invoice(uuid, uuid, uuid, uuid, jsonb) to service_role;
revoke all on function public.generate_customer_invoice_number(uuid) from public, anon, authenticated;

comment on column public.job_invoices.customer_id is 'Set on invoices without a job (job_id NULL): recurring service billed to a customer. Job invoices leave it NULL.';
comment on column public.job_invoice_items.work_order_id is 'The service visit this line bills. A visit on a non-void invoice is billed (create_service_invoice).';
comment on column public.job_invoice_items.billing_month is 'A monthly plan''s month (1st of month) with service_plan_id. Billed once per non-void invoice.';
comment on column public.job_invoice_items.unit is 'NULL = each; ''hour'' = time & materials (qty = hours, unit_price_cents = hourly rate).';
comment on column public.job_payments.customer_id is 'Payments on an invoice without a job (job_id NULL): org_id + customer_id. Never counted toward a job.';

commit;
