-- Body of the DB test for migration 202610280010 (payroll atomic approve). It is the body of ONE DO block that ends in an
-- unconditional RAISE EXCEPTION carrying the report, so on any database it can only ever be rolled back (the rehearsal wraps
-- and runs it). Needs: an org with >= 2 active users and at least one production_jobs row to copy.
DECLARE
  v_org uuid; v_u1 uuid; v_u2 uuid; v_tpl production_jobs%ROWTYPE;
  v_report text := '';
  v_tok uuid; v_res jsonb; v_cnt int; v_err text; v_ok boolean; v_plan jsonb;
  P0 uuid := gen_random_uuid(); P1 uuid := gen_random_uuid(); P2 uuid := gen_random_uuid(); P3 uuid := gen_random_uuid();
  P4 uuid := gen_random_uuid(); P5 uuid := gen_random_uuid(); P6 uuid := gen_random_uuid(); P7 uuid := gen_random_uuid();
  J1 uuid := gen_random_uuid(); J2 uuid := gen_random_uuid(); J3 uuid := gen_random_uuid(); J4 uuid := gen_random_uuid(); J5 uuid := gen_random_uuid(); J6 uuid := gen_random_uuid();
BEGIN
  SELECT org_id, id INTO v_org, v_u1 FROM users WHERE active ORDER BY created_at LIMIT 1;
  SELECT id INTO v_u2 FROM users WHERE org_id = v_org AND id <> v_u1 AND active ORDER BY created_at LIMIT 1;
  SELECT * INTO v_tpl FROM production_jobs WHERE org_id = v_org ORDER BY created_at LIMIT 1;
  IF v_u2 IS NULL OR v_tpl.id IS NULL THEN RAISE EXCEPTION 'TEST SETUP: need an org with 2 users and a job'; END IF;

  INSERT INTO payroll_periods (id, org_id, period_label, cutoff_at, lock_at, scheduled_pay_date) VALUES
    (P0, v_org, 'T0', '2030-01-02 04:59:59+00', '2030-01-02 04:59:59+00', '2030-01-04'),
    (P1, v_org, 'T1', '2030-02-06 04:59:59+00', '2030-02-06 04:59:59+00', '2030-02-08'),
    (P2, v_org, 'T2', '2030-02-13 04:59:59+00', '2030-02-13 04:59:59+00', '2030-02-15'),
    (P3, v_org, 'T3', '2030-02-20 04:59:59+00', '2030-02-20 04:59:59+00', '2030-02-22'),
    (P4, v_org, 'T4', '2030-02-27 04:59:59+00', '2030-02-27 04:59:59+00', '2030-03-01'),
    (P5, v_org, 'T5', '2030-03-06 04:59:59+00', '2030-03-06 04:59:59+00', '2030-03-08'),
    (P6, v_org, 'T6', '2030-03-13 04:59:59+00', '2030-03-13 04:59:59+00', '2030-03-15'),
    (P7, v_org, 'T7', '2030-03-20 04:59:59+00', '2030-03-20 04:59:59+00', '2030-03-22');
  INSERT INTO production_jobs
    SELECT (jsonb_populate_record(NULL::production_jobs, to_jsonb(v_tpl) || jsonb_build_object('id', j.id, 'job_number', 'TESTJ-' || j.n, 'status', 'complete', 'sale_amount', 1000, 'commission_comp_base', 1000, 'payroll_settled_externally_at', NULL))).*
    FROM (VALUES (J1, 1), (J2, 2), (J3, 3), (J4, 4), (J5, 5), (J6, 6)) AS j(id, n);

  -- ===== T1: a claimed week refuses hours / bonus / fix writers (trigger); other weeks and a released week do not =====
  v_tok := gen_random_uuid();
  IF NOT payroll_claim_period_lock(v_org, P1, v_tok) THEN RAISE EXCEPTION 'T1 claim failed'; END IF;
  v_ok := false;
  BEGIN INSERT INTO payroll_rep_hours (org_id, payroll_period_id, user_id, regular_hours, hourly_earnings) VALUES (v_org, P1, v_u1, 1, 10);
  EXCEPTION WHEN SQLSTATE '55006' THEN v_ok := true; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'T1a hours write was NOT refused under a live claim'; END IF;
  v_ok := false;
  BEGIN INSERT INTO payroll_bonus_lines (org_id, payroll_period_id, user_id, bonus_type, amount) VALUES (v_org, P1, v_u1, 'manual', 5);
  EXCEPTION WHEN SQLSTATE '55006' THEN v_ok := true; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'T1b bonus write was NOT refused under a live claim'; END IF;
  v_ok := false;
  BEGIN INSERT INTO payroll_adjustments (org_id, payroll_period_id, user_id, amount, reason) VALUES (v_org, P1, v_u1, 5, 'x');
  EXCEPTION WHEN SQLSTATE '55006' THEN v_ok := true; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'T1c fix write was NOT refused under a live claim'; END IF;
  INSERT INTO payroll_rep_hours (org_id, payroll_period_id, user_id, regular_hours, hourly_earnings) VALUES (v_org, P2, v_u1, 1, 10);
  UPDATE payroll_periods SET lock_claimed_at = NULL, lock_claim_token = NULL WHERE id = P1;
  INSERT INTO payroll_rep_hours (org_id, payroll_period_id, user_id, regular_hours, hourly_earnings) VALUES (v_org, P1, v_u1, 1, 10);
  DELETE FROM payroll_rep_hours WHERE payroll_period_id IN (P1, P2);
  v_report := v_report || E'\nT1 OK: hours/bonus/fix writes refused under a live claim (SQLSTATE 55006); allowed on another week and after release';

  -- ===== T2: success writes everything and locks =====
  v_tok := gen_random_uuid(); PERFORM payroll_claim_period_lock(v_org, P1, v_tok);
  v_plan := jsonb_build_object('jobs', jsonb_build_array(jsonb_build_object('job_id', J1, 'sale_amount', 1000, 'commission_comp_base', 1000,
      'snapshot', jsonb_build_object('org_id', v_org, 'payroll_period_id', P1, 'job_id', J1, 'contract_total', 1000, 'commission_base', 1000, 'gross_payout_total', 150, 'net_payout_total', 150, 'participants', '[]'::jsonb, 'payload', '{}'::jsonb),
      'lines', jsonb_build_array(
        jsonb_build_object('org_id', v_org, 'payroll_period_id', P1, 'job_id', J1, 'user_id', v_u1, 'participant_role', 'sales_rep', 'gross_amount', 100, 'net_amount', 100, 'chargeback_applied_amount', 0, 'comp_plan_snapshot', '{}'::jsonb),
        jsonb_build_object('org_id', v_org, 'payroll_period_id', P1, 'job_id', J1, 'user_id', v_u2, 'participant_role', 'setter', 'gross_amount', 50, 'net_amount', 50, 'chargeback_applied_amount', 0, 'comp_plan_snapshot', '{}'::jsonb)),
      'state', jsonb_build_object('job_id', J1, 'org_id', v_org, 'payroll_eligible_at', '2030-02-01T00:00:00Z', 'payroll_cutoff_at', '2030-02-06T04:59:59Z', 'scheduled_pay_date', '2030-02-08'))),
    'units', jsonb_build_array(jsonb_build_object('user_id', v_u2, 'amount', 10, 'detail', jsonb_build_object('total', 10))));
  v_res := payroll_commit_week(v_org, P1, v_tok, v_u1, 160, NULL, v_plan);
  IF (v_res->>'total')::numeric <> 160 OR (v_res->>'lines')::int <> 2 THEN RAISE EXCEPTION 'T2 summary wrong: %', v_res; END IF;
  SELECT count(*) INTO v_cnt FROM payroll_payout_lines WHERE payroll_period_id = P1; IF v_cnt <> 2 THEN RAISE EXCEPTION 'T2 lines %', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM payroll_job_snapshots WHERE payroll_period_id = P1; IF v_cnt <> 1 THEN RAISE EXCEPTION 'T2 snapshots %', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM payroll_unit_earnings WHERE payroll_period_id = P1 AND amount = 10; IF v_cnt <> 1 THEN RAISE EXCEPTION 'T2 units %', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM job_payroll_state WHERE job_id = J1 AND current_payroll_period_id = P1; IF v_cnt <> 1 THEN RAISE EXCEPTION 'T2 state %', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM payroll_periods WHERE id = P1 AND status = 'locked' AND lock_claim_token IS NULL AND units_frozen_at IS NOT NULL; IF v_cnt <> 1 THEN RAISE EXCEPTION 'T2 period not locked/cleared'; END IF;
  v_report := v_report || E'\nT2 OK: snapshot + 2 lines + job state + frozen per-unit pay written, period locked, claim cleared, total 160';

  -- ===== T3: wrong approved total -> everything rolls back =====
  v_tok := gen_random_uuid(); PERFORM payroll_claim_period_lock(v_org, P2, v_tok);
  v_plan := jsonb_build_object('jobs', jsonb_build_array(jsonb_build_object('job_id', J2, 'sale_amount', 1000, 'commission_comp_base', 1000,
      'snapshot', jsonb_build_object('org_id', v_org, 'payroll_period_id', P2, 'job_id', J2, 'participants', '[]'::jsonb),
      'lines', jsonb_build_array(jsonb_build_object('org_id', v_org, 'payroll_period_id', P2, 'job_id', J2, 'user_id', v_u1, 'participant_role', 'sales_rep', 'gross_amount', 100, 'net_amount', 100)),
      'state', jsonb_build_object('job_id', J2, 'org_id', v_org))), 'units', '[]'::jsonb);
  v_err := NULL;
  BEGIN PERFORM payroll_commit_week(v_org, P2, v_tok, v_u1, 999, NULL, v_plan);
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err IS NULL OR v_err NOT LIKE 'payroll_commit:total_mismatch%' THEN RAISE EXCEPTION 'T3 expected total_mismatch, got %', v_err; END IF;
  SELECT count(*) INTO v_cnt FROM payroll_job_snapshots WHERE payroll_period_id = P2; IF v_cnt <> 0 THEN RAISE EXCEPTION 'T3 snapshot survived the rollback'; END IF;
  SELECT count(*) INTO v_cnt FROM payroll_payout_lines WHERE payroll_period_id = P2; IF v_cnt <> 0 THEN RAISE EXCEPTION 'T3 lines survived the rollback'; END IF;
  SELECT count(*) INTO v_cnt FROM payroll_periods WHERE id = P2 AND status = 'open'; IF v_cnt <> 1 THEN RAISE EXCEPTION 'T3 period not still open'; END IF;
  v_report := v_report || E'\nT3 OK: wrong approved total refused ("' || v_err || '"), no snapshot/lines survived, period still open';
  UPDATE payroll_periods SET lock_claimed_at = NULL, lock_claim_token = NULL WHERE id = P2;

  -- ===== T4: a negative person is carried to next week exactly once; the week's fix is marked applied =====
  INSERT INTO payroll_adjustments (org_id, payroll_period_id, user_id, amount, reason) VALUES (v_org, P3, v_u2, -30, 'clawback');
  v_tok := gen_random_uuid(); PERFORM payroll_claim_period_lock(v_org, P3, v_tok);
  v_plan := jsonb_build_object('jobs', jsonb_build_array(jsonb_build_object('job_id', J3, 'sale_amount', 1000, 'commission_comp_base', 1000,
      'snapshot', jsonb_build_object('org_id', v_org, 'payroll_period_id', P3, 'job_id', J3, 'participants', '[]'::jsonb),
      'lines', jsonb_build_array(jsonb_build_object('org_id', v_org, 'payroll_period_id', P3, 'job_id', J3, 'user_id', v_u1, 'participant_role', 'sales_rep', 'gross_amount', 100, 'net_amount', 100)),
      'state', jsonb_build_object('job_id', J3, 'org_id', v_org))), 'units', '[]'::jsonb);
  v_res := payroll_commit_week(v_org, P3, v_tok, v_u1, 100, P4, v_plan);  -- the $0-floored person is not in the total
  IF (v_res->>'carried')::int <> 1 OR (v_res->>'total')::numeric <> 100 THEN RAISE EXCEPTION 'T4 summary: %', v_res; END IF;
  SELECT count(*) INTO v_cnt FROM payroll_adjustments WHERE kind = 'balance' AND source_period_id = P3 AND user_id = v_u2 AND amount = -30 AND payroll_period_id = P4 AND status = 'pending';
  IF v_cnt <> 1 THEN RAISE EXCEPTION 'T4 balance not carried to next week'; END IF;
  SELECT count(*) INTO v_cnt FROM payroll_adjustments WHERE payroll_period_id = P3 AND status = 'applied'; IF v_cnt <> 1 THEN RAISE EXCEPTION 'T4 fix not marked applied'; END IF;
  v_report := v_report || E'\nT4 OK: -$30 carried to next week once (pending balance on the next period), the week''s fix marked applied, total 100';

  -- ===== T5: a $0 week with a job to snapshot still approves =====
  UPDATE payroll_adjustments SET status = 'applied' WHERE payroll_period_id = P4;   -- next week's carried balance is settled first (T8 covers the refusal)
  v_tok := gen_random_uuid(); PERFORM payroll_claim_period_lock(v_org, P5, v_tok);
  v_plan := jsonb_build_object('jobs', jsonb_build_array(jsonb_build_object('job_id', J4, 'sale_amount', 1000, 'commission_comp_base', 1000,
      'snapshot', jsonb_build_object('org_id', v_org, 'payroll_period_id', P5, 'job_id', J4, 'participants', '[]'::jsonb),
      'lines', jsonb_build_array(jsonb_build_object('org_id', v_org, 'payroll_period_id', P5, 'job_id', J4, 'user_id', v_u1, 'participant_role', 'sales_rep', 'gross_amount', 0, 'net_amount', 0)),
      'state', jsonb_build_object('job_id', J4, 'org_id', v_org))), 'units', '[]'::jsonb);
  v_res := payroll_commit_week(v_org, P5, v_tok, v_u1, 0, NULL, v_plan);
  SELECT count(*) INTO v_cnt FROM payroll_job_snapshots WHERE payroll_period_id = P5; IF v_cnt <> 1 THEN RAISE EXCEPTION 'T5 snapshot missing'; END IF;
  SELECT count(*) INTO v_cnt FROM payroll_periods WHERE id = P5 AND status = 'locked'; IF v_cnt <> 1 THEN RAISE EXCEPTION 'T5 not locked'; END IF;
  v_report := v_report || E'\nT5 OK: a $0 week with a snapshot to write approves and locks';

  -- ===== T6: a live job that no longer matches the plan refuses (job_changed) and rolls back =====
  v_tok := gen_random_uuid(); PERFORM payroll_claim_period_lock(v_org, P6, v_tok);
  UPDATE production_jobs SET sale_amount = 999 WHERE id = J5;
  v_plan := jsonb_build_object('jobs', jsonb_build_array(jsonb_build_object('job_id', J5, 'sale_amount', 1000, 'commission_comp_base', 1000,
      'snapshot', jsonb_build_object('org_id', v_org, 'payroll_period_id', P6, 'job_id', J5, 'participants', '[]'::jsonb),
      'lines', jsonb_build_array(jsonb_build_object('org_id', v_org, 'payroll_period_id', P6, 'job_id', J5, 'user_id', v_u1, 'participant_role', 'sales_rep', 'gross_amount', 10, 'net_amount', 10)),
      'state', jsonb_build_object('job_id', J5, 'org_id', v_org))), 'units', '[]'::jsonb);
  v_err := NULL;
  BEGIN PERFORM payroll_commit_week(v_org, P6, v_tok, v_u1, 10, NULL, v_plan);
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err IS NULL OR v_err NOT LIKE 'payroll_commit:job_changed%' THEN RAISE EXCEPTION 'T6 expected job_changed, got %', v_err; END IF;
  SELECT count(*) INTO v_cnt FROM payroll_payout_lines WHERE payroll_period_id = P6; IF v_cnt <> 0 THEN RAISE EXCEPTION 'T6 lines survived'; END IF;
  v_report := v_report || E'\nT6 OK: job changed after the plan was computed -> refused, nothing written';
  UPDATE payroll_periods SET lock_claimed_at = NULL, lock_claim_token = NULL WHERE id = P6;

  -- ===== T7: a wrong claim token cannot commit =====
  PERFORM payroll_claim_period_lock(v_org, P7, gen_random_uuid());
  v_err := NULL;
  BEGIN PERFORM payroll_commit_week(v_org, P7, gen_random_uuid(), v_u1, 0, NULL, '{"jobs":[],"units":[]}'::jsonb);
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err IS NULL OR v_err NOT LIKE 'payroll_commit:claim_lost%' THEN RAISE EXCEPTION 'T7 expected claim_lost, got %', v_err; END IF;
  v_report := v_report || E'\nT7 OK: commit without the claim token refused (claim_lost)';
  UPDATE payroll_periods SET lock_claimed_at = NULL, lock_claim_token = NULL WHERE id = P7;

  -- ===== T8: approving a LATER week while an EARLIER open week has pending fixes is refused =====
  INSERT INTO payroll_adjustments (org_id, payroll_period_id, user_id, amount, reason) VALUES (v_org, P0, v_u1, 5, 'stranded fix');
  v_tok := gen_random_uuid(); PERFORM payroll_claim_period_lock(v_org, P7, v_tok);
  v_err := NULL;
  BEGIN PERFORM payroll_commit_week(v_org, P7, v_tok, v_u1, 0, NULL, '{"jobs":[],"units":[]}'::jsonb);
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err IS NULL OR v_err NOT LIKE 'payroll_commit:earlier_week_open%' THEN RAISE EXCEPTION 'T8 expected earlier_week_open, got %', v_err; END IF;
  v_report := v_report || E'\nT8 OK: later week refused while an earlier open week has a pending fix';

  RAISE EXCEPTION E'REPORT (rolled back by design):%', v_report;
END
