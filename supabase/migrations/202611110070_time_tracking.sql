-- Time tracking, stages 1–2 (2026-11-11): crew clock in / out per visit or job, the office time list, and the feeds into
-- payroll hours (payroll_rep_hours via saveHoursEntries) and job labor cost (job_cost_lines source 'time_entries').
-- Nothing here is read unless the company turns on the `timeTracking` switch (orgs.settings.features, default OFF), so
-- applying it changes nothing for anyone. Additive / nullable only.
--
-- 1. sub_contractors.tracks_time: this crew clocks in and out (an in-house crew). Subs never see a clock (default false).
-- 2. crew_members (sub_id, user_id, is_lead): who is on a time-tracked crew. Employees are users rows (paid through
--    their comp plan's hourly rate). The OLD `crews` table (20260213_operations_tables.sql, members uuid[]) is NOT used
--    and is a deletion candidate (CLAUDE.md Known Redundancy).
-- 3. time_entries: one row per person per stretch of work / break, or per piece of equipment running. Instants only
--    (timestamptz) — durations are exact across clock changes. Service role only (RLS on, no policies): the ONE writer
--    is lib/time-tracking-db.ts. At most one open work entry and one open break per person (partial unique indexes), so
--    two phones tapping at once can't double-clock anyone.
-- 4. time_entry_changes: who changed an entry, when, why, what ({field,label,old,new} — lib/change-log.ts shape).
-- 5. job_cost_lines: source value 'time_entries' + `time_week_ending` (the pay week the labor line covers); one line per
--    job per week (partial unique index), upserted by the feed.
--
-- Deploy: apply BEFORE the code. Order-free with the other 2026-11-11 migrations except it needs 202611110030
-- (service plans: work_orders visits) only for the visit references, which are plain FKs to work_orders.
-- Rollback (no rows yet): DROP FUNCTION time_feed_try_lock, time_feed_unlock; DROP TABLE time_feed_locks,
--   time_entry_changes, time_entries, crew_members; ALTER TABLE payroll_rep_hours DROP COLUMN hours_source,
--   typed_regular_hours, typed_overtime_hours; ALTER TABLE sub_contractors DROP
--   COLUMN tracks_time; ALTER TABLE job_cost_lines DROP COLUMN time_week_ending (an enum value cannot be dropped; the
--   'time_entries' value stays harmlessly unused).

-- An enum value added inside a transaction cannot be USED in that same transaction (nothing below uses it).
ALTER TYPE job_cost_line_source ADD VALUE IF NOT EXISTS 'time_entries';

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ---- 1. Crews that clock in -------------------------------------------------------------------------------------------
ALTER TABLE public.sub_contractors ADD COLUMN IF NOT EXISTS tracks_time boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.sub_contractors.tracks_time IS
  'This crew clocks in and out (in-house crew; members in crew_members). False = a sub: never sees a clock.';

-- ---- 2. Crew members --------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.crew_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  sub_id uuid NOT NULL REFERENCES public.sub_contractors(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  is_lead boolean NOT NULL DEFAULT false,
  created_by uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crew_members_one_per_crew UNIQUE (org_id, sub_id, user_id)
);
CREATE INDEX IF NOT EXISTS crew_members_user_idx ON public.crew_members (org_id, user_id);
ALTER TABLE public.crew_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crew_members FROM anon, authenticated;

-- ---- 3. Time entries --------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.time_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  -- Whose time (work / break). Equipment may have no person (the machine's hours; tapped_by says who started it).
  user_id uuid NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  -- The crew it was tapped for (null = a person clocking only themselves on a job page).
  sub_id uuid NULL REFERENCES public.sub_contractors(id) ON DELETE SET NULL,
  work_order_id uuid NULL REFERENCES public.work_orders(id) ON DELETE SET NULL,
  production_job_id uuid NULL REFERENCES public.production_jobs(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('work', 'break', 'equipment')),
  started_at timestamptz NOT NULL,
  ended_at timestamptz NULL,
  -- How the start / the end got here.
  source text NOT NULL CHECK (source IN ('lead_tap', 'self_tap', 'typed', 'auto_closed')),
  end_source text NULL CHECK (end_source IS NULL OR end_source IN ('lead_tap', 'self_tap', 'typed', 'auto_closed')),
  -- Closed with "going to the next stop": the gap until this person's next work entry the same day is paid travel.
  closed_for_travel boolean NOT NULL DEFAULT false,
  -- Location at the tap, only when the company turned that on (orgs.settings.timeTracking.captureLocation).
  start_lat double precision NULL,
  start_lng double precision NULL,
  end_lat double precision NULL,
  end_lng double precision NULL,
  pricebook_item_id uuid NULL REFERENCES public.pricebook_items(id) ON DELETE SET NULL,
  needs_review boolean NOT NULL DEFAULT false,
  review_note text NULL CHECK (review_note IS NULL OR char_length(review_note) <= 500),
  -- Who tapped (a crew link names its lead on the phone; a signed-in tap is the signed-in person).
  tapped_by_user_id uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,
  ended_by_user_id uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,
  tapped_via text NULL CHECK (tapped_via IS NULL OR tapped_via IN ('crew_link', 'signed_in', 'office', 'system')),
  -- Offline queue: the phone's id for the tap, so a resend never doubles an entry.
  client_tap_id text NULL CHECK (client_tap_id IS NULL OR char_length(client_tap_id) <= 64),
  -- Phone clock minus server clock at send time (seconds), when it was off enough to matter.
  device_clock_skew_seconds integer NULL,
  -- When the end was RECORDED (server time), not when the shift ended: a shift closed after its week was approved is
  -- carried into the next open week (lib/time-tracking-db.ts syncTimeFeeds).
  ended_recorded_at timestamptz NULL,
  removed_at timestamptz NULL,
  removed_by uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT time_entries_person CHECK (kind = 'equipment' OR user_id IS NOT NULL),
  CONSTRAINT time_entries_equipment_item CHECK (kind <> 'equipment' OR pricebook_item_id IS NOT NULL),
  CONSTRAINT time_entries_order CHECK (ended_at IS NULL OR ended_at >= started_at),
  CONSTRAINT time_entries_where CHECK (kind = 'break' OR work_order_id IS NOT NULL OR production_job_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS time_entries_user_time_idx ON public.time_entries (org_id, user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS time_entries_org_time_idx ON public.time_entries (org_id, started_at DESC);
CREATE INDEX IF NOT EXISTS time_entries_job_idx ON public.time_entries (production_job_id) WHERE production_job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS time_entries_wo_idx ON public.time_entries (work_order_id) WHERE work_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS time_entries_open_idx ON public.time_entries (org_id, started_at) WHERE ended_at IS NULL AND removed_at IS NULL;
-- One open clock per person: a second phone (or a resent tap) can't clock someone in twice.
CREATE UNIQUE INDEX IF NOT EXISTS time_entries_one_open_work ON public.time_entries (org_id, user_id)
  WHERE kind = 'work' AND ended_at IS NULL AND removed_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS time_entries_one_open_break ON public.time_entries (org_id, user_id)
  WHERE kind = 'break' AND ended_at IS NULL AND removed_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS time_entries_tap_once ON public.time_entries (org_id, client_tap_id, kind, coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE client_tap_id IS NOT NULL;
ALTER TABLE public.time_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.time_entries FROM anon, authenticated;

-- Every reference is this company's own; the job comes from the work order when not given. A real bug if not: raises.
CREATE OR REPLACE FUNCTION public.time_tracking_same_org() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_job uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.org_id IS DISTINCT FROM OLD.org_id THEN
      RAISE EXCEPTION 'a row cannot move to another company' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF NEW.sub_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.sub_contractors s WHERE s.id = NEW.sub_id AND s.org_id = NEW.org_id) THEN
    RAISE EXCEPTION 'crew is not in this company' USING ERRCODE = '42501';
  END IF;
  IF NEW.user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = NEW.user_id AND u.org_id = NEW.org_id) THEN
    RAISE EXCEPTION 'person is not in this company' USING ERRCODE = '42501';
  END IF;
  IF TG_TABLE_NAME = 'time_entries' THEN
    NEW.updated_at := clock_timestamp();
    IF NEW.work_order_id IS NOT NULL THEN
      SELECT w.job_id INTO v_job FROM public.work_orders w WHERE w.id = NEW.work_order_id AND w.org_id = NEW.org_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'work order is not in this company' USING ERRCODE = '42501';
      END IF;
      IF NEW.production_job_id IS NULL THEN NEW.production_job_id := v_job; END IF;
    END IF;
    IF NEW.production_job_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.production_jobs j WHERE j.id = NEW.production_job_id AND j.org_id = NEW.org_id) THEN
      RAISE EXCEPTION 'job is not in this company' USING ERRCODE = '42501';
    END IF;
    IF NEW.pricebook_item_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.pricebook_items p WHERE p.id = NEW.pricebook_item_id AND p.org_id = NEW.org_id) THEN
      RAISE EXCEPTION 'equipment is not in this company' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS crew_members_same_org ON public.crew_members;
CREATE TRIGGER crew_members_same_org BEFORE INSERT OR UPDATE ON public.crew_members
  FOR EACH ROW EXECUTE FUNCTION public.time_tracking_same_org();
DROP TRIGGER IF EXISTS time_entries_same_org ON public.time_entries;
CREATE TRIGGER time_entries_same_org BEFORE INSERT OR UPDATE ON public.time_entries
  FOR EACH ROW EXECUTE FUNCTION public.time_tracking_same_org();

-- ---- 4. Change history ------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.time_entry_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  time_entry_id uuid NOT NULL REFERENCES public.time_entries(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('added', 'updated', 'removed', 'auto_closed', 'finish_answered')),
  changed_by uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  reason text NULL CHECK (reason IS NULL OR char_length(reason) <= 500),
  changes jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX IF NOT EXISTS time_entry_changes_entry_idx ON public.time_entry_changes (time_entry_id, changed_at DESC);
ALTER TABLE public.time_entry_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.time_entry_changes FROM anon, authenticated;

-- ---- 5. Job labor cost from the clock ---------------------------------------------------------------------------------
ALTER TABLE public.job_cost_lines ADD COLUMN IF NOT EXISTS time_week_ending date NULL;
COMMENT ON COLUMN public.job_cost_lines.time_week_ending IS
  'Set only on lines written by the time clock feed (source time_entries): the pay week (cutoff date) the labor covers.';
CREATE UNIQUE INDEX IF NOT EXISTS job_cost_lines_time_week_once ON public.job_cost_lines (job_id, time_week_ending)
  WHERE time_week_ending IS NOT NULL;

-- ---- 6. Typed vs clocked hours on payroll ------------------------------------------------------------------------------
-- payroll_rep_hours.regular_hours / overtime_hours stay what payroll pays. hours_source says where they came from; the
-- office's own typed hours are kept in typed_* when the clock takes over (and come back if the clock time is removed).
ALTER TABLE public.payroll_rep_hours ADD COLUMN IF NOT EXISTS hours_source text NOT NULL DEFAULT 'typed';
DO $$ BEGIN
  ALTER TABLE public.payroll_rep_hours ADD CONSTRAINT payroll_rep_hours_source_check CHECK (hours_source IN ('typed', 'clock'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
ALTER TABLE public.payroll_rep_hours ADD COLUMN IF NOT EXISTS typed_regular_hours numeric(7, 2) NULL;
ALTER TABLE public.payroll_rep_hours ADD COLUMN IF NOT EXISTS typed_overtime_hours numeric(7, 2) NULL;
COMMENT ON COLUMN public.payroll_rep_hours.hours_source IS 'typed = hours typed by the office; clock = the crew time clock (typed_* keeps what was typed).';

-- ---- 7. One payroll recompute per person at a time ----------------------------------------------------------------------
-- A lease (not a session advisory lock: each PostgREST call is its own transaction). Service role only.
CREATE TABLE IF NOT EXISTS public.time_feed_locks (
  org_id uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token uuid NOT NULL,
  locked_until timestamptz NOT NULL,
  PRIMARY KEY (org_id, user_id)
);
ALTER TABLE public.time_feed_locks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.time_feed_locks FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.time_feed_try_lock(p_org uuid, p_user uuid, p_token uuid, p_seconds integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_got uuid;
BEGIN
  INSERT INTO public.time_feed_locks AS l (org_id, user_id, token, locked_until)
  VALUES (p_org, p_user, p_token, clock_timestamp() + make_interval(secs => greatest(1, least(p_seconds, 120))))
  ON CONFLICT (org_id, user_id) DO UPDATE SET token = EXCLUDED.token, locked_until = EXCLUDED.locked_until
    WHERE l.locked_until < clock_timestamp()
  RETURNING token INTO v_got;
  RETURN v_got = p_token;
END;
$$;
CREATE OR REPLACE FUNCTION public.time_feed_unlock(p_org uuid, p_user uuid, p_token uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.time_feed_locks WHERE org_id = p_org AND user_id = p_user AND token = p_token;
$$;
REVOKE ALL ON FUNCTION public.time_feed_try_lock(uuid, uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.time_feed_unlock(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.time_feed_try_lock(uuid, uuid, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.time_feed_unlock(uuid, uuid, uuid) TO service_role;

COMMIT;
