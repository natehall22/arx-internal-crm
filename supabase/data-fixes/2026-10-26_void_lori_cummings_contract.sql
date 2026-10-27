-- Lori Cummings (opportunity a2e98961-4de2-4aa4-b93e-fdce58d3e6e2): she cancelled after signing (contract b30e08c9, signed 2026-03-07,
-- $11,722.48) but it was never recorded. She has no project and no job, so POST /api/ops/jobs/[id]/cancel cannot run. This does the
-- part of that route that applies without a job:
--   * the completed installation agreement becomes 'voided' (every sales/payroll reader filters on status = 'completed', so the sale
--     drops out of the totals on its own). The row and its PDF (pdf_url / pdf_storage_path) are KEPT, never deleted.
--   * the cancellation is logged, reason code 'other', note "Customer cancelled before job was created", as a team note on her deal
--     (the cancel route's own log is a job note, and she has no job).
--   * the OPPORTUNITY is left alone, exactly like the cancel route.
--
-- HOW THIS FILE RUNS (release_backups preview / apply / undo, same pattern as 2026-10-27_link_orphan_opportunities.sql):
--   1. Running the whole file only (re)creates functions + backup tables in the private schema `release_backups`, then calls the
--      PREVIEW: the contract, what it checks, the log line, and sales totals BEFORE and AFTER. Nothing existing changes.
--   2. Apply (one transaction; any failed check rolls everything back):   SELECT release_backups.void_unbuilt_contract('apply');
--   3. One-command undo:                                                   SELECT release_backups.undo_void_unbuilt_contract();
-- Undo only restores a contract that is STILL 'voided' and only removes the log note it wrote.
-- It refuses to run on a contract that has a project or a job (use the cancel route for those) or that is not completed.

CREATE SCHEMA IF NOT EXISTS release_backups;
REVOKE ALL ON SCHEMA release_backups FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON SCHEMA release_backups FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON SCHEMA release_backups FROM authenticated; END IF;
END $$;

CREATE TABLE IF NOT EXISTS release_backups.void_unbuilt_contracts (
  run_id           uuid        NOT NULL,
  contract_id      uuid        NOT NULL,
  org_id           uuid        NOT NULL,
  prev_status      text        NOT NULL,
  applied_status   text        NOT NULL,
  reason_code      text        NOT NULL,
  reason_notes     text        NULL,
  activity_id      uuid        NULL,                -- the log note this run wrote
  applied_at       timestamptz NOT NULL DEFAULT now(),
  undone_at        timestamptz NULL,
  PRIMARY KEY (run_id, contract_id)
);

-- Sales exactly as the dashboards count them: completed installation/repair agreements, by signing month (Eastern) and in total.
CREATE OR REPLACE FUNCTION release_backups.sales_totals(p_org uuid, p_month_of timestamptz) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'month', to_char(p_month_of AT TIME ZONE 'America/New_York', 'YYYY-MM'),
    'month_deals', count(*) FILTER (WHERE date_trunc('month', customer_signed_at AT TIME ZONE 'America/New_York') = date_trunc('month', p_month_of AT TIME ZONE 'America/New_York')),
    'month_sales', coalesce(sum(project_cost) FILTER (WHERE date_trunc('month', customer_signed_at AT TIME ZONE 'America/New_York') = date_trunc('month', p_month_of AT TIME ZONE 'America/New_York')), 0),
    'all_time_deals', count(*),
    'all_time_sales', coalesce(sum(project_cost), 0))
  FROM order_form_contracts
  WHERE org_id = p_org AND status = 'completed' AND agreement_type IN ('installation', 'repair');
$$;

CREATE OR REPLACE FUNCTION release_backups.void_unbuilt_contract(
  p_mode text DEFAULT 'preview',
  p_contract uuid DEFAULT 'b30e08c9-9348-42d5-8ab9-9430f6c69fc1',
  p_reason text DEFAULT 'other',
  p_notes text DEFAULT 'Customer cancelled before job was created'
) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_run uuid := gen_random_uuid();
  v_k order_form_contracts%ROWTYPE;
  v_notes text := NULLIF(btrim(coalesce(p_notes, '')), '');
  v_opp opportunities%ROWTYPE;
  v_projects int; v_jobs int;
  v_before jsonb; v_after jsonb; v_log text; v_activity uuid;
  v_opp_before text; v_opp_after text; v_pdf_before text; v_pdf_after text;
BEGIN
  IF p_mode NOT IN ('preview', 'apply') THEN RAISE EXCEPTION 'mode must be preview or apply'; END IF;
  -- same reason rules as cancel_production_job
  IF p_reason IS NULL OR p_reason NOT IN ('credit_fail', 'customer_backed_out', 'insurance_denied', 'other') THEN RAISE EXCEPTION 'Pick a cancellation reason'; END IF;
  IF p_reason = 'other' AND v_notes IS NULL THEN RAISE EXCEPTION 'Describe the reason when it is "Other"'; END IF;

  SELECT * INTO v_k FROM order_form_contracts WHERE id = p_contract FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'contract % not found', p_contract; END IF;
  IF v_k.status <> 'completed' THEN RAISE EXCEPTION 'contract is %, expected completed (already voided?)', v_k.status; END IF;
  IF v_k.agreement_type NOT IN ('installation', 'repair') THEN RAISE EXCEPTION 'not a sale agreement'; END IF;

  SELECT * INTO v_opp FROM opportunities WHERE id = v_k.opportunity_id AND org_id = v_k.org_id;
  SELECT count(*) INTO v_projects FROM projects WHERE org_id = v_k.org_id AND opportunity_id = v_k.opportunity_id;
  SELECT count(*) INTO v_jobs FROM production_jobs
   WHERE org_id = v_k.org_id AND (project_id IN (SELECT id FROM projects WHERE opportunity_id = v_k.opportunity_id)
                                  OR (v_k.proposal_id IS NOT NULL AND accepted_proposal_id = v_k.proposal_id));
  IF v_projects > 0 OR v_jobs > 0 THEN
    RAISE EXCEPTION 'this deal has % project(s) and % job(s): cancel it from the job page (cancel route), not with this fix', v_projects, v_jobs;
  END IF;

  v_log := 'Cancelled (reason: ' || p_reason || ')' || coalesce(' — ' || v_notes, '') || '. Agreement voided; the signed PDF is kept.';
  v_before := release_backups.sales_totals(v_k.org_id, v_k.customer_signed_at);

  IF p_mode = 'preview' THEN
    RETURN jsonb_build_object('mode', 'preview', 'wrote_nothing', true,
      'contract', jsonb_build_object('id', v_k.id, 'customer', v_k.customer_name, 'signed', v_k.customer_signed_at, 'amount', v_k.project_cost, 'status_now', v_k.status, 'status_after', 'voided', 'pdf_kept', v_k.pdf_storage_path),
      'checks', jsonb_build_object('projects', v_projects, 'jobs', v_jobs, 'opportunity_status_untouched', v_opp.status),
      'log_note', jsonb_build_object('reason_code', p_reason, 'notes', v_notes, 'text', v_log),
      'sales_before', v_before,
      'sales_after', jsonb_build_object('month', v_before->>'month',
        'month_deals', (v_before->>'month_deals')::int - 1, 'month_sales', (v_before->>'month_sales')::numeric - v_k.project_cost,
        'all_time_deals', (v_before->>'all_time_deals')::int - 1, 'all_time_sales', (v_before->>'all_time_sales')::numeric - v_k.project_cost));
  END IF;

  -- ---- apply: one function = one transaction; any failure rolls all of it back ----
  v_opp_before := to_jsonb(v_opp)::text;
  v_pdf_before := coalesce(v_k.pdf_url, '') || '|' || coalesce(v_k.pdf_storage_path, '');

  UPDATE order_form_contracts SET status = 'voided' WHERE id = p_contract AND status = 'completed';

  INSERT INTO activities (org_id, opportunity_id, customer_id, lead_id, user_id, type, body, origin, audience, source)
  VALUES (v_k.org_id, v_k.opportunity_id, v_opp.customer_id, v_opp.lead_id, v_k.created_by, 'note', v_log, 'system', 'team', 'system')
  RETURNING id INTO v_activity;

  INSERT INTO release_backups.void_unbuilt_contracts (run_id, contract_id, org_id, prev_status, applied_status, reason_code, reason_notes, activity_id)
  VALUES (v_run, p_contract, v_k.org_id, 'completed', 'voided', p_reason, v_notes, v_activity);

  v_after := release_backups.sales_totals(v_k.org_id, v_k.customer_signed_at);
  SELECT to_jsonb(o)::text INTO v_opp_after FROM opportunities o WHERE o.id = v_k.opportunity_id;
  SELECT coalesce(pdf_url, '') || '|' || coalesce(pdf_storage_path, '') INTO v_pdf_after FROM order_form_contracts WHERE id = p_contract;
  IF v_opp_after IS DISTINCT FROM v_opp_before THEN RAISE EXCEPTION 'void_unbuilt_contract: the opportunity changed; rolled back'; END IF;
  IF v_pdf_after IS DISTINCT FROM v_pdf_before OR v_pdf_after = '|' THEN RAISE EXCEPTION 'void_unbuilt_contract: the PDF reference changed; rolled back'; END IF;
  IF (v_after->>'all_time_deals')::int <> (v_before->>'all_time_deals')::int - 1 THEN RAISE EXCEPTION 'void_unbuilt_contract: sales did not drop by exactly one deal; rolled back'; END IF;

  RETURN jsonb_build_object('mode', 'apply', 'run_id', v_run, 'contract_status', 'voided', 'pdf_kept', v_k.pdf_storage_path, 'activity_id', v_activity,
                            'sales_before', v_before, 'sales_after', v_after, 'undo', 'SELECT release_backups.undo_void_unbuilt_contract();');
END;
$$;

CREATE OR REPLACE FUNCTION release_backups.undo_void_unbuilt_contract() RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_restored int := 0; v_changed int := 0; v_notes_removed int := 0; r record; n int;
BEGIN
  FOR r IN SELECT * FROM release_backups.void_unbuilt_contracts WHERE undone_at IS NULL LOOP
    UPDATE order_form_contracts SET status = r.prev_status::contract_signing_status WHERE id = r.contract_id AND status::text = r.applied_status;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN
      v_restored := v_restored + n;
      IF r.activity_id IS NOT NULL THEN
        DELETE FROM activities WHERE id = r.activity_id;
        GET DIAGNOSTICS n = ROW_COUNT;
        v_notes_removed := v_notes_removed + n;
      END IF;
      UPDATE release_backups.void_unbuilt_contracts SET undone_at = now() WHERE run_id = r.run_id AND contract_id = r.contract_id;
    ELSE
      v_changed := v_changed + 1;   -- no longer 'voided' (changed since): left exactly as it is
    END IF;
  END LOOP;
  RETURN jsonb_build_object('contracts_restored', v_restored, 'contracts_changed_since_left_alone', v_changed, 'log_notes_removed', v_notes_removed);
END;
$$;

-- Default action when this file is run: PREVIEW ONLY (writes nothing to any existing table).
SELECT release_backups.void_unbuilt_contract('preview');
-- To apply (after looking at the plan and the before/after sales above):   SELECT release_backups.void_unbuilt_contract('apply');
-- To undo, one command:                                                     SELECT release_backups.undo_void_unbuilt_contract();
