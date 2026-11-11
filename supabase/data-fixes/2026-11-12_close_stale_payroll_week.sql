-- Close stale OPEN payroll weeks before the new pay-week path is turned on (PAYROLL_PAY_WEEK_ENABLED).
--
-- WHY: prod holds one open week from July, "2026-W27" (cutoff 2026-07-01 16:21 UTC, payday 2026-07-03), id
-- d12deb68-2dba-4ec4-b1a2-390d4521aa5b, with 1 hours row (36 h, $180.00, entered 2026-07-06) and 1 REJECTED bonus. Every week after
-- it was locked or paid in July/August, and ARX has paid outside the CRM since 2026-08-20. Left open it would (a) sit in "Earlier
-- weeks" as unpaid, and (b) block every later Approve: payroll_commit_week refuses while an earlier OPEN week holds pending fixes,
-- and the setter-ramp sync / fixes could still land on it. Cancelling is the honest state: the CRM never paid it.
-- !! Before applying, Nathan confirms the $180 (36 h, week of 2026-06-25 – 07-01) was paid outside the CRM. If it was NOT, do not
--    cancel: approve it instead, or add it as a fix on the first new week.
--
-- WHAT "stale" means here: status 'open', cutoff more than 21 days before the moment of apply, no live approval claim, and no
-- payout lines, live fixes or approved bonuses on it (those would mean money is in flight — refused, listed in the preview instead).
-- Its hours/bonus rows are left exactly as they are (history); nothing reads a cancelled week for pay.
--
-- HOW THIS FILE RUNS (running it as-is changes nothing):
--   1. Running the whole file (re)creates the function + backup table in `release_backups` and calls the PREVIEW.
--   2. Apply:  SELECT release_backups.close_stale_payroll_weeks('<org id>', 'apply');   (one company per run; required)
--   3. Undo:   SELECT release_backups.undo_close_stale_payroll_weeks('<org id>');  or  (NULL, '<run id>')  — never all companies;
--              only weeks still 'cancelled' by this fix are reopened.
-- Order: any time before PAYROLL_PAY_WEEK_ENABLED=true; independent of migration 202611120010.

CREATE SCHEMA IF NOT EXISTS release_backups;
REVOKE ALL ON SCHEMA release_backups FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON SCHEMA release_backups FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON SCHEMA release_backups FROM authenticated; END IF;
END $$;

CREATE TABLE IF NOT EXISTS release_backups.close_stale_payroll_weeks (
  run_id          uuid        NOT NULL,
  period_id       uuid        NOT NULL,
  org_id          uuid        NOT NULL,
  period_label    text        NULL,
  cutoff_at       timestamptz NOT NULL,
  prev_status     text        NOT NULL,
  applied_status  text        NOT NULL,
  hours_rows      int         NOT NULL,
  hours_total     numeric     NOT NULL,
  bonus_rows      int         NOT NULL,
  applied_at      timestamptz NOT NULL DEFAULT now(),
  undone_at       timestamptz NULL,
  PRIMARY KEY (run_id, period_id)
);

CREATE OR REPLACE FUNCTION release_backups.close_stale_payroll_weeks(p_org_id uuid, p_mode text DEFAULT 'preview', p_older_than interval DEFAULT interval '21 days')
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_run uuid := gen_random_uuid();
  v_plan jsonb;
  v_refused jsonb;
  v_n int := 0;
BEGIN
  IF p_mode NOT IN ('preview', 'apply') THEN RAISE EXCEPTION 'mode must be preview or apply'; END IF;
  IF p_org_id IS NULL THEN RAISE EXCEPTION 'pass the company id: one company per run'; END IF;

  WITH cand AS (
    SELECT p.*,
           (SELECT count(*) FROM payroll_rep_hours h WHERE h.payroll_period_id = p.id) AS hours_rows,
           (SELECT coalesce(sum(h.hourly_earnings), 0) FROM payroll_rep_hours h WHERE h.payroll_period_id = p.id) AS hours_total,
           (SELECT count(*) FROM payroll_bonus_lines b WHERE b.payroll_period_id = p.id) AS bonus_rows,
           (SELECT count(*) FROM payroll_bonus_lines b WHERE b.payroll_period_id = p.id AND b.status IN ('approved', 'paid')) AS bonus_money,
           (SELECT count(*) FROM payroll_payout_lines l WHERE l.payroll_period_id = p.id) AS lines,
           (SELECT count(*) FROM payroll_adjustments a WHERE a.payroll_period_id = p.id AND a.status <> 'void') AS fixes
    FROM payroll_periods p
    WHERE p.org_id = p_org_id AND p.status = 'open' AND p.cutoff_at < now() - p_older_than
      AND NOT (p.lock_claim_token IS NOT NULL AND p.lock_claimed_at > now() - interval '15 minutes')
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'org_id', org_id, 'label', period_label, 'cutoff_at', cutoff_at, 'hours_rows', hours_rows,
                                               'hours_total', hours_total, 'bonus_rows', bonus_rows, 'approved_bonuses', bonus_money))
                  FILTER (WHERE lines = 0 AND fixes = 0 AND bonus_money = 0), '[]'::jsonb),
         coalesce(jsonb_agg(jsonb_build_object('id', id, 'label', period_label, 'lines', lines, 'fixes', fixes, 'approved_bonuses', bonus_money))
                  FILTER (WHERE lines > 0 OR fixes > 0 OR bonus_money > 0), '[]'::jsonb)
    INTO v_plan, v_refused
  FROM cand;

  IF p_mode = 'preview' THEN
    RETURN jsonb_build_object('mode', 'preview', 'org_id', p_org_id, 'will_cancel', v_plan, 'refused_money_in_flight', v_refused);
  END IF;

  INSERT INTO release_backups.close_stale_payroll_weeks (run_id, period_id, org_id, period_label, cutoff_at, prev_status, applied_status, hours_rows, hours_total, bonus_rows)
  SELECT v_run, (x->>'id')::uuid, (x->>'org_id')::uuid, x->>'label', (x->>'cutoff_at')::timestamptz, 'open', 'cancelled',
         (x->>'hours_rows')::int, (x->>'hours_total')::numeric, (x->>'bonus_rows')::int
  FROM jsonb_array_elements(v_plan) x;

  UPDATE payroll_periods p SET status = 'cancelled'
  FROM release_backups.close_stale_payroll_weeks b
  WHERE b.run_id = v_run AND b.period_id = p.id AND p.org_id = p_org_id AND p.status = 'open';
  GET DIAGNOSTICS v_n = ROW_COUNT;

  RETURN jsonb_build_object('mode', 'apply', 'org_id', p_org_id, 'run_id', v_run, 'cancelled', v_n, 'weeks', v_plan, 'refused_money_in_flight', v_refused);
END;
$$;

DROP FUNCTION IF EXISTS release_backups.undo_close_stale_payroll_weeks(uuid);
CREATE OR REPLACE FUNCTION release_backups.undo_close_stale_payroll_weeks(p_org_id uuid DEFAULT NULL, p_run uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_n int := 0;
BEGIN
  -- Never an all-companies undo: name the company or the run.
  IF p_org_id IS NULL AND p_run IS NULL THEN RAISE EXCEPTION 'pass the company id or the run id'; END IF;
  -- Only a week this fix cancelled AND that is still cancelled is reopened.
  UPDATE payroll_periods p SET status = b.prev_status
  FROM release_backups.close_stale_payroll_weeks b
  WHERE b.period_id = p.id AND b.undone_at IS NULL AND p.status = b.applied_status
    AND (p_org_id IS NULL OR b.org_id = p_org_id) AND (p_run IS NULL OR b.run_id = p_run);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  UPDATE release_backups.close_stale_payroll_weeks b SET undone_at = now()
  WHERE b.undone_at IS NULL AND (p_org_id IS NULL OR b.org_id = p_org_id) AND (p_run IS NULL OR b.run_id = p_run);
  RETURN jsonb_build_object('reopened', v_n);
END;
$$;

REVOKE ALL ON FUNCTION release_backups.close_stale_payroll_weeks(uuid, text, interval) FROM PUBLIC;
REVOKE ALL ON FUNCTION release_backups.undo_close_stale_payroll_weeks(uuid, uuid) FROM PUBLIC;

-- ARX (prod org 9089d4ad-f46c-405b-9798-6751d45a7051). Another company: pass its own id.
SELECT release_backups.close_stale_payroll_weeks('9089d4ad-f46c-405b-9798-6751d45a7051', 'preview');
