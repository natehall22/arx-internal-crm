-- job_invoices: org_id + per-company invoice numbers (multi-company prep).
--
-- APPLY ORDER: either order is safe. Apply any time before a second company creates invoices.
--   * The code on branch fix/invoice-org-scope never writes or filters on job_invoices.org_id: it scopes every invoice read
--     through the parent job (production_jobs.org_id), which works with or without this migration.
--   * This migration fills org_id itself (trigger below), so code that predates it keeps working unchanged.
--
-- Why: invoice_number was UNIQUE across the whole database. Numbers are INV-<YY>-<job_number>-<seq>, and job_number is
-- only unique per org (production_jobs UNIQUE (org_id, job_number)), so company B's first invoice on its job 26-0001 would
-- collide with company A's INV-26-26-0001-001 and fail to insert.
--
-- Steps (one transaction; job_invoices is small, so the plain CREATE INDEX lock is brief):
--   1. add nullable org_id (FK to orgs)
--   2. trigger: org_id is ALWAYS the parent job's org (filled on insert, re-derived if job_id/org_id is changed; a caller
--      that passes a different org is overwritten, not trusted)
--   3. backfill org_id from production_jobs
--   4. add UNIQUE (org_id, invoice_number) BEFORE dropping the global unique, so uniqueness is never off
--   5. drop the global unique on invoice_number (looked up by definition: its name differs between 053 and 053b installs)
--   6. number generator: per job (unchanged format), serialized per job, skips any number already used in the org
--   7. job_invoices RLS reads/writes on org_id (same answer as the old production_jobs join, since step 2 keeps them equal)
-- org_id stays NULLABLE (live-schema rule). Every row has one after step 3 and the trigger keeps it that way; making it
-- NOT NULL is a separate decision.
--
-- Items and payments (job_invoice_items, invoice_payments) get no org_id: they are children of one invoice
-- (invoice_id FK, ON DELETE CASCADE) and every read/write goes through an invoice already checked for the org.
--
-- ROLLBACK (only if needed; re-check for duplicate numbers across orgs first):
--   drop trigger if exists trigger_job_invoices_org on public.job_invoices;
--   drop function if exists public.job_invoices_set_org();
--   alter table public.job_invoices add constraint job_invoices_invoice_number_key unique (invoice_number);
--   drop index if exists public.job_invoices_org_invoice_number_key;
--   restore the three 053 policies (EXISTS join on production_jobs) and the 053 generate_invoice_number body;
--   alter table public.job_invoices drop column org_id;

begin;

-- 1
alter table public.job_invoices add column if not exists org_id uuid references public.orgs(id) on delete cascade;

-- 2
create or replace function public.job_invoices_set_org()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
begin
  select pj.org_id into v_org from public.production_jobs pj where pj.id = new.job_id;
  if v_org is null then
    raise exception 'job_invoices: job % has no org', new.job_id;
  end if;
  new.org_id := v_org;
  return new;
end;
$$;

-- Name sorts before trigger_set_invoice_number, so org_id is set before the number is generated.
drop trigger if exists trigger_job_invoices_org on public.job_invoices;
create trigger trigger_job_invoices_org
  before insert or update of job_id, org_id on public.job_invoices
  for each row execute function public.job_invoices_set_org();

-- 3
update public.job_invoices ji
set org_id = pj.org_id
from public.production_jobs pj
where pj.id = ji.job_id
  and ji.org_id is distinct from pj.org_id;

-- 4 (also serves as the org_id index: org_id is its leading column)
create unique index if not exists job_invoices_org_invoice_number_key
  on public.job_invoices (org_id, invoice_number);

-- 5
do $$
declare
  c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.job_invoices'::regclass
      and con.contype = 'u'
      and con.conkey = array[(select attnum from pg_attribute
                              where attrelid = 'public.job_invoices'::regclass and attname = 'invoice_number')]::int2[]
  loop
    execute format('alter table public.job_invoices drop constraint %I', c.conname);
  end loop;
end $$;

-- 6 Same format as before (INV-<YY>-<job_number>-<seq>, seq per job). New: a per-job advisory lock so two invoices
-- created at the same moment can't get the same seq, and the seq skips any number this org already has.
create or replace function public.generate_invoice_number(p_job_id uuid)
returns text
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_job_number text;
  v_org uuid;
  v_prefix text;
  v_seq integer;
  v_number text;
begin
  perform pg_advisory_xact_lock(hashtextextended('job_invoices:' || p_job_id::text, 0));

  select job_number, org_id into v_job_number, v_org from production_jobs where id = p_job_id;

  v_prefix := 'INV-' || to_char(now(), 'YY') || '-' || v_job_number || '-';

  select count(*) + 1 into v_seq from job_invoices where job_id = p_job_id;

  loop
    v_number := v_prefix || lpad(v_seq::text, 3, '0');
    exit when not exists (select 1 from job_invoices where org_id = v_org and invoice_number = v_number);
    v_seq := v_seq + 1;
  end loop;

  return v_number;
end;
$$;

-- 7 Restrictive policies (field_role_money_deny, closer_own_deals) are untouched and still apply on top.
alter table public.job_invoices enable row level security;

drop policy if exists "Users can read invoices for their org jobs" on public.job_invoices;
create policy "Users can read invoices for their org jobs" on public.job_invoices
  for select using (org_id = get_user_org_id(auth.uid()));

drop policy if exists "Users can insert invoices for their org jobs" on public.job_invoices;
create policy "Users can insert invoices for their org jobs" on public.job_invoices
  for insert with check (org_id = get_user_org_id(auth.uid()));

-- Only draft invoices are editable (no silent edits to sent invoices), as before.
drop policy if exists "Users can update draft invoices for their org jobs" on public.job_invoices;
create policy "Users can update draft invoices for their org jobs" on public.job_invoices
  for update using (status = 'draft' and org_id = get_user_org_id(auth.uid()));

commit;
