-- ============================================
-- JOB TRADES ON WORK ORDERS
--
-- A job can now carry several crews: roofing, gutters, siding, … each with its
-- own sub, its own day(s), its own Google invite and its own crew photo link.
-- One row per trade, stored on `work_orders` rather than a new table: a work
-- order already IS "a sub sent to a job on a date", had 0 rows in prod, and
-- reusing it keeps installs, go-backs and warranty visits on one dispatch model.
--
-- A trade is a work order with `trade IS NOT NULL` (work_order_type 'install').
-- `production_jobs.scheduled_date` / `install_days` / `assigned_sub_id` stay
-- where 40+ readers expect them, but are now DERIVED from the job's trades by
-- `syncJobScheduleFromTrades` (lib/job-trades.ts) — nothing else writes them.
--
-- Additive and nullable only. Trades are created lazily by application code
-- (`ensureJobTrades`) from each job's CURRENT assignment the first time new
-- code touches the job, not backfilled here — the old code keeps running
-- against production_jobs until deploy, so a backfill now would drift.
-- ============================================

-- ---- 1. Close the sub-portal anon leak -------------------------------------
-- This policy let ANY caller holding the public anon key read every
-- portal-enabled sub row — including portal_access_token, phone, email and
-- internal_notes. It never checked the token.
DROP POLICY IF EXISTS "Sub-contractors can access via portal token" ON sub_contractors;

-- Any caller could insert a comment on any work order by naming any sub_id,
-- and anon could read every comment written by a portal-enabled sub.
DROP POLICY IF EXISTS "Subs can add work_order_comments" ON work_order_comments;
DROP POLICY IF EXISTS "Subs can view their work_order_comments" ON work_order_comments;

-- ---- 2. Trade columns on work_orders ---------------------------------------
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS trade TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS trade_source TEXT;
-- Crew time on site in days: ½, 1, 1½ or 2. Ops picks it by hand today; the
-- column is numeric so a future auto-estimate can write the same values.
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS install_days NUMERIC(3,1);
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS install_google_event_id TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS install_calendar_id TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS install_sync_failed_at TIMESTAMPTZ;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS install_sync_error TEXT;
-- Unguessable token in the crew's photo link. Rotated whenever the trade moves
-- to a different sub or comes off the schedule, so a previous crew's link dies.
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS crew_link_token TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_orders_trade_check') THEN
    ALTER TABLE work_orders ADD CONSTRAINT work_orders_trade_check
      CHECK (trade IS NULL OR trade IN ('roofing', 'gutters', 'siding', 'windows', 'other'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_orders_install_days_check') THEN
    ALTER TABLE work_orders ADD CONSTRAINT work_orders_install_days_check
      CHECK (install_days IS NULL OR install_days IN (0.5, 1, 1.5, 2));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_orders_trade_source_check') THEN
    ALTER TABLE work_orders ADD CONSTRAINT work_orders_trade_source_check
      CHECK (trade_source IS NULL OR trade_source IN ('auto', 'manual'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_work_orders_job ON work_orders(job_id) WHERE job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_work_orders_trade_schedule
  ON work_orders(org_id, scheduled_date) WHERE trade IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_work_orders_crew_link_token
  ON work_orders(crew_link_token) WHERE crew_link_token IS NOT NULL;
-- Auto-created trades exist at most once per job per trade, so two concurrent
-- page loads can't both create "Gutters". Cancelled auto rows are kept (not
-- deleted) precisely so this index stops ensureJobTrades re-adding a trade ops
-- removed. Manual trades are unconstrained: two siding crews is legitimate.
CREATE UNIQUE INDEX IF NOT EXISTS uq_work_orders_job_auto_trade
  ON work_orders(job_id, trade) WHERE trade_source = 'auto';

-- ---- 3. Photos belong to a trade -------------------------------------------
ALTER TABLE photos
  ADD COLUMN IF NOT EXISTS work_order_id UUID REFERENCES work_orders(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_photos_work_order ON photos(work_order_id) WHERE work_order_id IS NOT NULL;

-- ---- 4. Work order numbering race ------------------------------------------
-- MAX()+1 with no lock: two trades created at once in one org read the same
-- max and the second insert fails the (org_id, work_order_number) unique key.
-- Adding a job's trades is exactly that concurrent case. Same numbering format.
CREATE OR REPLACE FUNCTION public.generate_work_order_number()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  next_num INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('work_order_number:' || NEW.org_id::text));
  SELECT COALESCE(MAX(CAST(SUBSTRING(work_order_number FROM 4) AS INTEGER)), 0) + 1
  INTO next_num
  FROM work_orders
  WHERE org_id = NEW.org_id;

  NEW.work_order_number := 'WO-' || LPAD(next_num::TEXT, 5, '0');
  RETURN NEW;
END;
$function$;
