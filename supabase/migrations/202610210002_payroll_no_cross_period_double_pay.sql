-- Payroll: a job / rep / role can be paid in at most ONE payroll period, and a period
-- can only be locked, cancelled or reopened by one actor at a time.
--
-- Why: materializePayrollPeriod (lib/payroll-period-materialization.ts) reads the
-- set of already-snapshotted jobs once, up front, then writes snapshots and payout
-- lines much later. The only DB uniqueness is per period
-- ((payroll_period_id, job_id) on snapshots, (payroll_period_id, job_id, user_id,
-- participant_role) on payout lines), so two locks running back to back (2026-08-20,
-- 5 periods in ~14s) both passed the check and paid 15 jobs in 2-3 periods. The lock
-- route also read the period status once and flipped it to 'locked' at the end with
-- no re-check, so a cancel/reopen running meanwhile could be silently overwritten.
--
-- What this does (all additive):
--   1. Single-period triggers (BEFORE INSERT, and BEFORE UPDATE of the key columns)
--      on payroll_job_snapshots and payroll_payout_lines. Each takes a transaction-
--      scoped advisory lock on job_id (serializing writers for one job), lets a write
--      through if the same key already exists in the same period (a retry/upsert,
--      never new pay), refuses new rows in a period that is not 'open', and refuses a
--      job (snapshots) or job+user+role (lines) already present in ANOTHER period.
--   2. Two nullable columns on payroll_periods (lock_claimed_at, lock_claim_token) and
--      payroll_claim_period_lock(): an atomic open -> claimed step taken before
--      materializing. The app flips status to 'locked' only WHERE the token still
--      matches. A claim older than 15 minutes (longer than any serverless request can
--      run) is treated as a crashed lock and can be retaken.
--   3. payroll_cancel_or_reopen_period(): cancel/reopen in ONE transaction under a
--      row lock on the period. It refuses while a lock claim is live, refuses a
--      non-open period that has payout lines, refuses any period with chargeback
--      applications, and for an OPEN period (a lock that never finished) deletes that
--      period's snapshots (payout lines cascade), clears the jobs' job_payroll_state
--      period pointer, and writes one payroll_override_audit row.
--   4. payroll_discard_lineless_job_snapshot(): deletes a snapshot only if it has no
--      payout lines, atomically (serialized with line inserts by the same advisory lock).
--
-- What this deliberately does NOT do:
--   * It does not modify any existing row. The 15 jobs already paid in several periods
--     are removed by supabase/data-fixes/20261021_remove_cross_period_duplicate_payouts.sql
--     (run AFTER this migration), and migration 202610210003 then adds real unique
--     indexes. Apply order: 0002 -> data fix -> 0003 -> deploy app.
--   * Editing amounts on existing rows (e.g. during reconciliation) is not blocked.
--   * No CHECK constraint changes: payroll_periods.status values are unchanged.
-- Rollback: see the bottom of this file.

ALTER TABLE public.payroll_periods ADD COLUMN IF NOT EXISTS lock_claimed_at timestamptz;
ALTER TABLE public.payroll_periods ADD COLUMN IF NOT EXISTS lock_claim_token uuid;
COMMENT ON COLUMN public.payroll_periods.lock_claimed_at IS
  'Set while a lock is materializing this period (payroll_claim_period_lock). Older than 15 min = crashed, retakeable.';
COMMENT ON COLUMN public.payroll_periods.lock_claim_token IS
  'Token of the request holding the lock claim; the final flip to locked must match it.';

-- 1. Single-period triggers -------------------------------------------------------

CREATE OR REPLACE FUNCTION public.payroll_guard_job_snapshot_single_period()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_other_period uuid;
  v_status text;
BEGIN
  -- Serialize every payroll write for this job until the writing transaction ends.
  PERFORM pg_advisory_xact_lock(hashtextextended('payroll_job:' || NEW.job_id::text, 0));

  -- This period already has this job's snapshot: the write is a retry/upsert that
  -- ON CONFLICT turns into an update, not new pay. Let it through (this also keeps
  -- retries working on the pre-existing multi-period duplicates).
  IF EXISTS (
    SELECT 1 FROM payroll_job_snapshots s
    WHERE s.payroll_period_id = NEW.payroll_period_id AND s.job_id = NEW.job_id
  ) THEN
    RETURN NEW;
  END IF;

  -- New pay only lands in an open period. FOR SHARE holds the status steady until
  -- this write commits (a concurrent cancel/lock flip waits for it).
  SELECT p.status INTO v_status FROM payroll_periods p WHERE p.id = NEW.payroll_period_id FOR SHARE;
  IF v_status IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'payroll_period_not_open: payroll period % is %', NEW.payroll_period_id, coalesce(v_status, 'missing')
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT s.payroll_period_id INTO v_other_period
  FROM payroll_job_snapshots s
  WHERE s.job_id = NEW.job_id
    AND s.payroll_period_id <> NEW.payroll_period_id
  LIMIT 1;

  IF v_other_period IS NOT NULL THEN
    RAISE EXCEPTION 'payroll_already_paid: job % is already snapshotted in payroll period %',
      NEW.job_id, v_other_period
      USING ERRCODE = 'unique_violation',
            HINT = 'A job can only be paid in one payroll period. Use an adjustment instead.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.payroll_guard_payout_line_single_period()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_other_period uuid;
  v_status text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('payroll_job:' || NEW.job_id::text, 0));

  -- Same key already in this period: the per-period unique index (or ON CONFLICT)
  -- decides; it can never become a second payment.
  IF EXISTS (
    SELECT 1 FROM payroll_payout_lines l
    WHERE l.payroll_period_id = NEW.payroll_period_id
      AND l.job_id = NEW.job_id
      AND l.user_id = NEW.user_id
      AND l.participant_role = NEW.participant_role
  ) THEN
    RETURN NEW;
  END IF;

  SELECT p.status INTO v_status FROM payroll_periods p WHERE p.id = NEW.payroll_period_id FOR SHARE;
  IF v_status IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'payroll_period_not_open: payroll period % is %', NEW.payroll_period_id, coalesce(v_status, 'missing')
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT l.payroll_period_id INTO v_other_period
  FROM payroll_payout_lines l
  WHERE l.job_id = NEW.job_id
    AND l.user_id = NEW.user_id
    AND l.participant_role = NEW.participant_role
    AND l.payroll_period_id <> NEW.payroll_period_id
  LIMIT 1;

  IF v_other_period IS NOT NULL THEN
    RAISE EXCEPTION 'payroll_already_paid: job % / user % / role % already has a payout line in payroll period %',
      NEW.job_id, NEW.user_id, NEW.participant_role, v_other_period
      USING ERRCODE = 'unique_violation',
            HINT = 'A job/rep/role can only be paid in one payroll period. Use an adjustment instead.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payroll_job_snapshots_single_period_ins ON public.payroll_job_snapshots;
CREATE TRIGGER trg_payroll_job_snapshots_single_period_ins
  BEFORE INSERT ON public.payroll_job_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.payroll_guard_job_snapshot_single_period();

DROP TRIGGER IF EXISTS trg_payroll_job_snapshots_single_period_upd ON public.payroll_job_snapshots;
CREATE TRIGGER trg_payroll_job_snapshots_single_period_upd
  BEFORE UPDATE OF job_id, payroll_period_id ON public.payroll_job_snapshots
  FOR EACH ROW
  WHEN (OLD.job_id IS DISTINCT FROM NEW.job_id
        OR OLD.payroll_period_id IS DISTINCT FROM NEW.payroll_period_id)
  EXECUTE FUNCTION public.payroll_guard_job_snapshot_single_period();

DROP TRIGGER IF EXISTS trg_payroll_payout_lines_single_period_ins ON public.payroll_payout_lines;
CREATE TRIGGER trg_payroll_payout_lines_single_period_ins
  BEFORE INSERT ON public.payroll_payout_lines
  FOR EACH ROW EXECUTE FUNCTION public.payroll_guard_payout_line_single_period();

DROP TRIGGER IF EXISTS trg_payroll_payout_lines_single_period_upd ON public.payroll_payout_lines;
CREATE TRIGGER trg_payroll_payout_lines_single_period_upd
  BEFORE UPDATE OF job_id, user_id, participant_role, payroll_period_id ON public.payroll_payout_lines
  FOR EACH ROW
  WHEN (OLD.job_id IS DISTINCT FROM NEW.job_id
        OR OLD.user_id IS DISTINCT FROM NEW.user_id
        OR OLD.participant_role IS DISTINCT FROM NEW.participant_role
        OR OLD.payroll_period_id IS DISTINCT FROM NEW.payroll_period_id)
  EXECUTE FUNCTION public.payroll_guard_payout_line_single_period();

-- 2. Lock claim -------------------------------------------------------------------

-- One UPDATE statement: under READ COMMITTED a concurrent claimer (or cancel holding
-- the row) is waited for and the WHERE is re-checked against the committed row, so
-- exactly one caller wins.
CREATE OR REPLACE FUNCTION public.payroll_claim_period_lock(p_org_id uuid, p_period_id uuid, p_token uuid)
RETURNS boolean
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  WITH claimed AS (
    UPDATE payroll_periods
    SET lock_claimed_at = now(), lock_claim_token = p_token
    WHERE id = p_period_id
      AND org_id = p_org_id
      AND status = 'open'
      -- 15 minutes: keep in sync with the cancel/reopen check below and with
      -- LOCK_CLAIM_STALE_MS in app/api/admin/payroll/periods/[periodId]/route.ts.
      AND (lock_claimed_at IS NULL OR lock_claimed_at < now() - interval '15 minutes')
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM claimed);
$$;

-- 3. Cancel / reopen --------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.payroll_cancel_or_reopen_period(
  p_org_id uuid,
  p_period_id uuid,
  p_action text,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_period payroll_periods%ROWTYPE;
  v_snapshots integer;
  v_applications integer;
  v_cleared jsonb;
  v_state_cleared integer := 0;
BEGIN
  IF p_action IS NULL OR p_action NOT IN ('cancel', 'reopen') THEN
    RAISE EXCEPTION 'payroll_cancel_or_reopen_period: invalid action %', p_action USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Row lock: a lock claim, a final lock flip, or another cancel/reopen waits for us.
  SELECT * INTO v_period FROM payroll_periods
  WHERE id = p_period_id AND org_id = p_org_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;

  -- 15 minutes: same window as payroll_claim_period_lock() above and LOCK_CLAIM_STALE_MS
  -- in app/api/admin/payroll/periods/[periodId]/route.ts. Change all three together.
  IF v_period.lock_claimed_at IS NOT NULL AND v_period.lock_claimed_at >= now() - interval '15 minutes' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'lock_in_progress');
  END IF;

  SELECT count(*) INTO v_snapshots FROM payroll_job_snapshots WHERE payroll_period_id = p_period_id;
  IF v_snapshots > 0 AND v_period.status <> 'open' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'period_has_payout_lines', 'snapshot_count', v_snapshots);
  END IF;

  -- Deleting lines would cascade-delete chargeback applications and leave the
  -- chargeback's remaining_amount wrong. There is no writer for these yet; refuse.
  SELECT count(*) INTO v_applications FROM payroll_chargeback_applications WHERE payroll_period_id = p_period_id;
  IF v_applications > 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'period_has_chargeback_applications', 'application_count', v_applications);
  END IF;

  IF v_snapshots > 0 THEN
    -- Only reachable for an OPEN period: rows left by a lock that never finished.
    -- Ids and counts only, NO amounts or payees: payroll_override_audit is readable
    -- org-wide (payroll_override_audit_org_select), so pay must not be copied into it.
    SELECT jsonb_agg(jsonb_build_object(
             'snapshot_id', s.id,
             'job_id', s.job_id,
             'line_ids', (SELECT coalesce(jsonb_agg(l.id), '[]'::jsonb)
                          FROM payroll_payout_lines l WHERE l.payroll_job_snapshot_id = s.id),
             'line_count', (SELECT count(*) FROM payroll_payout_lines l WHERE l.payroll_job_snapshot_id = s.id)))
      INTO v_cleared
    FROM payroll_job_snapshots s
    WHERE s.payroll_period_id = p_period_id;

    UPDATE job_payroll_state
    SET current_payroll_period_id = NULL, payroll_cutoff_at = NULL, scheduled_pay_date = NULL, updated_at = now()
    WHERE current_payroll_period_id = p_period_id
      AND job_id IN (SELECT job_id FROM payroll_job_snapshots WHERE payroll_period_id = p_period_id);
    GET DIAGNOSTICS v_state_cleared = ROW_COUNT;

    DELETE FROM payroll_job_snapshots WHERE payroll_period_id = p_period_id;  -- lines cascade

    -- Reuses the existing payroll audit table. job_id is NULL and after_value has no
    -- role, so the per-job override register never matches this row.
    INSERT INTO payroll_override_audit
      (org_id, override_type, job_id, payroll_period_id, actor_user_id, reason, before_value, after_value)
    VALUES (
      p_org_id, 'manual_adjustment', NULL, p_period_id, p_actor_user_id,
      format('Period %s cleared %s job snapshot(s) left by a lock that never completed', p_action, v_snapshots),
      jsonb_build_object('period_id', p_period_id, 'period_status', v_period.status, 'snapshots', v_cleared),
      jsonb_build_object('action', 'period_' || p_action || '_cleared_partial_lock',
                         'snapshots_deleted', v_snapshots, 'job_payroll_state_cleared', v_state_cleared)
    );
  END IF;

  IF p_action = 'cancel' THEN
    UPDATE payroll_periods
    SET status = 'cancelled', lock_claimed_at = NULL, lock_claim_token = NULL
    WHERE id = p_period_id;
  ELSE
    UPDATE payroll_periods
    SET status = 'open', locked_at = NULL, paid_at = NULL, lock_claimed_at = NULL, lock_claim_token = NULL
    WHERE id = p_period_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'snapshots_deleted', v_snapshots, 'job_payroll_state_cleared', v_state_cleared);
END;
$$;

-- 4. Atomic lineless-snapshot cleanup ---------------------------------------------

CREATE OR REPLACE FUNCTION public.payroll_discard_lineless_job_snapshot(p_org_id uuid, p_snapshot_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_job uuid;
  v_deleted integer;
BEGIN
  SELECT job_id INTO v_job FROM payroll_job_snapshots WHERE id = p_snapshot_id AND org_id = p_org_id;
  IF v_job IS NULL THEN
    RETURN false;
  END IF;
  -- Same lock the line-insert trigger takes: an in-flight line insert for this job
  -- commits first, and the DELETE below (a new statement) then sees its lines.
  PERFORM pg_advisory_xact_lock(hashtextextended('payroll_job:' || v_job::text, 0));
  DELETE FROM payroll_job_snapshots s
  WHERE s.id = p_snapshot_id
    AND s.org_id = p_org_id
    AND NOT EXISTS (SELECT 1 FROM payroll_payout_lines l WHERE l.payroll_job_snapshot_id = s.id);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted > 0;
END;
$$;

-- Privileges: only the server (service_role) calls these.
REVOKE ALL ON FUNCTION public.payroll_guard_job_snapshot_single_period() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.payroll_guard_payout_line_single_period() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.payroll_claim_period_lock(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.payroll_cancel_or_reopen_period(uuid, uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.payroll_discard_lineless_job_snapshot(uuid, uuid) FROM PUBLIC;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.payroll_guard_job_snapshot_single_period() FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION public.payroll_guard_payout_line_single_period() FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION public.payroll_claim_period_lock(uuid, uuid, uuid) FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION public.payroll_cancel_or_reopen_period(uuid, uuid, text, uuid) FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION public.payroll_discard_lineless_job_snapshot(uuid, uuid) FROM %I', r);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.payroll_claim_period_lock(uuid, uuid, uuid) TO service_role;
    GRANT EXECUTE ON FUNCTION public.payroll_cancel_or_reopen_period(uuid, uuid, text, uuid) TO service_role;
    GRANT EXECUTE ON FUNCTION public.payroll_discard_lineless_job_snapshot(uuid, uuid) TO service_role;
  END IF;
END $$;

-- The claim columns are server-internal. anon/authenticated hold table-level SELECT on
-- payroll_periods, and a column-level REVOKE does nothing while a table-level grant
-- exists, so: revoke table SELECT and grant SELECT on the 10 pre-existing columns
-- only. RLS (payroll_periods_org_select) is unchanged. Every user-credential reader
-- (app/sisu/page.tsx) selects explicit columns; the rest use the service role.
-- NOTE: a column added to payroll_periods later is NOT readable by anon/authenticated
-- until it is added to this grant.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE SELECT ON public.payroll_periods FROM %I', r);
      EXECUTE format(
        'GRANT SELECT (id, org_id, period_label, cutoff_at, lock_at, scheduled_pay_date, status, locked_at, paid_at, created_at) ON public.payroll_periods TO %I',
        r);
    END IF;
  END LOOP;
END $$;

-- Rollback (run manually if needed; touches no payroll data, only drops the claim columns):
--   DROP TRIGGER IF EXISTS trg_payroll_job_snapshots_single_period_ins ON public.payroll_job_snapshots;
--   DROP TRIGGER IF EXISTS trg_payroll_job_snapshots_single_period_upd ON public.payroll_job_snapshots;
--   DROP TRIGGER IF EXISTS trg_payroll_payout_lines_single_period_ins ON public.payroll_payout_lines;
--   DROP TRIGGER IF EXISTS trg_payroll_payout_lines_single_period_upd ON public.payroll_payout_lines;
--   DROP FUNCTION IF EXISTS public.payroll_guard_job_snapshot_single_period();
--   DROP FUNCTION IF EXISTS public.payroll_guard_payout_line_single_period();
--   DROP FUNCTION IF EXISTS public.payroll_claim_period_lock(uuid, uuid, uuid);
--   DROP FUNCTION IF EXISTS public.payroll_cancel_or_reopen_period(uuid, uuid, text, uuid);
--   DROP FUNCTION IF EXISTS public.payroll_discard_lineless_job_snapshot(uuid, uuid);
--   ALTER TABLE public.payroll_periods DROP COLUMN IF EXISTS lock_claim_token;
--   ALTER TABLE public.payroll_periods DROP COLUMN IF EXISTS lock_claimed_at;
--   GRANT SELECT ON public.payroll_periods TO anon, authenticated;   -- restores the table-level grant
-- (Roll the app back first: the app calls these functions and columns.)
-- NOT restored by rollback: snapshots + payout lines that payroll_cancel_or_reopen_period()
-- deleted from an OPEN period (debris of a lock that never completed) are gone for good.
-- The only record of them is the id list in that run's payroll_override_audit row
-- (before_value.snapshots[].snapshot_id / job_id / line_ids / line_count). It holds no
-- amounts or payees, so the rows can't be rebuilt from it; re-locking the period
-- regenerates them from current job data, which is the intended recovery.
-- Find them: SELECT * FROM payroll_override_audit WHERE after_value->>'action' LIKE 'period_%_cleared_partial_lock';
