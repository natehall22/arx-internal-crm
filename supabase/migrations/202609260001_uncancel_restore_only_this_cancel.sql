-- Uncancel restored every sale agreement voided at or after the cancel. Since
-- 2026-09-26 contract create/sign VOID superseded agreements instead of deleting
-- them, so a contract replaced after a cancel would also have been restored.
-- Match the cancel's own transaction timestamp exactly instead.
-- Function replacement only; no table changes.

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
    -- Only what THIS cancel voided: same transaction, so the updated_at trigger
    -- stamped exactly cancelled_at. Anything voided later (a contract replaced
    -- after the cancel — voiding replaced the old hard-delete on 2026-09-26) or by
    -- an earlier cancel was superseded, and restoring it would count a sale twice.
    AND updated_at = v_job.cancelled_at
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

REVOKE ALL ON FUNCTION public.uncancel_production_job(UUID, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.uncancel_production_job(UUID, UUID, UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.uncancel_production_job(UUID, UUID, UUID) TO service_role;
