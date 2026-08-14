-- Idempotency ledger for scheduled email blasts.
--
-- The morning blast cron previously had exactly one usable fire per day: a transient
-- Supabase 503 on 2026-08-14 killed the 5:30am ET run and nothing retried. The cron now
-- fires several times each morning and claims the day here before sending, so retries are
-- safe and a blast can go out at most once per org, per blast type, per Eastern date.
create table if not exists public.email_blast_sends (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  blast_type text not null,
  -- Eastern calendar date the blast is for, not the UTC date of the send.
  send_date date not null,
  recipients_sent integer not null default 0,
  claimed_at timestamptz not null default now(),
  sent_at timestamptz
);

-- The claim: an insert that loses this race means another fire already owns today's send.
create unique index if not exists email_blast_sends_org_type_date_key
  on public.email_blast_sends (org_id, blast_type, send_date);

create index if not exists email_blast_sends_org_date_idx
  on public.email_blast_sends (org_id, send_date desc);

-- Service-role only: written by the cron, never read by the browser. RLS on with no
-- policies denies anon/authenticated outright.
alter table public.email_blast_sends enable row level security;
