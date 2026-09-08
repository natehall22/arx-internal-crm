-- ============================================
-- INSTALL SCHEDULING
--
-- Powers the ops "install schedule" board: assigning a roof install (1-2 day,
-- all-day event) on `production_jobs` to a subcontractor and pushing that
-- assignment to Google Calendar as an all-day event with the sub invited as an
-- attendee (subs have no CRM login and no Google OAuth of their own — instead
-- each sub gives ARX a Google email address, stored on `sub_contractors.
-- scheduling_email`, and that address is added as a calendar attendee so
-- Google emails/pushes the invite to the sub's own calendar natively).
--
-- Additive and nullable only — this system is live and in daily use. Every
-- column here defaults to NULL/absent and changes no existing behavior until
-- the new ops routes (`/api/ops/install-schedule*`) start writing to it.
-- ============================================

-- The Google account a sub gave us, invited as a calendar attendee for their installs.
ALTER TABLE sub_contractors
  ADD COLUMN IF NOT EXISTS scheduling_email TEXT;

-- How many days the install spans. NULL is treated as 1 by application code —
-- this column intentionally has no CHECK constraint so a future 3+ day job
-- (e.g. a large commercial re-roof) isn't blocked at the database layer; the
-- API validates 1 or 2 for the normal residential install flow.
ALTER TABLE production_jobs
  ADD COLUMN IF NOT EXISTS install_days INTEGER;

-- Where the synced Google Calendar event lives, so a later update/delete can
-- find it again without guessing which calendar it was written to.
ALTER TABLE production_jobs
  ADD COLUMN IF NOT EXISTS install_google_event_id TEXT;

ALTER TABLE production_jobs
  ADD COLUMN IF NOT EXISTS install_calendar_id TEXT;

-- Google sync failure bookkeeping. The database write for scheduling an
-- install is never blocked or rolled back by a Google failure (Google is a
-- one-way export, not a gate) — these columns just let the board surface a
-- warning and offer a retry.
ALTER TABLE production_jobs
  ADD COLUMN IF NOT EXISTS install_sync_failed_at TIMESTAMPTZ;

ALTER TABLE production_jobs
  ADD COLUMN IF NOT EXISTS install_sync_error TEXT;

-- The install-schedule board's core query needs an index on
-- production_jobs (org_id, scheduled_date) — but `idx_production_jobs_scheduled`
-- (20260213_operations_tables.sql:244) already covers exactly that column pair.
-- Adding a second index on the same columns would be pure duplication (Postgres
-- doesn't dedupe by column list, only by name), so this migration intentionally
-- adds none. See CLAUDE.md "Tesla Algorithm" — delete/reuse before adding.
