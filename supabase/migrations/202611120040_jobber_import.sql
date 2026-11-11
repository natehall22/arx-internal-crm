-- Move from Jobber (Settings → Move from Jobber): upload Jobber CSV exports → check → import, re-runnable and undoable.
-- Additive / nullable only. NOT applied by the builder — apply by hand, BEFORE the code that reads it.
--
-- APPLY ORDER — REQUIRED: after 202611110010 (properties), 202611110020 (custom fields), 202611110030 (service plans),
-- 202611100040 + 202611110060 (invoices without a job; this file replaces record_customer_invoice_payment and the void
-- guard from 0060 with copies that also count money paid before the import). Listed in docs/domain-cutover.md.
--
-- 1. import_source / import_source_id on the rows an import creates (customers, properties, service_plans, job_invoices,
--    pricebook_items, custom_field_definitions): 'jobber' + Jobber's own id. Unique per company, so re-running an import
--    finds the row it made last time and updates it instead of making a second one.
-- 2. job_invoices.paid_outside_cents: money a customer already paid on an imported invoice BEFORE this system (Jobber's
--    total minus its balance). It is NOT a payment row — Jobber's exports carry no payment history we can trust (no
--    date, method or amount per payment), so none is ever made up. Balance = total − payments here − paid_outside_cents.
--    record_customer_invoice_payment and the void guard below count it. NULL on every invoice made here.
-- 3. import_runs / import_run_files / import_run_items: one run = one upload → check → import. Items are the plan (one
--    per thing to create or update, with the problems found), the progress (pending → done / failed / skipped) and the
--    undo record (target row + the values written + the values before, for rows that existed). Service role only.
-- 4. import_run_claim(): the next batch of pending items, in dependency order (fields → price book → customers →
--    properties → plans → invoices → history), SKIP LOCKED so two tabs pressing Import never write the same item twice.
--    An item left 'working' for 10 minutes (closed tab, crash) is claimable again — every write is idempotent.
-- 5. import_undo_row() / import_revert_row(): undo ONE row atomically — deleted only if every value the import wrote is
--    still there AND nothing outside the import points at it (any foreign key, found from the catalog, so a table added
--    later is covered); an updated row is put back only if it still holds exactly what the import wrote.
-- 6. property_address_keys(): THE same-address rule for a whole list in one call (Check screen).
--
-- Rollback (nothing else depends on it): drop the three functions + import_* tables; drop the import_source columns and
-- their unique indexes; drop paid_outside_cents after restoring record_customer_invoice_payment and
-- job_invoices_void_guard from 202611110060.

begin;
set local lock_timeout = '5s';

-- ---- 1. where a row came from -----------------------------------------------------------------------------------------
alter table public.customers                add column if not exists import_source text null, add column if not exists import_source_id text null;
alter table public.properties               add column if not exists import_source text null, add column if not exists import_source_id text null;
alter table public.service_plans            add column if not exists import_source text null, add column if not exists import_source_id text null;
alter table public.job_invoices             add column if not exists import_source text null, add column if not exists import_source_id text null;
alter table public.pricebook_items          add column if not exists import_source text null, add column if not exists import_source_id text null;
alter table public.custom_field_definitions add column if not exists import_source text null, add column if not exists import_source_id text null;

do $$
declare t text;
begin
  foreach t in array array['customers', 'properties', 'service_plans', 'job_invoices', 'pricebook_items', 'custom_field_definitions'] loop
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_import_source_check');
    execute format($c$alter table public.%I add constraint %I check (
      (import_source is null and import_source_id is null)
      or (import_source in ('jobber') and import_source_id is not null and char_length(import_source_id) between 1 and 200))$c$, t, t || '_import_source_check');
    execute format('create unique index if not exists %I on public.%I (org_id, import_source, import_source_id) where import_source_id is not null',
                   t || '_import_source_key', t);
  end loop;
end $$;

-- ---- 2. money paid before the import ----------------------------------------------------------------------------------
alter table public.job_invoices add column if not exists paid_outside_cents integer null;
do $$ begin
  alter table public.job_invoices add constraint job_invoices_paid_outside_check
    check (paid_outside_cents is null or (paid_outside_cents >= 0 and job_id is null and import_source is not null));
exception when duplicate_object then null; end $$;
comment on column public.job_invoices.paid_outside_cents is
  'Imported invoices only: paid before this system (Jobber total − Jobber balance). Not a payment row; never made up. Balance = total − invoice_payments − this.';

-- Copy of 202611110060's writer; the ONLY change is v_balance also subtracting paid_outside_cents.
create or replace function public.record_customer_invoice_payment(
  p_org uuid, p_invoice uuid, p_amount_cents integer, p_paid_at date, p_method text, p_note text, p_created_by uuid
) returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_inv public.job_invoices%rowtype;
  v_applied integer;
  v_balance integer;
  v_pay uuid;
  v_status invoice_status;
begin
  select * into v_inv from public.job_invoices where id = p_invoice and org_id = p_org for update;
  if not found or v_inv.job_id is not null then
    raise exception 'record_customer_invoice_payment: invoice not found' using errcode = 'P0002';
  end if;
  if v_inv.status = 'void' then
    raise exception 'This invoice is void' using errcode = '22023';
  end if;
  if v_inv.total_cents <= 0 then
    raise exception 'This invoice has nothing to pay' using errcode = '22023';
  end if;
  select coalesce(sum(applied_cents), 0) into v_applied from public.invoice_payments where invoice_id = p_invoice;
  v_balance := v_inv.total_cents - v_applied - coalesce(v_inv.paid_outside_cents, 0);
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'Enter an amount above zero' using errcode = '22023';
  end if;
  if p_amount_cents > v_balance then
    raise exception 'That is more than the balance due' using errcode = '22023';
  end if;
  if v_inv.status = 'draft' then
    update public.job_invoices
       set status = 'sent', issued_at = coalesce(issued_at, current_date), due_at = coalesce(due_at, current_date)
     where id = p_invoice;
  end if;
  insert into public.job_payments (job_id, org_id, customer_id, paid_at, amount_cents, payment_type, method, payer, note, created_by)
  values (null, p_org, v_inv.customer_id, p_paid_at, p_amount_cents, 'other', p_method, 'other', nullif(btrim(p_note), ''), p_created_by)
  returning id into v_pay;
  insert into public.invoice_payments (invoice_id, job_payment_id, applied_cents, created_by)
  values (p_invoice, v_pay, p_amount_cents, p_created_by);
  v_balance := v_balance - p_amount_cents;
  v_status := case when v_balance <= 0 then 'paid'::invoice_status else 'partially_paid'::invoice_status end;
  update public.job_invoices set status = v_status where id = p_invoice;
  return jsonb_build_object('payment_id', v_pay, 'status', v_status, 'balance_cents', v_balance);
end;
$$;
revoke all on function public.record_customer_invoice_payment(uuid, uuid, integer, date, text, text, uuid) from public, anon, authenticated;
grant execute on function public.record_customer_invoice_payment(uuid, uuid, integer, date, text, text, uuid) to service_role;

-- Copy of 202611110060's guard; money paid before the import counts as a payment on the invoice too.
create or replace function public.job_invoices_void_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status = 'void' and old.status is distinct from 'void' and old.job_id is null
     and (coalesce(old.paid_outside_cents, 0) > 0
          or exists (select 1 from public.invoice_payments ip where ip.invoice_id = old.id)) then
    raise exception 'This invoice has a payment on it, so it can''t be voided' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- ---- 3. runs, files, items ---------------------------------------------------------------------------------------------
create table if not exists public.import_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  source text not null default 'jobber' check (source in ('jobber')),
  -- draft: files being added / checked. importing: Import pressed, items pending. done: nothing pending.
  -- undoing → undone: "Undo this import" pressed / finished. discarded: a draft thrown away.
  status text not null default 'draft' check (status in ('draft', 'importing', 'done', 'undoing', 'undone', 'discarded')),
  -- Column choices for headers we don't know + options (date order, trade for plans, skip archived …).
  mapping jsonb not null default '{}'::jsonb check (jsonb_typeof(mapping) = 'object'),
  options jsonb not null default '{}'::jsonb check (jsonb_typeof(options) = 'object'),
  -- What the last check found (counts, duplicates, problems) — what the Check screen shows.
  summary jsonb null,
  checked_at timestamptz null,
  started_at timestamptz null,
  finished_at timestamptz null,
  undo_started_at timestamptz null,
  undone_at timestamptz null,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists import_runs_org_idx on public.import_runs (org_id, created_at desc);
-- One run in flight per company: two half-checked uploads would each plan against the other's missing rows.
create unique index if not exists import_runs_one_open on public.import_runs (org_id) where status in ('draft', 'importing', 'undoing');

create table if not exists public.import_run_files (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  run_id uuid not null references public.import_runs(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 255),
  -- clients | properties | quotes | jobs | visits | invoices | products (lib/jobber-import/columns.ts)
  kind text not null check (char_length(kind) between 1 and 40),
  headers jsonb not null check (jsonb_typeof(headers) = 'array'),
  rows jsonb not null check (jsonb_typeof(rows) = 'array'),
  row_count integer not null default 0,
  sha256 text not null,
  created_at timestamptz not null default now()
);
create index if not exists import_run_files_run_idx on public.import_run_files (run_id);
-- The same file added twice to one run is one file (Jobber's split client exports each have their own content).
create unique index if not exists import_run_files_same_file on public.import_run_files (run_id, sha256);

create table if not exists public.import_run_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  run_id uuid not null references public.import_runs(id) on delete cascade,
  -- custom_field | price_item | customer | property | plan | invoice | history | document
  kind text not null check (kind in ('custom_field', 'price_item', 'customer', 'property', 'plan', 'invoice', 'history', 'document')),
  rank smallint not null,                    -- dependency order (claim takes the lowest pending rank first)
  seq integer not null,                      -- order inside a kind (file row order)
  source_id text not null,                   -- Jobber's id (or our stable key for things Jobber gives no id)
  label text not null default '',            -- what a person reads in lists ("Jane Smith", "Invoice #1042")
  -- create | update (row from an earlier import) | link (an existing row matched, blanks filled) | skip
  action text not null check (action in ('create', 'update', 'link', 'skip')),
  status text not null default 'pending' check (status in ('pending', 'working', 'done', 'failed', 'skipped', 'undone', 'kept')),
  payload jsonb not null default '{}'::jsonb,
  problems jsonb not null default '[]'::jsonb check (jsonb_typeof(problems) = 'array'),
  target_table text null,
  target_id uuid null,
  applied jsonb null,                        -- the values this import wrote (undo compares them)
  before jsonb null,                         -- link/update: the values that were there (undo puts them back)
  error text null,
  claimed_at timestamptz null,
  done_at timestamptz null,
  undo_note text null,
  created_at timestamptz not null default now()
);
create index if not exists import_run_items_run_idx on public.import_run_items (run_id, status, rank, seq);
create index if not exists import_run_items_target_idx on public.import_run_items (org_id, target_table, target_id) where target_id is not null;
create unique index if not exists import_run_items_one_per_source on public.import_run_items (run_id, kind, source_id);

alter table public.import_runs enable row level security;
alter table public.import_run_files enable row level security;
alter table public.import_run_items enable row level security;
revoke all on public.import_runs, public.import_run_files, public.import_run_items from anon, authenticated;

-- ---- 4. claim a batch ------------------------------------------------------------------------------------------------
create or replace function public.import_run_claim(p_org uuid, p_run uuid, p_limit integer)
returns setof public.import_run_items
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_rank smallint;
begin
  -- The lowest rank that still has work: customers are all done before any property is written, and so on.
  select min(rank) into v_rank from public.import_run_items
   where org_id = p_org and run_id = p_run
     and (status = 'pending' or (status = 'working' and claimed_at < now() - interval '10 minutes'));
  if v_rank is null then return; end if;
  -- A lower rank still being written by another call: wait for it (return nothing; the caller asks again).
  if exists (select 1 from public.import_run_items
              where org_id = p_org and run_id = p_run and status = 'working' and rank < v_rank
                and claimed_at >= now() - interval '10 minutes') then
    return;
  end if;
  return query
  update public.import_run_items i set status = 'working', claimed_at = now()
   where i.id in (
     select x.id from public.import_run_items x
      where x.org_id = p_org and x.run_id = p_run and x.rank = v_rank
        and (x.status = 'pending' or (x.status = 'working' and x.claimed_at < now() - interval '10 minutes'))
      order by x.seq
      limit greatest(1, least(coalesce(p_limit, 50), 500))
      for update skip locked)
  returning i.*;
end;
$$;

-- ---- 5. undo one row -------------------------------------------------------------------------------------------------
-- Tables an import writes. Anything else is refused (these functions take a table NAME from the app).
create or replace function public.import_undo_table_ok(p_table text) returns boolean
language sql immutable as $$
  select p_table in ('customers', 'properties', 'service_plans', 'job_invoices', 'pricebook_items', 'custom_field_definitions', 'documents')
$$;

-- 'gone' | 'changed' (a value the import wrote is no longer there) | 'in_use' (something else points at it) | 'deleted'.
-- p_ignore = child tables the import itself filled for this row and that go with it (job_invoice_items for an invoice).
-- documents are never deleted: deleted_at is set (the app's own delete), the stored file stays.
create or replace function public.import_undo_row(p_org uuid, p_table text, p_id uuid, p_applied jsonb, p_ignore text[] default '{}')
returns text
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_row jsonb;
  v_key text;
  v_fk record;
  v_used boolean;
begin
  if not public.import_undo_table_ok(p_table) then raise exception 'import_undo_row: table % not allowed', p_table using errcode = '42501'; end if;
  execute format('select to_jsonb(t) from public.%I t where id = $1 and org_id = $2 for update', p_table) into v_row using p_id, p_org;
  if v_row is null then return 'gone'; end if;
  if p_table = 'documents' and v_row->>'deleted_at' is not null then return 'gone'; end if;
  for v_key in select jsonb_object_keys(coalesce(p_applied, '{}'::jsonb)) loop
    if (v_row->v_key) is distinct from (p_applied->v_key) then return 'changed'; end if;
  end loop;

  if p_table = 'custom_field_definitions' then
    -- Values live in jsonb (no foreign key): any record still holding one keeps the field.
    if exists (select 1 from public.customers c where c.org_id = p_org and c.custom_fields ? p_id::text)
       or exists (select 1 from public.properties p where p.org_id = p_org and p.custom_fields ? p_id::text)
       or exists (select 1 from public.production_jobs j where j.org_id = p_org and j.custom_fields ? p_id::text) then
      return 'in_use';
    end if;
  else
    -- Every foreign key that points at this table, read from the catalog (single-column keys on id).
    for v_fk in
      select c.conrelid::regclass as rel, a.attname as col, cl.relname as relname
        from pg_constraint c
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
        join pg_class cl on cl.oid = c.conrelid
       where c.contype = 'f' and c.confrelid = format('public.%I', p_table)::regclass and array_length(c.conkey, 1) = 1
    loop
      if v_fk.relname = any (coalesce(p_ignore, '{}')) then continue; end if;
      if v_fk.relname = p_table then continue; end if;   -- self references (none today)
      execute format('select exists (select 1 from %s where %I = $1)', v_fk.rel, v_fk.col) into v_used using p_id;
      if v_used then return 'in_use'; end if;
    end loop;
  end if;

  if p_table = 'documents' then
    update public.documents set deleted_at = now() where id = p_id and org_id = p_org;
  else
    execute format('delete from public.%I where id = $1 and org_id = $2', p_table) using p_id, p_org;
  end if;
  return 'deleted';
end;
$$;

-- 'gone' | 'changed' | 'reverted'. Puts p_before back on a row the import updated, only if it still holds p_applied.
create or replace function public.import_revert_row(p_org uuid, p_table text, p_id uuid, p_applied jsonb, p_before jsonb)
returns text
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_row jsonb;
  v_key text;
  v_cols text;
begin
  if not public.import_undo_table_ok(p_table) or p_table = 'documents' then
    raise exception 'import_revert_row: table % not allowed', p_table using errcode = '42501';
  end if;
  if p_before is null or p_before = '{}'::jsonb then return 'reverted'; end if;
  execute format('select to_jsonb(t) from public.%I t where id = $1 and org_id = $2 for update', p_table) into v_row using p_id, p_org;
  if v_row is null then return 'gone'; end if;
  for v_key in select jsonb_object_keys(coalesce(p_applied, '{}'::jsonb)) loop
    if (v_row->v_key) is distinct from (p_applied->v_key) then return 'changed'; end if;
  end loop;
  -- Only keys the import wrote may be put back, never org_id / id.
  select string_agg(format('%I = r.%I', k, k), ', ') into v_cols
    from jsonb_object_keys(p_before) k
   where k not in ('id', 'org_id') and p_applied ? k;
  if v_cols is null then return 'reverted'; end if;
  execute format('update public.%I t set %s from jsonb_populate_record(null::public.%I, $1) r where t.id = $2 and t.org_id = $3',
                 p_table, v_cols, p_table) using p_before, p_id, p_org;
  return 'reverted';
end;
$$;

-- ---- 6. "same address" for a list, in one call ----------------------------------------------------------------------
-- The Check screen compares hundreds of Jobber addresses with properties on file: it asks THE rule
-- (property_address_key, migration 202611110010) for all of them at once instead of copying it into TypeScript.
create or replace function public.property_address_keys(p text[]) returns text[]
language sql immutable parallel safe as $$
  select coalesce(array_agg(public.property_address_key(a) order by i), '{}') from unnest(p) with ordinality as t(a, i)
$$;

revoke all on function public.property_address_keys(text[]) from public, anon, authenticated;
grant execute on function public.property_address_keys(text[]) to service_role;
revoke all on function public.import_run_claim(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.import_undo_row(uuid, text, uuid, jsonb, text[]) from public, anon, authenticated;
revoke all on function public.import_revert_row(uuid, text, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.import_undo_table_ok(text) from public, anon, authenticated;
grant execute on function public.import_run_claim(uuid, uuid, integer) to service_role;
grant execute on function public.import_undo_row(uuid, text, uuid, jsonb, text[]) to service_role;
grant execute on function public.import_revert_row(uuid, text, uuid, jsonb, jsonb) to service_role;

commit;
