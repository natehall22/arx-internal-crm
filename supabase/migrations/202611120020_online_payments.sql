-- Online payments through Stripe Connect (feature switch `onlinePayments`, default OFF). docs/online-payments.md.
-- Each company connects ITS OWN Stripe account (direct charges: the money and the Stripe fees are the company's).
-- Card data never touches the CRM: Stripe-hosted Checkout collects it; we keep Stripe ids + brand/last4 only.
--
-- ORDER: after 202611110060 (customer invoices: job_payments.org_id/customer_id, record_customer_invoice_payment) and
-- 122_job_payments_idempotency. Additive/nullable except two RELAXED checks: invoice_payments.applied_cents may be
-- negative (a refund taken back off an invoice) and the no-job void guard counts the NET paid (a fully refunded
-- invoice can be voided). Nothing existing writes a negative application, so current behaviour is unchanged.
--
-- New tables are service-role only (RLS on, no policies, no grants to anon/authenticated).
--
-- Down (manual): drop table stripe_webhook_events, online_payments, customer_payment_methods, stripe_customers,
--   payment_links, payment_accounts; drop function record_customer_invoice_refund(uuid, uuid, integer, date, text, text, text, integer);
--   drop functions record_job_payment, apply_job_invoice_payment, payment_link_take_attempt;
--   drop function record_customer_invoice_payment(uuid, uuid, integer, date, text, text, uuid, text) and restore the 7-arg
--   version from 202611110060; drop index job_payments_org_idempotency_key; restore the 053 check (applied_cents > 0)
--   only if no negative rows exist; restore job_invoices_void_guard from 202611110060.

begin;
set local lock_timeout = '5s';

-- ---- 1. The company's connected Stripe account ------------------------------------------------------------------------
-- One live row per company; rows are never deleted (a disconnected account still resolves refunds/webhooks to its company).
create table if not exists public.payment_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  provider text not null default 'stripe' check (provider = 'stripe'),
  account_id text not null unique,
  livemode boolean not null default false,
  status text not null default 'onboarding' check (status in ('onboarding', 'active', 'restricted', 'disconnected')),
  charges_enabled boolean not null default false,
  payouts_enabled boolean not null default false,
  details_submitted boolean not null default false,
  connected_by uuid null references public.users(id) on delete set null,
  disconnected_at timestamptz null,
  disconnected_by uuid null references public.users(id) on delete set null,
  disconnect_reason text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists payment_accounts_one_live_per_org on public.payment_accounts (org_id) where status <> 'disconnected';

-- ---- 2. Customer links (pay an invoice / save a card) ---------------------------------------------------------------
-- Only the SHA-256 of the token is stored; the link is shown once (copy / email) and a new one can always be made.
create table if not exists public.payment_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  kind text not null check (kind in ('invoice', 'save_card')),
  token_hash text not null unique,
  invoice_id uuid null references public.job_invoices(id) on delete cascade,
  customer_id uuid null references public.customers(id) on delete cascade,
  created_by uuid null references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz null,
  last_opened_at timestamptz null,
  constraint payment_links_target check ((kind = 'invoice' and invoice_id is not null) or (kind = 'save_card' and customer_id is not null))
);
create index if not exists payment_links_invoice_idx on public.payment_links (invoice_id) where invoice_id is not null;

-- ---- 3. Stripe customers on the company's account (one per CRM customer per connected account) -----------------------
create table if not exists public.stripe_customers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  account_id text not null,
  customer_id uuid not null references public.customers(id) on delete cascade,
  stripe_customer_id text not null,
  created_at timestamptz not null default now(),
  constraint stripe_customers_one unique (account_id, customer_id)
);

-- ---- 4. Card on file (+ autopay consent). Brand / last 4 / expiry only — never card data. -----------------------------
create table if not exists public.customer_payment_methods (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  account_id text not null,
  stripe_customer_id text not null,
  payment_method_id text not null,
  brand text null,
  last4 text null,
  exp_month integer null,
  exp_year integer null,
  autopay boolean not null default false,
  consent_at timestamptz null,
  consent_text text null,
  created_at timestamptz not null default now(),
  removed_at timestamptz null,
  removed_by uuid null references public.users(id) on delete set null
);
create unique index if not exists customer_payment_methods_one_live on public.customer_payment_methods (customer_id) where removed_at is null;

-- ---- 5. Every online payment attempt (the processor side; job_payments stays the money ledger) ------------------------
create table if not exists public.online_payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  account_id text not null,
  livemode boolean not null default false,
  kind text not null check (kind in ('checkout', 'autopay')),
  invoice_id uuid not null references public.job_invoices(id) on delete restrict,
  customer_id uuid null references public.customers(id) on delete set null,
  link_id uuid null references public.payment_links(id) on delete set null,
  checkout_session_id text null unique,
  payment_intent_id text null unique,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'usd',
  application_fee_cents integer not null default 0 check (application_fee_cents >= 0),
  status text not null default 'open'
    check (status in ('open', 'processing', 'succeeded', 'failed', 'expired', 'needs_review')),
  method text null check (method in ('card', 'ach')),
  card_brand text null,
  card_last4 text null,
  job_payment_id uuid null references public.job_payments(id) on delete restrict,
  refunded_cents integer not null default 0 check (refunded_cents >= 0),
  failure_code text null,
  failure_message text null,
  review_reason text null,
  attempt integer not null default 1 check (attempt >= 1),
  next_retry_at timestamptz null,
  recording_at timestamptz null,
  succeeded_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists online_payments_invoice_idx on public.online_payments (invoice_id);
create index if not exists online_payments_retry_idx on public.online_payments (org_id, next_retry_at) where next_retry_at is not null;
-- One autopay charge per invoice per attempt: a double "send" can never charge twice.
create unique index if not exists online_payments_autopay_attempt on public.online_payments (invoice_id, attempt) where kind = 'autopay';

-- ---- 6. Webhook events seen (idempotency by Stripe event id + audit) -------------------------------------------------
create table if not exists public.stripe_webhook_events (
  event_id text primary key,
  type text not null,
  account_id text null,
  org_id uuid null references public.orgs(id) on delete set null,
  livemode boolean not null default false,
  status text not null default 'processing' check (status in ('processing', 'done', 'ignored', 'failed')),
  error text null,
  attempts integer not null default 1,
  received_at timestamptz not null default now(),
  processed_at timestamptz null
);

do $$
declare t text;
begin
  foreach t in array array['payment_accounts', 'payment_links', 'stripe_customers', 'customer_payment_methods', 'online_payments', 'stripe_webhook_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- ---- 7. Refunds come back off the invoice they paid -----------------------------------------------------------------
-- A refund is a NEGATIVE job_payments row (append-only, never a delete) plus a NEGATIVE application on the invoice, so
-- the invoice balance re-opens by exactly the refund. Zero is still refused.
alter table public.invoice_payments drop constraint if exists invoice_payments_applied_cents_check;
do $$ begin
  alter table public.invoice_payments add constraint invoice_payments_applied_cents_nonzero check (applied_cents <> 0);
exception when duplicate_object then null; end $$;

-- A no-job invoice can't be voided while money is on it — NET of refunds (a fully refunded invoice can be voided).
create or replace function public.job_invoices_void_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status = 'void' and old.status is distinct from 'void' and old.job_id is null
     and coalesce((select sum(ip.applied_cents) from public.invoice_payments ip where ip.invoice_id = old.id), 0) > 0 then
    raise exception 'This invoice has a payment on it, so it can''t be voided' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- Payments without a job: retries of the same processor payment are one row (jobs already have (job_id, key) unique, 122).
create unique index if not exists job_payments_org_idempotency_key
  on public.job_payments (org_id, idempotency_key) where job_id is null and idempotency_key is not null;

-- ---- 8. THE no-job payment writer gains an idempotency key (the card processor's payment id) --------------------------
-- Same rules as 202611110060; with a key that was already recorded in this company it returns that payment (no new row).
drop function if exists public.record_customer_invoice_payment(uuid, uuid, integer, date, text, text, uuid);
create or replace function public.record_customer_invoice_payment(
  p_org uuid, p_invoice uuid, p_amount_cents integer, p_paid_at date, p_method text, p_note text, p_created_by uuid,
  p_idempotency_key text default null
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
  select coalesce(sum(applied_cents), 0) into v_applied from public.invoice_payments where invoice_id = p_invoice;
  v_balance := v_inv.total_cents - v_applied;
  if p_idempotency_key is not null then
    select id into v_pay from public.job_payments
     where org_id = p_org and job_id is null and idempotency_key = p_idempotency_key;
    if found then
      return jsonb_build_object('payment_id', v_pay, 'status', v_inv.status, 'balance_cents', v_balance, 'duplicate', true);
    end if;
  end if;
  if v_inv.status = 'void' then
    raise exception 'This invoice is void' using errcode = '22023';
  end if;
  if v_inv.total_cents <= 0 then
    raise exception 'This invoice has nothing to pay' using errcode = '22023';
  end if;
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
  insert into public.job_payments (job_id, org_id, customer_id, paid_at, amount_cents, payment_type, method, payer, note, created_by, idempotency_key)
  values (null, p_org, v_inv.customer_id, p_paid_at, p_amount_cents, 'other', p_method, 'other', nullif(btrim(p_note), ''), p_created_by, p_idempotency_key)
  returning id into v_pay;
  insert into public.invoice_payments (invoice_id, job_payment_id, applied_cents, created_by)
  values (p_invoice, v_pay, p_amount_cents, p_created_by);
  v_balance := v_balance - p_amount_cents;
  v_status := case when v_balance <= 0 then 'paid'::invoice_status else 'partially_paid'::invoice_status end;
  update public.job_invoices set status = v_status where id = p_invoice;
  return jsonb_build_object('payment_id', v_pay, 'status', v_status, 'balance_cents', v_balance, 'duplicate', false);
end;
$$;
revoke all on function public.record_customer_invoice_payment(uuid, uuid, integer, date, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.record_customer_invoice_payment(uuid, uuid, integer, date, text, text, uuid, text) to service_role;

-- ---- 9. Refund on an invoice without a job: negative payment + negative application, one transaction ----------------
-- Never more than the NET paid on the invoice. Idempotent by key (the processor's refund id). Status: paid → partly
-- paid → sent as the net paid goes down (a void invoice stays void; money still left it, so the rows are written).
drop function if exists public.record_customer_invoice_refund(uuid, uuid, integer, date, text, text, text);
create or replace function public.record_customer_invoice_refund(
  p_org uuid, p_invoice uuid, p_amount_cents integer, p_paid_at date, p_method text, p_note text, p_idempotency_key text,
  p_unapply_cents integer default null
) returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_inv public.job_invoices%rowtype;
  v_applied integer;
  v_pay uuid;
  v_status invoice_status;
  v_unapply integer;
begin
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'A refund needs its processor id' using errcode = '22023';
  end if;
  select * into v_inv from public.job_invoices where id = p_invoice and org_id = p_org for update;
  if not found or v_inv.job_id is not null then
    raise exception 'record_customer_invoice_refund: invoice not found' using errcode = 'P0002';
  end if;
  select id into v_pay from public.job_payments
   where org_id = p_org and job_id is null and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('payment_id', v_pay, 'status', v_inv.status, 'duplicate', true);
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'A refund must be above zero' using errcode = '22023';
  end if;
  -- How much of the refund comes back off the invoice (the app works it out per payment: an overpayment's refund takes
  -- nothing back). Default = all of it. Never more than the refund, never more than the net paid on the invoice.
  v_unapply := coalesce(p_unapply_cents, p_amount_cents);
  select coalesce(sum(applied_cents), 0) into v_applied from public.invoice_payments where invoice_id = p_invoice;
  if v_unapply < 0 or v_unapply > p_amount_cents or v_unapply > v_applied then
    raise exception 'That is more than was paid on this invoice' using errcode = '22023';
  end if;
  insert into public.job_payments (job_id, org_id, customer_id, paid_at, amount_cents, payment_type, method, payer, note, created_by, idempotency_key)
  values (null, p_org, v_inv.customer_id, p_paid_at, -p_amount_cents, 'other', p_method, 'other', nullif(btrim(p_note), ''), null, p_idempotency_key)
  returning id into v_pay;
  if v_unapply > 0 then
    insert into public.invoice_payments (invoice_id, job_payment_id, applied_cents, created_by)
    values (p_invoice, v_pay, -v_unapply, null);
  end if;
  v_applied := v_applied - v_unapply;
  if v_inv.status <> 'void' then
    v_status := case
      when v_applied >= v_inv.total_cents then 'paid'::invoice_status
      when v_applied > 0 then 'partially_paid'::invoice_status
      else 'sent'::invoice_status end;
    update public.job_invoices set status = v_status where id = p_invoice;
  else
    v_status := 'void'::invoice_status;
  end if;
  return jsonb_build_object('payment_id', v_pay, 'status', v_status, 'duplicate', false);
end;
$$;
revoke all on function public.record_customer_invoice_refund(uuid, uuid, integer, date, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.record_customer_invoice_refund(uuid, uuid, integer, date, text, text, text, integer) to service_role;


-- ---- 10. Disputes, link attempt limit -----------------------------------------------------------------------------
alter table public.online_payments add column if not exists disputed_cents integer not null default 0;
-- A lost dispute on a job already collected / in an approved payroll week: shown on Today + the morning email to review commission.
alter table public.online_payments add column if not exists reversal_flag text null, add column if not exists reversed_at timestamptz null;
create index if not exists online_payments_reversal_idx on public.online_payments (org_id, reversed_at) where reversal_flag is not null;
do $$ begin
  alter table public.online_payments add constraint online_payments_disputed_nonneg check (disputed_cents >= 0);
exception when duplicate_object then null; end $$;
alter table public.payment_links
  add column if not exists attempt_window_start timestamptz null,
  add column if not exists attempt_count integer not null default 0;

-- One atomic "may this link start another payment page?" across every server instance (rate limit per link).
create or replace function public.payment_link_take_attempt(p_link uuid, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
set search_path = public, pg_temp
as $$
declare v integer;
begin
  update public.payment_links
     set attempt_count = case when attempt_window_start is null or attempt_window_start < now() - make_interval(secs => p_window_seconds) then 1 else attempt_count + 1 end,
         attempt_window_start = case when attempt_window_start is null or attempt_window_start < now() - make_interval(secs => p_window_seconds) then now() else attempt_window_start end
   where id = p_link
  returning attempt_count into v;
  return found and v <= p_limit;
end;
$$;
revoke all on function public.payment_link_take_attempt(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.payment_link_take_attempt(uuid, integer, integer) to service_role;

-- ---- 11. THE job payment writer: payment + QuickBooks outbox in ONE transaction -----------------------------------
-- Idempotent by key (per job); a repeat returns the first payment and (re)queues its outbox row if it is missing.
-- Event types: payment.recorded (money in), payment.refunded, payment.disputed (money out, negative amounts).
-- Outbox key/payload match lib/integrations.ts (`<org>:job_payments:<id>:<event>:v1`, payload.payment + _meta).
create or replace function public.record_job_payment(
  p_org uuid, p_job uuid, p_paid_at date, p_amount_cents integer, p_payment_type text, p_method text, p_payer text,
  p_note text, p_created_by uuid, p_idempotency_key text default null, p_event_type text default 'payment.recorded'
) returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_job public.production_jobs%rowtype;
  v_pay public.job_payments%rowtype;
  v_dup boolean := false;
  v_key text;
begin
  if p_event_type not in ('payment.recorded', 'payment.refunded', 'payment.disputed') then
    raise exception 'record_job_payment: unknown event %', p_event_type using errcode = '22023';
  end if;
  if p_amount_cents is null or p_amount_cents = 0 then
    raise exception 'Enter an amount' using errcode = '22023';
  end if;
  select * into v_job from public.production_jobs where id = p_job and org_id = p_org;
  if not found then
    raise exception 'record_job_payment: job not found' using errcode = 'P0002';
  end if;
  if p_idempotency_key is not null then
    perform pg_advisory_xact_lock(hashtextextended('job_payments:key:' || p_job::text || ':' || p_idempotency_key, 0));
    select * into v_pay from public.job_payments where job_id = p_job and idempotency_key = p_idempotency_key;
    v_dup := found;
  end if;
  if not v_dup then
    insert into public.job_payments (job_id, paid_at, amount_cents, payment_type, method, payer, note, created_by, idempotency_key)
    values (p_job, p_paid_at, p_amount_cents, p_payment_type, p_method, p_payer, nullif(btrim(p_note), ''), p_created_by, p_idempotency_key)
    returning * into v_pay;
  end if;
  v_key := p_org::text || ':job_payments:' || v_pay.id::text || ':' || p_event_type || ':v1';
  insert into public.integration_outbox (org_id, provider, event_type, entity_table, entity_id, idempotency_key, payload, status)
  values (p_org, 'quickbooks', p_event_type, 'job_payments', v_pay.id, v_key,
    jsonb_build_object(
      'payment', jsonb_build_object('id', v_pay.id, 'job_id', p_job, 'customer_id', v_job.customer_id, 'amount_cents', v_pay.amount_cents,
        'paid_at', v_pay.paid_at, 'payment_type', v_pay.payment_type, 'method', v_pay.method, 'payer', v_pay.payer),
      '_meta', jsonb_build_object('idempotency_key', v_key, 'event_type', p_event_type, 'entity_table', 'job_payments',
        'entity_id', v_pay.id, 'version', 1, 'enqueued_at', now())),
    'pending')
  on conflict (idempotency_key) do nothing;
  return jsonb_build_object('payment', to_jsonb(v_pay), 'duplicate', v_dup);
end;
$$;
revoke all on function public.record_job_payment(uuid, uuid, date, integer, text, text, text, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.record_job_payment(uuid, uuid, date, integer, text, text, text, text, uuid, text, text) to service_role;

-- ---- 12. Put a job payment (or take a refund back) on a job invoice — invoice row locked ---------------------------
-- Positive: issued, not void, never more than the payment has left NOR the invoice balance. Negative (a refund / lost
-- dispute payment): never more than the refund itself nor the invoice's net paid. Once per (invoice, payment).
create or replace function public.apply_job_invoice_payment(
  p_org uuid, p_invoice uuid, p_payment uuid, p_applied_cents integer, p_created_by uuid
) returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_inv public.job_invoices%rowtype;
  v_pay public.job_payments%rowtype;
  v_net integer;
  v_pay_applied integer;
  v_status invoice_status;
begin
  select ji.* into v_inv from public.job_invoices ji join public.production_jobs pj on pj.id = ji.job_id
   where ji.id = p_invoice and pj.org_id = p_org for update of ji;
  if not found then
    raise exception 'Invoice not found' using errcode = 'P0002';
  end if;
  select * into v_pay from public.job_payments where id = p_payment and job_id = v_inv.job_id;
  if not found then
    raise exception 'Payment not found' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.invoice_payments where invoice_id = p_invoice and job_payment_id = p_payment) then
    return jsonb_build_object('applied_cents', 0, 'status', v_inv.status, 'duplicate', true);
  end if;
  if p_applied_cents is null or p_applied_cents = 0 then
    raise exception 'Applied amount must not be zero' using errcode = '22023';
  end if;
  select coalesce(sum(applied_cents), 0) into v_net from public.invoice_payments where invoice_id = p_invoice;
  if p_applied_cents > 0 then
    if v_inv.status = 'void' then raise exception 'Cannot apply payment to voided invoice' using errcode = '22023'; end if;
    if v_inv.status = 'draft' then raise exception 'Cannot apply payment to draft invoice. Send it first.' using errcode = '22023'; end if;
    select coalesce(sum(applied_cents), 0) into v_pay_applied from public.invoice_payments where job_payment_id = p_payment;
    if v_pay.amount_cents <= 0 or p_applied_cents > v_pay.amount_cents - v_pay_applied then
      raise exception 'Cannot apply % cents. Only % cents remaining from this payment.', p_applied_cents, greatest(v_pay.amount_cents - v_pay_applied, 0) using errcode = '22023';
    end if;
    if p_applied_cents > v_inv.total_cents - v_net then
      raise exception 'That is more than the invoice balance (% cents)', greatest(v_inv.total_cents - v_net, 0) using errcode = '22023';
    end if;
  else
    if v_pay.amount_cents >= 0 or -p_applied_cents > -v_pay.amount_cents then
      raise exception 'Only a refund can be taken back off an invoice, and only up to its amount' using errcode = '22023';
    end if;
    if -p_applied_cents > v_net then
      raise exception 'That is more than was paid on this invoice' using errcode = '22023';
    end if;
  end if;
  insert into public.invoice_payments (invoice_id, job_payment_id, applied_cents, created_by)
  values (p_invoice, p_payment, p_applied_cents, p_created_by);
  v_net := v_net + p_applied_cents;
  if v_inv.status = 'void' then
    v_status := 'void';
  else
    v_status := case when v_net >= v_inv.total_cents then 'paid'::invoice_status
                     when v_net > 0 then 'partially_paid'::invoice_status
                     else 'sent'::invoice_status end;
    update public.job_invoices set status = v_status where id = p_invoice and status is distinct from v_status;
  end if;
  return jsonb_build_object('applied_cents', p_applied_cents, 'status', v_status, 'duplicate', false);
end;
$$;
revoke all on function public.apply_job_invoice_payment(uuid, uuid, uuid, integer, uuid) from public, anon, authenticated;
grant execute on function public.apply_job_invoice_payment(uuid, uuid, uuid, integer, uuid) to service_role;

comment on table public.online_payments is 'Online (Stripe) payment attempts. The money itself is job_payments (job_payment_id); see docs/online-payments.md.';
comment on table public.customer_payment_methods is 'Card on file for autopay: Stripe ids + brand/last4/expiry only. Never card numbers.';

commit;
