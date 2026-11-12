-- QuickBooks sync worker (docs/quickbooks-sync.md, PR 3). NOT APPLIED — file only. Additive + nullable only; safe before or after the code.
--
-- integration_outbox: the worker's bookkeeping, so one row says everything an owner needs to see (what was sent, when, to which
--   QuickBooks record, why it is waiting or stuck):
--     next_attempt_at  — back-off: not picked up before this time
--     locked_until     — a claim lease; a crashed worker's rows are picked up again after it (find-before-send makes that safe)
--     error_code       — Intuit's code (e.g. 6240) or our own short code ('mapping', 'before_start', ...)
--     error_kind       — 'retrying' (we will try again) | 'needs_you' (a person must act; the plain-words reason is last_error)
--     qb_type / qb_id  — the QuickBooks record this event produced (link on the Activity screen)
--     sent_at          — when QuickBooks accepted it
-- qb_links: fingerprint = hash of the CRM facts last sent (unchanged facts are not sent again);
--           sent_total_cents = the total we last sent (so a total someone changed in QuickBooks is never overwritten).
--
-- Down (manual): alter table qb_links drop column fingerprint, drop column sent_total_cents;
--   alter table integration_outbox drop column next_attempt_at, drop column locked_until, drop column error_code,
--     drop column error_kind, drop column qb_type, drop column qb_id, drop column sent_at, drop column skipped_by, drop column skipped_at, drop column skip_reason;
begin;
set local lock_timeout = '5s';

alter table public.integration_outbox
  add column if not exists next_attempt_at timestamptz null,
  add column if not exists locked_until timestamptz null,
  add column if not exists error_code text null,
  add column if not exists error_kind text null,
  add column if not exists qb_type text null,
  add column if not exists qb_id text null,
  add column if not exists sent_at timestamptz null,
  -- who closed a stuck line with Skip, when, and why (a skipped line is never silently re-opened by a repeat event)
  add column if not exists skipped_by uuid null,
  add column if not exists skipped_at timestamptz null,
  add column if not exists skip_reason text null;

do $$ begin
  alter table public.integration_outbox add constraint integration_outbox_error_kind_check check (error_kind is null or error_kind in ('retrying', 'needs_you'));
exception when duplicate_object then null; end $$;

-- What the worker polls: one company's due rows, oldest first (the claim filters due rows in SQL).
create index if not exists integration_outbox_qb_pending_idx
  on public.integration_outbox (org_id, next_attempt_at, created_at)
  where provider = 'quickbooks' and status = 'pending';
create index if not exists integration_outbox_qb_processing_idx
  on public.integration_outbox (org_id, locked_until, created_at)
  where provider = 'quickbooks' and status = 'processing';
-- What the owner's Needs-you card reads.
create index if not exists integration_outbox_needs_you_idx
  on public.integration_outbox (org_id, provider, created_at)
  where error_kind = 'needs_you';

alter table public.qb_links
  add column if not exists fingerprint text null,
  add column if not exists sent_total_cents integer null;

commit;
