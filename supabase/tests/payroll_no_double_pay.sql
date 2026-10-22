-- DB tests for supabase/migrations/202610210002_payroll_no_cross_period_double_pay.sql
--
-- DESTRUCTIVE: drops and recreates schema public. Run ONLY through
-- supabase/tests/run-payroll-no-double-pay.sh, which creates a throwaway database
-- named payroll_guard_test_* and drops it afterwards. The guard below refuses to run
-- anywhere else.
\set ON_ERROR_STOP 1
DO $$ BEGIN
  IF current_database() NOT LIKE 'payroll_guard_test_%' THEN
    RAISE EXCEPTION 'refusing to run outside a payroll_guard_test_* database (got %)', current_database();
  END IF;
END $$;

\ir payroll_test_schema.sql

-- Fixture (ids: a=period, b=snapshot, c=job, d=user, e=org)
--   P1, P2 locked; P3 open; P4 open (partial lock debris); P5 open (chargeback app)
--   c1 = pre-existing duplicate in P1 AND P2 (like prod); c2 paid once in P1; c3 never paid
INSERT INTO payroll_periods (id, org_id, status) VALUES
 ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000e1','locked'),
 ('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000e1','locked'),
 ('00000000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-0000000000e1','open'),
 ('00000000-0000-0000-0000-0000000000a4','00000000-0000-0000-0000-0000000000e1','open'),
 ('00000000-0000-0000-0000-0000000000a5','00000000-0000-0000-0000-0000000000e1','open');
INSERT INTO payroll_job_snapshots (id, org_id, payroll_period_id, job_id) VALUES
 ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000c1'),
 ('00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000c1'),
 ('00000000-0000-0000-0000-0000000000b3','00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000c2');
INSERT INTO payroll_payout_lines (org_id, payroll_period_id, payroll_job_snapshot_id, job_id, user_id, participant_role, net_amount) VALUES
 ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000d1','sales_rep',100),
 ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000d1','sales_rep',100),
 ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b3','00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000d1','sales_rep',200);

-- Apply the real migration (on top of the duplicates), twice to prove it is re-runnable.
\ir ../migrations/202610210002_payroll_no_cross_period_double_pay.sql
\ir ../migrations/202610210002_payroll_no_cross_period_double_pay.sql

CREATE OR REPLACE FUNCTION pg_temp.expect_fail(sql text, label text, msg_prefix text DEFAULT 'payroll_already_paid:')
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE sql; EXCEPTION WHEN unique_violation OR check_violation THEN
    IF SQLERRM NOT LIKE msg_prefix || '%' THEN RAISE EXCEPTION 'FAIL % wrong error: %', label, SQLERRM; END IF;
    RAISE NOTICE 'PASS (rejected) %', label; RETURN; END;
  RAISE EXCEPTION 'FAIL % was allowed', label;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.expect(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'FAIL %', label; END IF; RAISE NOTICE 'PASS %', label; END $$;

-- ---- Single-period triggers ---------------------------------------------------
SELECT pg_temp.expect_fail($q$INSERT INTO payroll_job_snapshots (org_id,payroll_period_id,job_id) VALUES ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-0000000000c2')$q$, 'snapshot: paid job into another period');
SELECT pg_temp.expect_fail($q$INSERT INTO payroll_job_snapshots (org_id,payroll_period_id,job_id) VALUES ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-0000000000c2') ON CONFLICT (payroll_period_id,job_id) DO UPDATE SET net_payout_total=1$q$, 'snapshot: same via upsert');
SELECT pg_temp.expect_fail($q$UPDATE payroll_payout_lines SET payroll_period_id='00000000-0000-0000-0000-0000000000a3' WHERE job_id='00000000-0000-0000-0000-0000000000c2'$q$, 'line: moving key into another (open) period');
SELECT pg_temp.expect_fail($q$UPDATE payroll_payout_lines SET payroll_period_id='00000000-0000-0000-0000-0000000000a2' WHERE job_id='00000000-0000-0000-0000-0000000000c2'$q$, 'line: moving key into a LOCKED period', 'payroll_period_not_open:');
SELECT pg_temp.expect_fail($q$INSERT INTO payroll_job_snapshots (org_id,payroll_period_id,job_id) VALUES ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000c3')$q$, 'snapshot: new job into a LOCKED period', 'payroll_period_not_open:');

-- never-paid job into open P3, two roles: allowed; then into P2 rejected
INSERT INTO payroll_job_snapshots (id,org_id,payroll_period_id,job_id) VALUES ('00000000-0000-0000-0000-0000000000b4','00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-0000000000c3');
INSERT INTO payroll_payout_lines (org_id,payroll_period_id,payroll_job_snapshot_id,job_id,user_id,participant_role) VALUES
 ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-0000000000b4','00000000-0000-0000-0000-0000000000c3','00000000-0000-0000-0000-0000000000d1','sales_rep'),
 ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-0000000000b4','00000000-0000-0000-0000-0000000000c3','00000000-0000-0000-0000-0000000000d2','setter');
SELECT pg_temp.expect(true, 'never-paid job + two roles into open period allowed');
UPDATE payroll_periods SET status='open' WHERE id='00000000-0000-0000-0000-0000000000a2';
SELECT pg_temp.expect_fail($q$INSERT INTO payroll_job_snapshots (org_id,payroll_period_id,job_id) VALUES ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000c3')$q$, 'snapshot: c3 into P2 after P3');
UPDATE payroll_periods SET status='locked' WHERE id='00000000-0000-0000-0000-0000000000a2';

-- payout-line INSERT path on its own (snapshot trigger bypassed to isolate it)
ALTER TABLE payroll_job_snapshots DISABLE TRIGGER trg_payroll_job_snapshots_single_period_ins;
INSERT INTO payroll_job_snapshots (id,org_id,payroll_period_id,job_id) VALUES ('00000000-0000-0000-0000-0000000000b9','00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-0000000000c2');
ALTER TABLE payroll_job_snapshots ENABLE TRIGGER trg_payroll_job_snapshots_single_period_ins;
SELECT pg_temp.expect_fail($q$INSERT INTO payroll_payout_lines (org_id,payroll_period_id,payroll_job_snapshot_id,job_id,user_id,participant_role) VALUES ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-0000000000b9','00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000d1','sales_rep')$q$, 'line: paid job/user/role into another period');
SELECT pg_temp.expect_fail($q$INSERT INTO payroll_payout_lines (org_id,payroll_period_id,payroll_job_snapshot_id,job_id,user_id,participant_role) VALUES ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-0000000000b9','00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000d1','sales_rep') ON CONFLICT DO NOTHING$q$, 'line: same with ON CONFLICT DO NOTHING');
INSERT INTO payroll_payout_lines (org_id,payroll_period_id,payroll_job_snapshot_id,job_id,user_id,participant_role) VALUES ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-0000000000b9','00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000d1','inspector');
SELECT pg_temp.expect(true, 'line: different role on that job is a different key (allowed)');
DELETE FROM payroll_job_snapshots WHERE id='00000000-0000-0000-0000-0000000000b9';
SELECT pg_temp.expect((SELECT count(*) FROM payroll_payout_lines WHERE payroll_job_snapshot_id='00000000-0000-0000-0000-0000000000b9') = 0, 'deleting a snapshot cascades its lines');

-- same-period upsert on a PRE-EXISTING duplicate (c1 in P1 and P2, both locked): no new rows
INSERT INTO payroll_job_snapshots (org_id,payroll_period_id,job_id) VALUES ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000c1') ON CONFLICT (payroll_period_id,job_id) DO UPDATE SET net_payout_total=7;
INSERT INTO payroll_payout_lines (org_id,payroll_period_id,payroll_job_snapshot_id,job_id,user_id,participant_role) VALUES ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000d1','sales_rep') ON CONFLICT DO NOTHING;
SELECT pg_temp.expect(
  (SELECT count(*) FROM payroll_payout_lines WHERE job_id='00000000-0000-0000-0000-0000000000c1') = 2
  AND (SELECT count(*) FROM payroll_job_snapshots WHERE job_id='00000000-0000-0000-0000-0000000000c1') = 2
  AND (SELECT net_payout_total FROM payroll_job_snapshots WHERE id='00000000-0000-0000-0000-0000000000b1') = 7,
  'same-period upsert on pre-existing duplicate allowed, no new rows');
SELECT pg_temp.expect_fail($q$INSERT INTO payroll_job_snapshots (org_id,payroll_period_id,job_id) VALUES ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-0000000000c1')$q$, 'duplicate job into a third period');
UPDATE payroll_payout_lines SET net_amount = net_amount + 0 WHERE job_id='00000000-0000-0000-0000-0000000000c1';
SELECT pg_temp.expect(true, 'existing duplicate rows still editable');

-- ---- Lock claim ---------------------------------------------------------------
SELECT pg_temp.expect(payroll_claim_period_lock('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-0000000000f1'), 'claim: open period');
SELECT pg_temp.expect(NOT payroll_claim_period_lock('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-0000000000f2'), 'claim: second claimer refused');
SELECT pg_temp.expect(NOT payroll_claim_period_lock('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000f2'), 'claim: locked period refused');
SELECT pg_temp.expect(NOT payroll_claim_period_lock('00000000-0000-0000-0000-0000000000e9','00000000-0000-0000-0000-0000000000a5','00000000-0000-0000-0000-0000000000f2'), 'claim: other org refused');
SELECT pg_temp.expect((payroll_cancel_or_reopen_period('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000a3','cancel','00000000-0000-0000-0000-0000000000d9')->>'code') = 'lock_in_progress', 'cancel refused while claim is live');
UPDATE payroll_periods SET lock_claimed_at = now() - interval '16 minutes' WHERE id='00000000-0000-0000-0000-0000000000a3';
SELECT pg_temp.expect(payroll_claim_period_lock('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-0000000000f3'), 'claim: stale (crashed) claim can be retaken');
-- final flip is conditional on the token (what the route does)
WITH f AS (UPDATE payroll_periods SET status='locked' WHERE id='00000000-0000-0000-0000-0000000000a3' AND status='open' AND lock_claim_token='00000000-0000-0000-0000-0000000000f1' RETURNING 1)
SELECT pg_temp.expect((SELECT count(*) FROM f) = 0, 'flip with a stale token updates nothing');
UPDATE payroll_periods SET lock_claimed_at=NULL, lock_claim_token=NULL WHERE id='00000000-0000-0000-0000-0000000000a3';

-- ---- Cancel / reopen -------------------------------------------------------------
SELECT pg_temp.expect((payroll_cancel_or_reopen_period('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000a1','cancel','00000000-0000-0000-0000-0000000000d9')->>'code') = 'period_has_payout_lines', 'cancel locked period with lines refused');
SELECT pg_temp.expect((payroll_cancel_or_reopen_period('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000a1','reopen','00000000-0000-0000-0000-0000000000d9')->>'code') = 'period_has_payout_lines', 'reopen locked period with lines refused');
SELECT pg_temp.expect((SELECT status FROM payroll_periods WHERE id='00000000-0000-0000-0000-0000000000a1') = 'locked' AND (SELECT count(*) FROM payroll_job_snapshots WHERE payroll_period_id='00000000-0000-0000-0000-0000000000a1') = 2, 'refused cancel changed nothing');
SELECT pg_temp.expect((payroll_cancel_or_reopen_period('00000000-0000-0000-0000-0000000000e9','00000000-0000-0000-0000-0000000000a4','cancel','00000000-0000-0000-0000-0000000000d9')->>'code') = 'not_found', 'cancel other org -> not_found');

-- P4: open period holding debris from a lock that never finished (c4, two lines + state pointer)
INSERT INTO payroll_job_snapshots (id,org_id,payroll_period_id,job_id,net_payout_total) VALUES ('00000000-0000-0000-0000-0000000000b5','00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000a4','00000000-0000-0000-0000-0000000000c4',80);
INSERT INTO payroll_payout_lines (org_id,payroll_period_id,payroll_job_snapshot_id,job_id,user_id,participant_role,net_amount) VALUES
 ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000a4','00000000-0000-0000-0000-0000000000b5','00000000-0000-0000-0000-0000000000c4','00000000-0000-0000-0000-0000000000d1','sales_rep',50),
 ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000a4','00000000-0000-0000-0000-0000000000b5','00000000-0000-0000-0000-0000000000c4','00000000-0000-0000-0000-0000000000d2','setter',30);
INSERT INTO job_payroll_state (job_id, org_id, current_payroll_period_id, payroll_cutoff_at, scheduled_pay_date, payroll_eligible_at) VALUES
 ('00000000-0000-0000-0000-0000000000c4','00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000a4', now(), current_date, now());
SELECT pg_temp.expect((payroll_cancel_or_reopen_period('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000a4','cancel','00000000-0000-0000-0000-0000000000d9')->>'snapshots_deleted') = '1', 'cancel open period with partial rows: ok');
SELECT pg_temp.expect(
  (SELECT status FROM payroll_periods WHERE id='00000000-0000-0000-0000-0000000000a4') = 'cancelled'
  AND (SELECT count(*) FROM payroll_job_snapshots WHERE payroll_period_id='00000000-0000-0000-0000-0000000000a4') = 0
  AND (SELECT count(*) FROM payroll_payout_lines WHERE payroll_period_id='00000000-0000-0000-0000-0000000000a4') = 0,
  'partial snapshots + lines deleted, period cancelled');
SELECT pg_temp.expect(
  (SELECT current_payroll_period_id IS NULL AND payroll_cutoff_at IS NULL AND scheduled_pay_date IS NULL AND payroll_eligible_at IS NOT NULL
   FROM job_payroll_state WHERE job_id='00000000-0000-0000-0000-0000000000c4'),
  'job_payroll_state period pointer/cutoff/pay date cleared (eligibility kept)');
SELECT pg_temp.expect(
  (SELECT count(*) FROM payroll_override_audit WHERE payroll_period_id='00000000-0000-0000-0000-0000000000a4'
     AND override_type='manual_adjustment' AND job_id IS NULL AND actor_user_id='00000000-0000-0000-0000-0000000000d9'
     AND jsonb_array_length(before_value->'snapshots'->0->'line_ids') = 2
     AND (before_value->'snapshots'->0->>'line_count')::int = 2
     AND before_value->'snapshots'->0->>'job_id' = '00000000-0000-0000-0000-0000000000c4'
     AND before_value->'snapshots'->0->>'snapshot_id' = '00000000-0000-0000-0000-0000000000b5'
     AND before_value->>'period_id' = '00000000-0000-0000-0000-0000000000a4'
     AND after_value->>'action' = 'period_cancel_cleared_partial_lock' AND NOT (after_value ? 'role')) = 1,
  'one audit row with the deleted snapshot/line ids, counts, job id and period id');
-- payroll_override_audit is readable org-wide: no money and no payees may be copied into it.
SELECT pg_temp.expect(
  (SELECT bool_and(before_value::text !~* '(amount|payout|total|gross|net_|user_id|participant)'
               AND after_value::text  !~* '(amount|payout|total|gross|net_|user_id|participant)')
   FROM payroll_override_audit WHERE payroll_period_id='00000000-0000-0000-0000-0000000000a4'),
  'audit row holds no amounts and no payees');
SELECT pg_temp.expect((SELECT count(*) FROM payroll_job_snapshots WHERE job_id='00000000-0000-0000-0000-0000000000c4') = 0, 'cleared job is payable again (no snapshot anywhere)');
SELECT pg_temp.expect((payroll_cancel_or_reopen_period('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000a4','reopen','00000000-0000-0000-0000-0000000000d9')->>'ok') = 'true', 'reopen the (now empty) cancelled period');

-- P5: chargeback application blocks cancel
INSERT INTO payroll_job_snapshots (id,org_id,payroll_period_id,job_id) VALUES ('00000000-0000-0000-0000-0000000000b6','00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000a5','00000000-0000-0000-0000-0000000000c5');
INSERT INTO payroll_payout_lines (id,org_id,payroll_period_id,payroll_job_snapshot_id,job_id,user_id,participant_role) VALUES ('00000000-0000-0000-0000-0000000000f9','00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000a5','00000000-0000-0000-0000-0000000000b6','00000000-0000-0000-0000-0000000000c5','00000000-0000-0000-0000-0000000000d1','sales_rep');
INSERT INTO payroll_chargeback_applications (chargeback_id,payroll_period_id,payout_line_id) VALUES (gen_random_uuid(),'00000000-0000-0000-0000-0000000000a5','00000000-0000-0000-0000-0000000000f9');
SELECT pg_temp.expect((payroll_cancel_or_reopen_period('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000a5','cancel','00000000-0000-0000-0000-0000000000d9')->>'code') = 'period_has_chargeback_applications', 'chargeback application blocks cancel');
SELECT pg_temp.expect((SELECT count(*) FROM payroll_chargeback_applications) = 1, 'chargeback application kept');
DO $$ BEGIN
  PERFORM payroll_cancel_or_reopen_period('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000a5','delete','00000000-0000-0000-0000-0000000000d9');
  RAISE EXCEPTION 'FAIL invalid action accepted';
EXCEPTION WHEN invalid_parameter_value THEN RAISE NOTICE 'PASS invalid action rejected';
END $$;

-- ---- Atomic lineless-snapshot discard --------------------------------------------
SELECT pg_temp.expect(NOT payroll_discard_lineless_job_snapshot('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000b6'), 'discard refuses a snapshot that has lines');
INSERT INTO payroll_job_snapshots (id,org_id,payroll_period_id,job_id) VALUES ('00000000-0000-0000-0000-0000000000b7','00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-0000000000c6');
SELECT pg_temp.expect(NOT payroll_discard_lineless_job_snapshot('00000000-0000-0000-0000-0000000000e9','00000000-0000-0000-0000-0000000000b7'), 'discard refuses another org');
SELECT pg_temp.expect(payroll_discard_lineless_job_snapshot('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000b7'), 'discard deletes a lineless snapshot');
SELECT pg_temp.expect((SELECT count(*) FROM payroll_job_snapshots WHERE id='00000000-0000-0000-0000-0000000000b7') = 0, 'lineless snapshot gone');

-- ---- Privileges ------------------------------------------------------------------
SELECT pg_temp.expect(
  NOT has_column_privilege(r, 'public.payroll_periods', 'lock_claim_token', 'SELECT')
  AND NOT has_column_privilege(r, 'public.payroll_periods', 'lock_claimed_at', 'SELECT')
  AND has_column_privilege(r, 'public.payroll_periods', 'status', 'SELECT')
  AND has_column_privilege(r, 'public.payroll_periods', 'scheduled_pay_date', 'SELECT')
  AND NOT has_table_privilege(r, 'public.payroll_periods', 'SELECT'),
  'claim columns not readable by ' || r || '; the 10 pre-existing columns still are')
FROM unnest(ARRAY['anon', 'authenticated']) r;
SELECT pg_temp.expect(
  NOT has_function_privilege(r, f, 'EXECUTE'),
  r || ' cannot EXECUTE ' || f)
FROM unnest(ARRAY['anon', 'authenticated']) r,
     unnest(ARRAY['public.payroll_guard_job_snapshot_single_period()',
                  'public.payroll_guard_payout_line_single_period()',
                  'public.payroll_claim_period_lock(uuid, uuid, uuid)',
                  'public.payroll_cancel_or_reopen_period(uuid, uuid, text, uuid)',
                  'public.payroll_discard_lineless_job_snapshot(uuid, uuid)']) f;
SELECT pg_temp.expect(has_function_privilege('service_role', 'public.payroll_claim_period_lock(uuid, uuid, uuid)', 'EXECUTE'),
  'service_role keeps EXECUTE on the RPCs');
-- as a real API role: explicit columns work (app/sisu/page.tsx shape), the token does not
SET ROLE authenticated;
SELECT pg_temp.expect((SELECT count(*) FROM payroll_periods WHERE scheduled_pay_date IS NULL OR id IS NOT NULL) >= 0,
  'authenticated: SELECT id, scheduled_pay_date works');
DO $$ BEGIN
  PERFORM lock_claim_token FROM payroll_periods;
  RAISE EXCEPTION 'FAIL authenticated could read lock_claim_token';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS authenticated: lock_claim_token denied';
END $$;
DO $$ BEGIN
  PERFORM * FROM payroll_periods;
  RAISE EXCEPTION 'FAIL authenticated could select *';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS authenticated: select * denied (explicit columns required)';
END $$;
RESET ROLE;

SELECT 'ALL SEQUENTIAL TESTS PASSED' AS result;
