-- Automatic customer messages (2026-11-12): visit reminders, "on the way" / "done" visit emails, quote follow-ups and
-- invoice reminders, sent by ONE scheduled sender (/api/cron/customer-messages, lib/customer-messages-db.ts). Nothing
-- here is read unless the company turns on the `customerMessages` switch (orgs.settings.features, default OFF) AND turns
-- each message on in Settings → Customer messages, so applying it changes nothing for anyone. Additive / nullable only.
--
-- 1. customer_messages: THE send log. One row per message key (unique (org_id, message_key)) — inserting the row IS the
--    claim, so a message can never go out twice, whatever runs at the same time. A key names what the message is about
--    (e.g. visit_reminder:email:<customer>:<visit day>), so "one reminder per customer per day" is the key itself.
--    status: queued (an event waiting for send_after, e.g. "done" 15 min later), sending (claimed), sent, skipped
--    (opted out / no address / suppressed / expired — skip_reason), cancelled (no longer true at send time), failed
--    (attempts, last_error; retried while attempts < 3). channel 'sms' is reserved (SMS plugs in later; nothing writes it).
--    link_token_hash = sha256 of the message's own random link token (unsubscribe + visit photos page /m/<token>).
-- 2. customer_message_suppressions: addresses that must never get an automatic message again — the customer
--    unsubscribed, the address bounced, or a complaint. One row per (org, channel, address).
-- 3. customers.messages_off_at / messages_off_by: the office's per-customer "don't email" flag.
-- 4. production_jobs.commission_change_wait gains 'retry_error': a commission change line that hit an unexpected
--    database error is retried by the morning cron (it used to be only logged).
--
-- All service role only (RLS on, no policies; no grants to anon/authenticated).
-- Deploy: apply BEFORE the code (the code refuses to send and Settings says so until it is applied). Needs
-- 202611120030 (commission_change_wait). Order-free with 202611120040.
-- ROLLBACK (no message sent yet, or the log may be dropped): DROP TABLE customer_message_suppressions, customer_messages;
--   ALTER TABLE customers DROP COLUMN messages_off_at, DROP COLUMN messages_off_by; restore the commission_change_wait
--   CHECK from 202611120030 (only once no job is 'retry_error').

begin;
set local lock_timeout = '5s';

-- ---- 1. The send log ----------------------------------------------------------------------------------------------------
create table if not exists public.customer_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  message_key text not null check (length(message_key) between 1 and 300),
  kind text not null check (kind in ('visit_reminder', 'visit_on_the_way', 'visit_done', 'quote_follow_up', 'invoice_reminder')),
  channel text not null default 'email' check (channel in ('email', 'sms')),
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'skipped', 'cancelled', 'failed')),
  customer_id uuid null references public.customers(id) on delete set null,
  to_address text null,
  refs jsonb not null default '{}'::jsonb,
  send_after timestamptz not null default now(),
  expires_at timestamptz null,
  attempts integer not null default 0 check (attempts >= 0),
  claimed_at timestamptz null,
  sent_at timestamptz null,
  skip_reason text null,
  last_error text null,
  subject text null,
  link_token_hash text null,
  created_by uuid null references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_messages_key_unique unique (org_id, message_key),
  constraint customer_messages_skip_shape check (status not in ('skipped', 'cancelled') or skip_reason is not null),
  constraint customer_messages_sent_shape check (status <> 'sent' or (sent_at is not null and to_address is not null))
);
create unique index if not exists customer_messages_link_token_idx on public.customer_messages (link_token_hash) where link_token_hash is not null;
-- The sender's work list (events waiting + failures to retry), per company.
create index if not exists customer_messages_due_idx on public.customer_messages (org_id, send_after) where status in ('queued', 'failed', 'sending');
-- "How many did this address get today" (rate limit) and a customer's history.
create index if not exists customer_messages_address_idx on public.customer_messages (org_id, to_address, created_at desc);
create index if not exists customer_messages_customer_idx on public.customer_messages (org_id, customer_id, created_at desc);

alter table public.customer_messages enable row level security;
revoke all on public.customer_messages from anon, authenticated;

-- ---- 2. Addresses never to message again --------------------------------------------------------------------------------
create table if not exists public.customer_message_suppressions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  channel text not null default 'email' check (channel in ('email', 'sms')),
  -- Lower-cased, trimmed (the app writes it that way; checked here too).
  address text not null check (address = lower(btrim(address)) and length(address) between 3 and 320),
  reason text not null check (reason in ('unsubscribed', 'bounced', 'complained')),
  message_id uuid null references public.customer_messages(id) on delete set null,
  detail text null,
  created_at timestamptz not null default now(),
  constraint customer_message_suppressions_unique unique (org_id, channel, address)
);
alter table public.customer_message_suppressions enable row level security;
revoke all on public.customer_message_suppressions from anon, authenticated;

-- ---- 3. The office's "don't email this customer" ------------------------------------------------------------------------
alter table public.customers
  add column if not exists messages_off_at timestamptz null,
  add column if not exists messages_off_by uuid null references public.users(id) on delete set null;

-- ---- 4. Commission changes that hit an unexpected error are retried, not only logged ------------------------------------
alter table public.production_jobs drop constraint if exists production_jobs_commission_change_wait_check;
alter table public.production_jobs add constraint production_jobs_commission_change_wait_check
  check (commission_change_wait is null or commission_change_wait in ('approval_running', 'pay_week_off', 'retry_error'));

commit;
