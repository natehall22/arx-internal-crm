-- Two-way texting (switch `texting`, default OFF). NOT applied by the builder. Apply AFTER 202611120050 (customer_messages)
-- and 202611120060 (customer portal: the activities audience / origin checks this widens). Additive: no existing column or
-- row changes meaning; the original company is unchanged unless the switch is turned on.
--
-- One text = one `customer_messages` row (channel 'sms'): the same log, claim, daily cap and idempotency key as email.
-- New here: the company's number (org_sms), per-phone consent proof (customer_sms_consent, append-only), inbound texts
-- (sms_inbound: dedupe + the "couldn't match" list) and per-message usage for billing (sms_usage).
-- Opt-outs are NOT a new table: customer_message_suppressions (channel 'sms', address = E.164) is the one opt-out store.
--
-- Everything is service-role only (RLS on, no policies): the browser never reads these tables.
--
-- Down (manual, only while the switch is off everywhere): drop table sms_usage, sms_inbound, customer_sms_consent, org_sms;
--   alter table customer_messages drop column delivery_status, drop column delivered_at, drop column provider_error,
--   drop column provider_message_id, drop column segments; restore customer_messages_kind_check and activities_origin_check
--   from 202611120050 / 202611120060 (no rows of kind staff_reply / sms_compliance or origin 'sms' may exist then).

begin;
set local lock_timeout = '5s';

-- ---- 1. The company's number + its registration ------------------------------------------------------------------------
create table if not exists public.org_sms (
  org_id uuid primary key references public.orgs(id) on delete cascade,
  provider text not null default 'telnyx' check (provider in ('telnyx', 'twilio', 'test')),
  -- The company's own local 10-digit number (E.164). Unique across companies: it is how an inbound text finds its company.
  e164 text null check (e164 is null or e164 ~ '^\+1[2-9][0-9]{9}$'),
  number_kind text not null default 'local' check (number_kind in ('local', 'toll_free', 'hosted')),
  -- 'manual' = registered by hand in the carrier's portal and entered by the owner; 'provider' = ordered through the wizard (later).
  number_source text not null default 'manual' check (number_source in ('manual', 'provider')),
  provider_number_id text null,
  brand_id text null,
  campaign_id text null,
  status text not null default 'not_started' check (status in ('not_started', 'details_saved', 'brand_pending', 'campaign_pending', 'number_pending', 'active', 'rejected')),
  rejection_reason text null,
  -- Most texts this company may send in one day (a runaway guard, not a quota).
  daily_cap integer not null default 300 check (daily_cap between 1 and 5000),
  -- The business details a carrier registration needs (legal name, EIN, website, contact, sample messages …); validated in the app.
  registration jsonb not null default '{}'::jsonb,
  submitted_at timestamptz null,
  approved_at timestamptz null,
  updated_by uuid null references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists org_sms_e164_idx on public.org_sms (e164) where e164 is not null;
alter table public.org_sms enable row level security;
revoke all on public.org_sms from anon, authenticated;

-- ---- 2. Consent proof (append-only; the latest row for a phone wins) ---------------------------------------------------
create table if not exists public.customer_sms_consent (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  customer_id uuid null references public.customers(id) on delete set null,
  phone_e164 text not null check (phone_e164 ~ '^\+1[2-9][0-9]{9}$'),
  status text not null check (status in ('granted', 'revoked')),
  source text not null check (source in ('staff_phone', 'staff_in_person', 'portal', 'signing', 'quote_form', 'web_form', 'sms_start', 'sms_stop', 'import')),
  -- The exact words the person agreed to, and which version of our wording that was.
  wording_version text null,
  wording_text text null,
  -- Who and how: { ip, user_agent, note, inbound_id, … }.
  evidence jsonb not null default '{}'::jsonb,
  created_by uuid null references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists customer_sms_consent_phone_idx on public.customer_sms_consent (org_id, phone_e164, created_at desc);

-- Append-only: proof is never edited or removed. The one allowed change is the link to a customer going empty when that
-- customer is deleted (the foreign key's ON DELETE SET NULL); a whole company's rows go with the company (cascade).
create or replace function public.customer_sms_consent_append_only() returns trigger
language plpgsql as $f$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.orgs where id = old.org_id) then return old; end if;
    raise exception 'customer_sms_consent is append-only';
  end if;
  if new.customer_id is null and old.customer_id is not null
     and (to_jsonb(new) - 'customer_id') = (to_jsonb(old) - 'customer_id') then
    return new;
  end if;
  raise exception 'customer_sms_consent is append-only';
end;
$f$;
drop trigger if exists customer_sms_consent_append_only on public.customer_sms_consent;
create trigger customer_sms_consent_append_only before update or delete on public.customer_sms_consent
  for each row execute function public.customer_sms_consent_append_only();
create index if not exists customer_sms_consent_customer_idx on public.customer_sms_consent (org_id, customer_id, created_at desc);
alter table public.customer_sms_consent enable row level security;
revoke all on public.customer_sms_consent from anon, authenticated;

-- ---- 3. Inbound texts ------------------------------------------------------------------------------------------------------
-- Every text a customer sends the company's number. The carrier retries a webhook, so (org, carrier message id) is unique:
-- the second delivery finds the first and does nothing. 'needs_staff' = nobody could be matched (or an opt-out phrase /
-- wrong-number reply someone should see): it stays on the owner's Today list until dismissed.
create table if not exists public.sms_inbound (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  provider_message_id text not null check (length(provider_message_id) between 1 and 200),
  from_e164 text not null,
  to_e164 text not null,
  body text not null default '' check (length(body) <= 4000),
  media_count integer not null default 0 check (media_count >= 0),
  kind text not null check (kind in ('message', 'stop', 'help', 'start', 'optout_phrase', 'wrong_number')),
  customer_id uuid null references public.customers(id) on delete set null,
  activity_id uuid null references public.activities(id) on delete set null,
  status text not null default 'handled' check (status in ('handled', 'needs_staff', 'dismissed')),
  handled_by uuid null references public.users(id) on delete set null,
  handled_at timestamptz null,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint sms_inbound_provider_unique unique (org_id, provider_message_id)
);
create index if not exists sms_inbound_open_idx on public.sms_inbound (org_id, received_at desc) where status = 'needs_staff';
create index if not exists sms_inbound_from_idx on public.sms_inbound (org_id, from_e164, received_at desc);
alter table public.sms_inbound enable row level security;
revoke all on public.sms_inbound from anon, authenticated;

-- ---- 4. Usage (what each company's texting cost us — the billing source) ---------------------------------------------------
create table if not exists public.sms_usage (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  direction text not null check (direction in ('out', 'in')),
  -- A customer_messages kind for automatic texts, 'staff_reply', 'sms_compliance', or 'inbound'.
  kind text not null,
  segments integer not null check (segments >= 0),
  -- Millionths of a dollar: the estimate at send time, replaced by the carrier's real charge on its delivery receipt.
  provider_cost_micros bigint null check (provider_cost_micros is null or provider_cost_micros >= 0),
  provider_message_id text not null,
  customer_message_id uuid null references public.customer_messages(id) on delete set null,
  occurred_at timestamptz not null default now(),
  constraint sms_usage_message_unique unique (org_id, direction, provider_message_id)
);
create index if not exists sms_usage_month_idx on public.sms_usage (org_id, occurred_at);
alter table public.sms_usage enable row level security;
revoke all on public.sms_usage from anon, authenticated;

-- ---- 5. The send log learns about texts ------------------------------------------------------------------------------------
alter table public.customer_messages
  add column if not exists provider_message_id text null,
  add column if not exists segments integer null check (segments is null or segments >= 0),
  add column if not exists delivery_status text null check (delivery_status is null or delivery_status in ('sent', 'delivered', 'failed', 'delivery_unconfirmed')),
  add column if not exists delivered_at timestamptz null,
  add column if not exists provider_error text null;
create index if not exists customer_messages_provider_idx on public.customer_messages (org_id, provider_message_id) where provider_message_id is not null;

-- Two kinds that are not "automatic": a staff member's reply, and the carrier-required STOP / HELP / START answers.
alter table public.customer_messages drop constraint if exists customer_messages_kind_check;
alter table public.customer_messages add constraint customer_messages_kind_check
  check (kind in ('visit_reminder', 'visit_on_the_way', 'visit_done', 'quote_follow_up', 'invoice_reminder', 'staff_reply', 'sms_compliance'));

-- ---- 6. A customer's text is an activity of origin 'sms' ------------------------------------------------------------------
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.activities'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%origin = any%'
  loop
    execute format('alter table public.activities drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.activities add constraint activities_origin_check check (origin is null or origin in ('human', 'system', 'customer_portal', 'sms'));

commit;
