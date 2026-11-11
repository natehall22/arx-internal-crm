-- DB test for migration 202611140070 (advances / draws, approval links, provider + state columns).
-- Builds the shared minimal payroll schema, applies sections 0–2b of 202610280010 and 202611120010 (the parts this builds on), then
-- 202611140070, and checks: owner-only writers, recovery lines counted by the ONE person total, the over-recovery guard, cancel,
-- and that payroll_commit_week writes the week's recoveries in its own transaction. Prints ALL PAYROLL PHASE2 TESTS PASSED.
\set ON_ERROR_STOP on
DO $$ BEGIN IF current_database() NOT LIKE 'payroll_phase2_test_%' THEN RAISE EXCEPTION 'refusing: not a payroll_phase2_test_ database'; END IF; END $$;
\ir payroll_minimal_schema.sql
\ir :sections0to2b
\ir ../migrations/202611120010_payroll_pay_week_minimums_job_split.sql
\ir ../migrations/202611140070_payroll_advances_approval_links_provider.sql

INSERT INTO orgs VALUES ('00000000-0000-0000-0000-00000000000b', 'MonSun', '{"payWeek":{"weekStartDay":1,"cutoffTime":"23:59","paydayWeekday":5}}', 'America/New_York'),
                        ('00000000-0000-0000-0000-00000000000c', 'Other', '{}', 'America/New_York');
INSERT INTO users (id, org_id, full_name, role, active, is_super_admin) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000b', 'Owner', 'admin', true, true),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-00000000000b', 'Rep', 'canvasser', true, false),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-00000000000b', 'Office', 'admin', true, false),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-00000000000c', 'Other co', 'canvasser', true, true);
-- Two open weeks: ending Sun 2026-11-08 and Sun 2026-11-15 (cutoff Sun 23:59:59.999 EST).
INSERT INTO payroll_periods (id, org_id, period_label, cutoff_at, lock_at, scheduled_pay_date) VALUES
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000000b', 'Week ending 2026-11-08', '2026-11-09T04:59:59.999Z', '2026-11-09T04:59:59.999Z', '2026-11-13'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-00000000000b', 'Week ending 2026-11-15', '2026-11-16T04:59:59.999Z', '2026-11-16T04:59:59.999Z', '2026-11-20');

-- 1. Owner-only writers; paid-on-check variant ------------------------------------------------------------------------------------
DO $$
DECLARE v_org uuid := '00000000-0000-0000-0000-00000000000b'; v_id uuid; v_ok boolean;
BEGIN
  BEGIN PERFORM payroll_record_advance(v_org, '00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000a2', 300, 'full', NULL, date '2026-11-10', date '2026-11-15', NULL, NULL, false); v_ok := false;
  EXCEPTION WHEN OTHERS THEN v_ok := SQLERRM LIKE '%owner_only%'; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'office staff recorded an advance'; END IF;
  BEGIN PERFORM payroll_record_advance(v_org, '00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000a2', 300, 'full', NULL, date '2026-11-10', date '2026-11-15', NULL, NULL, false); v_ok := false;
  EXCEPTION WHEN OTHERS THEN v_ok := SQLERRM LIKE '%owner_only%'; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'another company''s owner recorded an advance'; END IF;
  -- Paid on the week-ending 11-08 check: recovery may not start in that week.
  BEGIN PERFORM payroll_record_advance(v_org, '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2', 300, 'full', NULL, date '2026-11-10', date '2026-11-08', NULL, '00000000-0000-0000-0000-0000000000b1', false); v_ok := false;
  EXCEPTION WHEN OTHERS THEN v_ok := SQLERRM LIKE '%recover_after_paid_week%'; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'recovery in the week it was paid'; END IF;
  IF (SELECT count(*) FROM payroll_advances) <> 0 OR (SELECT count(*) FROM payroll_adjustments) <> 0 THEN RAISE EXCEPTION 'a refused advance left rows'; END IF;
  v_id := payroll_record_advance(v_org, '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2', 300, 'fixed', 100, date '2026-11-10', date '2026-11-15', 'truck repair', '00000000-0000-0000-0000-0000000000b1', false);
  IF (SELECT amount FROM payroll_adjustments WHERE advance_id = v_id AND kind = 'advance') <> 300 THEN RAISE EXCEPTION 'the + line is missing'; END IF;
  IF (SELECT paid_adjustment_id FROM payroll_advances WHERE id = v_id) IS NULL THEN RAISE EXCEPTION 'paid line not linked'; END IF;
  -- A fixed amount above the advance is refused by the table rule; a percent over 100 too.
  BEGIN PERFORM payroll_record_advance(v_org, '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2', 100, 'fixed', 150, date '2026-11-10', date '2026-11-15', NULL, NULL, false); v_ok := false;
  EXCEPTION WHEN check_violation THEN v_ok := true; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'fixed > amount accepted'; END IF;
  -- Cancel while its + line still waits on the open week: withdrawn (nothing went out).
  IF (payroll_cancel_advance(v_org, '00000000-0000-0000-0000-0000000000a1', v_id, 'changed my mind')->>'withdrawn') <> 'true' THEN RAISE EXCEPTION 'not withdrawn'; END IF;
  IF (SELECT status FROM payroll_adjustments WHERE advance_id = v_id) <> 'void' THEN RAISE EXCEPTION 'withdrawn + line still counts'; END IF;
  BEGIN PERFORM payroll_cancel_advance(v_org, '00000000-0000-0000-0000-0000000000a1', v_id, 'again'); v_ok := false; EXCEPTION WHEN OTHERS THEN v_ok := SQLERRM LIKE '%already_cancelled%'; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'cancelled twice'; END IF;
  RAISE NOTICE 'PASS 1 owner-only writers, paid-on-check line, withdraw';
END $$;

-- 2. Approve week 1: the plan's recovery becomes a negative line, counted by the one person total; over-recovery refused ---------
DO $$
DECLARE v_org uuid := '00000000-0000-0000-0000-00000000000b'; v_rep uuid := '00000000-0000-0000-0000-0000000000a2'; v_owner uuid := '00000000-0000-0000-0000-0000000000a1';
  v_p uuid := '00000000-0000-0000-0000-0000000000b1'; v_adv uuid; v_tok uuid := gen_random_uuid(); v_res jsonb; v_raw numeric; v_ok boolean;
BEGIN
  v_adv := payroll_record_advance(v_org, v_owner, v_rep, 500, 'fixed', 200, date '2026-11-02', date '2026-11-08', 'advance', NULL, false);
  INSERT INTO payroll_payout_lines (org_id, payroll_period_id, job_id, user_id, participant_role, gross_amount, net_amount) VALUES (v_org, v_p, gen_random_uuid(), v_rep, 'setter', 700, 700);
  -- A stale pending line from a previous failed attempt must be replaced, never added to.
  INSERT INTO payroll_adjustments (org_id, payroll_period_id, user_id, amount, reason, kind, advance_id) VALUES (v_org, v_p, v_rep, -50, 'stale', 'advance_recovery', v_adv);
  UPDATE payroll_periods SET lock_claim_token = v_tok, lock_claimed_at = now() WHERE id = v_p;
  -- Writing a recovery to a claimed week outside the commit is refused (same guard as fixes).
  BEGIN INSERT INTO payroll_adjustments (org_id, payroll_period_id, user_id, amount, reason, kind, advance_id) VALUES (v_org, v_p, v_rep, -10, 'sneaky', 'advance_recovery', v_adv); v_ok := false;
  EXCEPTION WHEN OTHERS THEN v_ok := SQLERRM LIKE '%payroll_period_claimed%'; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'recovery written under a live claim'; END IF;
  -- Over-recovery: 600 > 500 advanced.
  BEGIN PERFORM payroll_commit_week(v_org, v_p, v_tok, v_owner, 100, jsonb_build_object('jobs', '[]'::jsonb, 'advances', jsonb_build_array(jsonb_build_object('advance_id', v_adv, 'amount', 600, 'reason', 'x')))); v_ok := false;
  EXCEPTION WHEN OTHERS THEN v_ok := SQLERRM LIKE '%over_recovered%'; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'over-recovery accepted'; END IF;
  IF (SELECT status FROM payroll_periods WHERE id = v_p) <> 'open' THEN RAISE EXCEPTION 'a refused commit locked the week'; END IF;
  v_res := payroll_commit_week(v_org, v_p, v_tok, v_owner, 500, jsonb_build_object('jobs', '[]'::jsonb, 'advances', jsonb_build_array(jsonb_build_object('advance_id', v_adv, 'amount', 200, 'reason', 'Advance repaid: $200 a week'))));
  IF (v_res->>'total')::numeric <> 500 THEN RAISE EXCEPTION 'total after recovery %', v_res; END IF;
  SELECT raw INTO v_raw FROM payroll_week_person_totals(v_org, v_p) WHERE user_id = v_rep;
  IF v_raw <> 500 THEN RAISE EXCEPTION 'person total %', v_raw; END IF;
  IF (SELECT count(*) FROM payroll_adjustments WHERE advance_id = v_adv AND kind = 'advance_recovery' AND status <> 'void') <> 1 THEN RAISE EXCEPTION 'stale recovery line kept'; END IF;
  IF (SELECT status FROM payroll_adjustments WHERE advance_id = v_adv AND kind = 'advance_recovery' AND amount = -200) <> 'applied' THEN RAISE EXCEPTION 'recovery not applied'; END IF;
  IF (SELECT status FROM payroll_periods WHERE id = v_p) <> 'locked' THEN RAISE EXCEPTION 'week not locked'; END IF;
  RAISE NOTICE 'PASS 2 recovery line written in the commit, counted by the person total, replaced not doubled, over-recovery refused';
END $$;

-- 3. Week 2: outstanding is derived (500 - 200); the last 300 is allowed, one more cent is not; cancel stops recovery --------------
DO $$
DECLARE v_org uuid := '00000000-0000-0000-0000-00000000000b'; v_rep uuid := '00000000-0000-0000-0000-0000000000a2'; v_owner uuid := '00000000-0000-0000-0000-0000000000a1';
  v_p2 uuid := '00000000-0000-0000-0000-0000000000b2'; v_adv uuid; v_ok boolean; v_r jsonb;
BEGIN
  SELECT id INTO v_adv FROM payroll_advances WHERE note = 'advance';
  BEGIN
    INSERT INTO payroll_adjustments (org_id, payroll_period_id, user_id, amount, reason, kind, advance_id) VALUES (v_org, v_p2, v_rep, -300.01, 'too much', 'advance_recovery', v_adv);
    v_ok := false;
  EXCEPTION WHEN OTHERS THEN v_ok := SQLERRM LIKE '%over_recovered%'; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'one cent over the advance accepted'; END IF;
  INSERT INTO payroll_adjustments (org_id, payroll_period_id, user_id, amount, reason, kind, advance_id) VALUES (v_org, v_p2, v_rep, -300, 'rest', 'advance_recovery', v_adv);
  BEGIN
    INSERT INTO payroll_adjustments (org_id, payroll_period_id, user_id, amount, reason, kind, advance_id) VALUES (v_org, v_p2, v_rep, -1, 'dup', 'advance_recovery', v_adv);
    v_ok := false;
  EXCEPTION WHEN OTHERS THEN v_ok := SQLERRM LIKE '%over_recovered%'; END;   -- the advance is fully recovered now
  IF NOT v_ok THEN RAISE EXCEPTION 'recovery beyond the advance accepted'; END IF;
  -- Cancel after week 1 was approved: the applied 200 stays, 300 is written off. (The waiting recovery line on week 2 is voided by the
  -- app when it recomputes; here we only prove nothing NEW can be added to a cancelled advance.)
  v_r := payroll_cancel_advance(v_org, v_owner, v_adv, 'left the company');
  IF (v_r->>'recovered')::numeric <> 200 OR (v_r->>'written_off')::numeric <> 300 OR (v_r->>'withdrawn') <> 'false' THEN RAISE EXCEPTION 'cancel result %', v_r; END IF;
  UPDATE payroll_adjustments SET status = 'void' WHERE advance_id = v_adv AND payroll_period_id = v_p2;   -- voiding is always allowed
  BEGIN
    INSERT INTO payroll_adjustments (org_id, payroll_period_id, user_id, amount, reason, kind, advance_id) VALUES (v_org, v_p2, v_rep, -5, 'after cancel', 'advance_recovery', v_adv);
    v_ok := false;
  EXCEPTION WHEN OTHERS THEN v_ok := SQLERRM LIKE '%payroll_advance:cancelled%'; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'recovery added on a cancelled advance'; END IF;
  RAISE NOTICE 'PASS 3 outstanding derived across weeks, exact remainder only, one line per week, cancel writes off the rest';
END $$;

-- 4. A line for another person, or the wrong company, never attaches to an advance; kind check; links; provider columns -----------
DO $$
DECLARE v_org uuid := '00000000-0000-0000-0000-00000000000b'; v_owner uuid := '00000000-0000-0000-0000-0000000000a1'; v_adv uuid; v_ok boolean;
BEGIN
  v_adv := payroll_record_advance(v_org, v_owner, '00000000-0000-0000-0000-0000000000a2', 100, 'full', NULL, date '2026-11-12', date '2026-11-15', NULL, NULL, false);
  BEGIN INSERT INTO payroll_adjustments (org_id, payroll_period_id, user_id, amount, reason, kind, advance_id) VALUES (v_org, '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a1', -10, 'wrong person', 'advance_recovery', v_adv); v_ok := false;
  EXCEPTION WHEN OTHERS THEN v_ok := SQLERRM LIKE '%wrong_person%'; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'recovery for someone else accepted'; END IF;
  INSERT INTO payroll_adjustments (org_id, payroll_period_id, user_id, amount, reason, kind, advance_id) VALUES (v_org, '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a2', -10, 'first', 'advance_recovery', v_adv);
  BEGIN INSERT INTO payroll_adjustments (org_id, payroll_period_id, user_id, amount, reason, kind, advance_id) VALUES (v_org, '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a2', -10, 'second on one week', 'advance_recovery', v_adv); v_ok := false;
  EXCEPTION WHEN unique_violation THEN v_ok := true; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'two recovery lines on one week'; END IF;
  BEGIN INSERT INTO payroll_adjustments (org_id, payroll_period_id, user_id, amount, reason, kind) VALUES (v_org, '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a2', -10, 'no advance', 'advance_recovery'); v_ok := false;
  EXCEPTION WHEN OTHERS THEN v_ok := SQLERRM LIKE '%missing_advance%'; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'recovery with no advance accepted'; END IF;
  BEGIN INSERT INTO payroll_adjustments (org_id, payroll_period_id, user_id, amount, reason, kind) VALUES (v_org, '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a2', 10, 'bad kind', 'bogus'); v_ok := false;
  EXCEPTION WHEN check_violation THEN v_ok := true; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'unknown kind accepted'; END IF;
  -- approval links: the token hash is unique; used_at is the only state
  INSERT INTO payroll_approval_links (org_id, payroll_period_id, user_id, token_hash, notified_total, notified_people, expires_at) VALUES (v_org, '00000000-0000-0000-0000-0000000000b2', v_owner, 'abc', 100, 1, now() + interval '1 day');
  BEGIN INSERT INTO payroll_approval_links (org_id, payroll_period_id, user_id, token_hash, notified_total, notified_people, expires_at) VALUES (v_org, '00000000-0000-0000-0000-0000000000b2', v_owner, 'abc', 100, 1, now()); v_ok := false;
  EXCEPTION WHEN unique_violation THEN v_ok := true; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'duplicate token hash accepted'; END IF;
  -- provider columns
  UPDATE users SET payroll_state = 'NC', payroll_employee_id = '12345' WHERE id = v_owner;
  BEGIN UPDATE users SET payroll_state = 'nc' WHERE id = v_owner; v_ok := false; EXCEPTION WHEN check_violation THEN v_ok := true; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'lowercase state accepted'; END IF;
  -- the API roles cannot read or write any of the new tables, or run the new writers
  IF has_table_privilege('authenticated', 'payroll_advances', 'SELECT') OR has_table_privilege('anon', 'payroll_approval_links', 'SELECT') THEN RAISE EXCEPTION 'new tables readable by API roles'; END IF;
  IF has_function_privilege('authenticated', 'public.payroll_record_advance(uuid, uuid, uuid, numeric, text, numeric, date, date, text, uuid, boolean)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.payroll_cancel_advance(uuid, uuid, uuid, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.payroll_commit_week(uuid, uuid, uuid, uuid, numeric, jsonb)', 'EXECUTE') THEN RAISE EXCEPTION 'API roles can run the writers'; END IF;
  RAISE NOTICE 'PASS 4 guards (wrong person, missing advance, kind), approval links, provider columns, privileges';
END $$;

SELECT 'ALL PAYROLL PHASE2 TESTS PASSED';
