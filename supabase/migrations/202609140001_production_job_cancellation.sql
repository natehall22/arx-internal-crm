-- Job cancellation: a sold job that will never be installed (financing declined
-- on DTI after approval, customer backs out before install).
--
-- Before this there was no cancelled state anywhere in the chain — job, project
-- and contract all stayed "sold/completed", so a dead deal kept counting as a
-- sale and stayed on the ops board.
--
-- The sale itself is counted from `order_form_contracts.status = 'completed'` in
-- ~20 app readers and 4 dashboard RPCs. Rather than teach each of those about
-- jobs, a cancel voids the sale agreement using the `voided` status that already
-- exists (and that the signing page + sign API already refuse). The job carries
-- the why: a required reason code, so cancels can be tracked and — for credit
-- fails — worked again later.
--
-- The opportunity is deliberately left alone (Nathan, 2026-09-14).
--
-- Additive only: widened CHECK, four nullable columns, one enum value, two
-- service-role-only functions.

ALTER TABLE production_jobs DROP CONSTRAINT IF EXISTS production_jobs_status_check;
ALTER TABLE production_jobs ADD CONSTRAINT production_jobs_status_check CHECK (
  status = ANY (ARRAY['sold', 'materials', 'scheduled', 'in_progress', 'complete', 'collected', 'on_hold', 'cancelled'])
);

ALTER TABLE production_jobs
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS cancelled_by_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT NULL,
  ADD COLUMN IF NOT EXISTS cancellation_notes TEXT NULL;

-- Keep in sync with JOB_CANCELLATION_REASONS in lib/job-status.ts.
ALTER TABLE production_jobs DROP CONSTRAINT IF EXISTS production_jobs_cancellation_reason_check;
ALTER TABLE production_jobs ADD CONSTRAINT production_jobs_cancellation_reason_check CHECK (
  cancellation_reason IS NULL
  OR cancellation_reason IN ('credit_fail', 'customer_backed_out', 'insurance_denied', 'other')
);

-- A cancelled job always says when and why; "other" must say what.
ALTER TABLE production_jobs DROP CONSTRAINT IF EXISTS production_jobs_cancellation_recorded;
ALTER TABLE production_jobs ADD CONSTRAINT production_jobs_cancellation_recorded CHECK (
  status <> 'cancelled'
  OR (
    cancelled_at IS NOT NULL
    AND cancellation_reason IS NOT NULL
    AND (cancellation_reason <> 'other' OR length(btrim(COALESCE(cancellation_notes, ''))) > 0)
  )
);

ALTER TYPE project_status ADD VALUE IF NOT EXISTS 'cancelled';

-- All writes of a cancel in one transaction: a job marked cancelled whose
-- contract was not voided would disappear from ops but still count as a sale.
CREATE OR REPLACE FUNCTION public.cancel_production_job(
  p_org_id UUID,
  p_job_id UUID,
  p_user_id UUID,
  p_reason TEXT,
  p_notes TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_job production_jobs%ROWTYPE;
  v_notes TEXT := NULLIF(btrim(COALESCE(p_notes, '')), '');
  v_opportunity_id UUID;
  v_contracts_voided INT := 0;
BEGIN
  IF p_reason IS NULL OR p_reason NOT IN ('credit_fail', 'customer_backed_out', 'insurance_denied', 'other') THEN
    RAISE EXCEPTION 'Pick a cancellation reason';
  END IF;
  IF p_reason = 'other' AND v_notes IS NULL THEN
    RAISE EXCEPTION 'Describe the reason when it is "Other"';
  END IF;

  SELECT * INTO v_job
  FROM production_jobs
  WHERE id = p_job_id AND org_id = p_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_job.status = 'cancelled' THEN
    RAISE EXCEPTION 'This job is already cancelled';
  END IF;
  IF v_job.status IN ('complete', 'collected') THEN
    RAISE EXCEPTION 'This job has been installed and cannot be cancelled';
  END IF;
  -- Money already went out: that is a chargeback, not a status change.
  IF v_job.payroll_sent_at IS NOT NULL
    OR EXISTS (SELECT 1 FROM payroll_payout_lines WHERE job_id = p_job_id)
    OR EXISTS (
      SELECT 1 FROM job_payroll_state
      WHERE job_id = p_job_id AND (locked_at IS NOT NULL OR paid_at IS NOT NULL)
    )
  THEN
    RAISE EXCEPTION 'Commission on this job has already gone to payroll — handle it as a chargeback';
  END IF;

  -- Pull it off the install schedule too; the caller removes the Google event
  -- using the ids returned below.
  UPDATE production_jobs
  SET status = 'cancelled',
      cancelled_at = now(),
      cancelled_by_user_id = p_user_id,
      cancellation_reason = p_reason,
      cancellation_notes = v_notes,
      scheduled_date = NULL,
      install_days = NULL,
      assigned_sub_id = NULL,
      assigned_crew_id = NULL
  WHERE id = p_job_id AND org_id = p_org_id;

  IF v_job.project_id IS NOT NULL THEN
    UPDATE projects
    SET status = 'cancelled'
    WHERE id = v_job.project_id AND org_id = p_org_id
    RETURNING opportunity_id INTO v_opportunity_id;
  END IF;

  -- Sale agreements only — an insurance contingency is not the sale.
  UPDATE order_form_contracts
  SET status = 'voided'
  WHERE org_id = p_org_id
    AND agreement_type IN ('installation', 'repair')
    AND status <> 'voided'
    AND (
      (v_opportunity_id IS NOT NULL AND opportunity_id = v_opportunity_id)
      OR (v_job.accepted_proposal_id IS NOT NULL AND proposal_id = v_job.accepted_proposal_id)
    );
  GET DIAGNOSTICS v_contracts_voided = ROW_COUNT;

  INSERT INTO production_job_notes (job_id, user_id, note, is_internal)
  VALUES (
    p_job_id,
    p_user_id,
    'Job cancelled (was ' || v_job.status || '): ' || p_reason || COALESCE(' — ' || v_notes, ''),
    true
  );

  RETURN jsonb_build_object(
    'job_id', v_job.id,
    'job_number', v_job.job_number,
    'previous_status', v_job.status,
    'contracts_voided', v_contracts_voided,
    -- Pre-cancel install fields, for removing the sub's calendar invite.
    'address_text', v_job.address_text,
    'scheduled_date', v_job.scheduled_date,
    'install_days', v_job.install_days,
    'install_google_event_id', v_job.install_google_event_id,
    'install_calendar_id', v_job.install_calendar_id
  );
END;
$$;

-- Undo a cancel made by mistake (admin/owner only, enforced by the API route).
-- Puts the sale agreement back — signed ones to completed, unsigned ones to
-- pending — so it counts as a sale again. The job returns to `sold`, not its
-- old status: the cancel cleared the install schedule, so "scheduled" would be
-- a lie.
CREATE OR REPLACE FUNCTION public.uncancel_production_job(
  p_org_id UUID,
  p_job_id UUID,
  p_user_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_job production_jobs%ROWTYPE;
  v_opportunity_id UUID;
  v_contracts_restored INT := 0;
BEGIN
  SELECT * INTO v_job
  FROM production_jobs
  WHERE id = p_job_id AND org_id = p_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_job.status <> 'cancelled' THEN
    RAISE EXCEPTION 'This job is not cancelled';
  END IF;

  UPDATE production_jobs
  SET status = 'sold',
      cancelled_at = NULL,
      cancelled_by_user_id = NULL,
      cancellation_reason = NULL,
      cancellation_notes = NULL
  WHERE id = p_job_id AND org_id = p_org_id;

  IF v_job.project_id IS NOT NULL THEN
    UPDATE projects
    SET status = 'in_progress'
    WHERE id = v_job.project_id AND org_id = p_org_id
    RETURNING opportunity_id INTO v_opportunity_id;
  END IF;

  UPDATE order_form_contracts
  SET status = CASE WHEN customer_signed_at IS NOT NULL THEN 'completed' ELSE 'pending_customer' END::contract_signing_status
  WHERE org_id = p_org_id
    AND agreement_type IN ('installation', 'repair')
    AND status = 'voided'
    -- Only what THIS cancel voided (same transaction → updated_at = cancelled_at).
    -- An agreement voided by an earlier cancel was superseded by a re-sign, and
    -- restoring it too would count the sale twice.
    AND updated_at >= v_job.cancelled_at
    AND (
      (v_opportunity_id IS NOT NULL AND opportunity_id = v_opportunity_id)
      OR (v_job.accepted_proposal_id IS NOT NULL AND proposal_id = v_job.accepted_proposal_id)
    );
  GET DIAGNOSTICS v_contracts_restored = ROW_COUNT;

  INSERT INTO production_job_notes (job_id, user_id, note, is_internal)
  VALUES (
    p_job_id,
    p_user_id,
    'Cancellation undone (was: ' || COALESCE(v_job.cancellation_reason, 'no reason')
      || COALESCE(' — ' || v_job.cancellation_notes, '') || ')',
    true
  );

  RETURN jsonb_build_object('job_id', v_job.id, 'contracts_restored', v_contracts_restored);
END;
$$;

-- Called only by the API routes through the service-role client. Never expose
-- these to PostgREST callers: they take org/user ids as arguments.
REVOKE ALL ON FUNCTION public.cancel_production_job(UUID, UUID, UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_production_job(UUID, UUID, UUID, TEXT, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_production_job(UUID, UUID, UUID, TEXT, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.uncancel_production_job(UUID, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.uncancel_production_job(UUID, UUID, UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.uncancel_production_job(UUID, UUID, UUID) TO service_role;
