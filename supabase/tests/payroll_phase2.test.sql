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

-- 5. Crew deductions only take back BONUS money (202611230050 crew_deduction_cap) -------------------------------------------------
-- The migration's own columns/constraints are not in the minimal schema: add the two columns the trigger and the app use.
ALTER TABLE payroll_bonus_lines ADD COLUMN description text, ADD COLUMN source_key text;
\ir :crewcap
INSERT INTO payroll_periods (id, org_id, period_label, cutoff_at, lock_at, scheduled_pay_date) VALUES
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-00000000000b', 'Week ending 2026-11-22', '2026-11-23T04:59:59.999Z', '2026-11-23T04:59:59.999Z', '2026-11-27');
DO $$
DECLARE v_org uuid := '00000000-0000-0000-0000-00000000000b'; v_a uuid := '00000000-0000-0000-0000-0000000000a2'; v_b uuid := '00000000-0000-0000-0000-0000000000a4';
  v_p uuid := '00000000-0000-0000-0000-0000000000b2'; v_p1 uuid := '00000000-0000-0000-0000-0000000000b3';
  v_pos uuid; v_pos2 uuid; v_d1 uuid; v_d2 uuid; v_raw numeric; v_base numeric; v_amt numeric; v_desc text;
BEGIN
  -- Base pay of $100 for A in the week: a deduction must never reach it.
  INSERT INTO payroll_payout_lines (org_id, payroll_period_id, job_id, user_id, participant_role, gross_amount, net_amount) VALUES (v_org, v_p, gen_random_uuid(), v_a, 'setter', 100, 100);
  SELECT raw INTO v_base FROM payroll_week_person_totals(v_org, v_p) WHERE user_id = v_a; -- everything but crew bonuses (earlier sections left some fixes on this week)
  INSERT INTO payroll_bonus_lines (org_id, payroll_period_id, user_id, amount, status, bonus_type, source_key) VALUES (v_org, v_p, v_a, 10, 'approved', 'crew_done_right', 'k-pos') RETURNING id INTO v_pos;
  -- (a) a -15 deduction against $10 earned is stored as -10, with the reason; base pay stays 100 + 0
  INSERT INTO payroll_bonus_lines (org_id, payroll_period_id, user_id, amount, status, bonus_type, description, source_key) VALUES (v_org, v_p, v_a, -15, 'pending_approval', 'crew_deduction', 'Callback or redo — WO-1', 'k-d1') RETURNING id INTO v_d1;
  SELECT amount, description INTO v_amt, v_desc FROM payroll_bonus_lines WHERE id = v_d1;
  IF v_amt <> -10 THEN RAISE EXCEPTION 'deduction not capped at the bonus earned: %', v_amt; END IF;
  IF v_desc NOT LIKE '%Deduction limited to bonuses earned this week%' THEN RAISE EXCEPTION 'cap reason missing: %', v_desc; END IF;
  -- (b) a second deduction the same week has nothing left to take: $0
  INSERT INTO payroll_bonus_lines (org_id, payroll_period_id, user_id, amount, status, bonus_type, source_key) VALUES (v_org, v_p, v_a, -5, 'pending_approval', 'crew_deduction', 'k-d2') RETURNING id INTO v_d2;
  IF (SELECT amount FROM payroll_bonus_lines WHERE id = v_d2) <> 0 THEN RAISE EXCEPTION 'second deduction took more than was left'; END IF;
  -- (c) approving the capped deduction keeps it; the ONE person total = base pay + bonus net (10 - 10 = 0), never below base pay
  UPDATE payroll_bonus_lines SET status = 'approved' WHERE id = v_d1;
  SELECT raw INTO v_raw FROM payroll_week_person_totals(v_org, v_p) WHERE user_id = v_a;
  IF v_raw <> v_base THEN RAISE EXCEPTION 'a deduction reached base pay: % vs %', v_raw, v_base; END IF;
  -- (d) the bonus is rejected AFTER: the approved deduction is re-capped to what is left (nothing), base pay still 100
  UPDATE payroll_bonus_lines SET status = 'rejected' WHERE id = v_pos;
  IF (SELECT amount FROM payroll_bonus_lines WHERE id = v_d1) <> 0 THEN RAISE EXCEPTION 'deduction survived its bonus being rejected: %', (SELECT amount FROM payroll_bonus_lines WHERE id = v_d1); END IF;
  SELECT raw INTO v_raw FROM payroll_week_person_totals(v_org, v_p) WHERE user_id = v_a;
  IF v_raw <> v_base THEN RAISE EXCEPTION 'week total went below base pay after a rejected bonus: % vs %', v_raw, v_base; END IF;
  -- (e) a bonus that comes back (re-approved) does NOT restore the dropped amount: it is dropped, not carried
  UPDATE payroll_bonus_lines SET status = 'approved' WHERE id = v_pos;
  IF (SELECT amount FROM payroll_bonus_lines WHERE id = v_d1) <> 0 THEN RAISE EXCEPTION 'a dropped deduction came back'; END IF;
  -- (f) two bonuses (6 pending + 4 approved) fit a -10; reject the 6 later and it falls to -4
  INSERT INTO payroll_bonus_lines (org_id, payroll_period_id, user_id, amount, status, bonus_type, source_key) VALUES (v_org, v_p, v_b, 6, 'pending_approval', 'crew_review', 'k-b1') RETURNING id INTO v_pos;
  INSERT INTO payroll_bonus_lines (org_id, payroll_period_id, user_id, amount, status, bonus_type, source_key) VALUES (v_org, v_p, v_b, 4, 'approved', 'crew_beat_time', 'k-b2') RETURNING id INTO v_pos2;
  INSERT INTO payroll_bonus_lines (org_id, payroll_period_id, user_id, amount, status, bonus_type, source_key) VALUES (v_org, v_p, v_b, -10, 'pending_approval', 'crew_deduction', 'k-b3') RETURNING id INTO v_d1;
  IF (SELECT amount FROM payroll_bonus_lines WHERE id = v_d1) <> -10 THEN RAISE EXCEPTION 'deduction within the bonuses was cut'; END IF;
  UPDATE payroll_bonus_lines SET status = 'rejected' WHERE id = v_pos;
  IF (SELECT amount FROM payroll_bonus_lines WHERE id = v_d1) <> -4 THEN RAISE EXCEPTION 'rejecting a bonus did not re-cap the deduction: %', (SELECT amount FROM payroll_bonus_lines WHERE id = v_d1); END IF;
  -- (g) moving the 4 to another week (the approve route does this for a stuck bonus) re-caps the week it left
  UPDATE payroll_bonus_lines SET payroll_period_id = v_p1 WHERE id = v_pos2;
  IF (SELECT amount FROM payroll_bonus_lines WHERE id = v_d1) <> 0 THEN RAISE EXCEPTION 'moving a bonus away did not re-cap the deduction'; END IF;
  -- (h) other kinds of bonus are not "crew bonus money": a $50 manual bonus does not make room for a deduction
  INSERT INTO payroll_bonus_lines (org_id, payroll_period_id, user_id, amount, status, bonus_type, source_key) VALUES (v_org, v_p, v_b, 50, 'approved', 'manual', 'k-m1');
  INSERT INTO payroll_bonus_lines (org_id, payroll_period_id, user_id, amount, status, bonus_type, source_key) VALUES (v_org, v_p, v_b, -7, 'pending_approval', 'crew_deduction', 'k-b4') RETURNING id INTO v_d2;
  IF (SELECT amount FROM payroll_bonus_lines WHERE id = v_d2) <> 0 THEN RAISE EXCEPTION 'a deduction took back a manual bonus'; END IF;
  -- (i) a rejected deduction is left alone, and a deduction in ANOTHER week has its own room
  INSERT INTO payroll_bonus_lines (org_id, payroll_period_id, user_id, amount, status, bonus_type, source_key) VALUES (v_org, v_p1, v_b, -3, 'rejected', 'crew_deduction', 'k-b5') RETURNING id INTO v_d2;
  IF (SELECT amount FROM payroll_bonus_lines WHERE id = v_d2) <> -3 THEN RAISE EXCEPTION 'a rejected deduction was rewritten'; END IF;
  RAISE NOTICE 'PASS 5 crew deduction cap: bonus money only, re-capped on reject / move, base pay and the person total untouched';
END $$;

-- 5b. Approval order and closed weeks --------------------------------------------------------------------------------------------
INSERT INTO payroll_periods (id, org_id, period_label, cutoff_at, lock_at, scheduled_pay_date) VALUES
  ('00000000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-00000000000b', 'Week ending 2026-11-29', '2026-11-30T04:59:59.999Z', '2026-11-30T04:59:59.999Z', '2026-12-04'),
  ('00000000-0000-0000-0000-0000000000b5', '00000000-0000-0000-0000-00000000000b', 'Week ending 2026-12-06', '2026-12-07T04:59:59.999Z', '2026-12-07T04:59:59.999Z', '2026-12-11');
DO $$
DECLARE v_org uuid := '00000000-0000-0000-0000-00000000000b'; v_u uuid := '00000000-0000-0000-0000-0000000000a1';
  v_wk uuid := '00000000-0000-0000-0000-0000000000b4'; v_next uuid := '00000000-0000-0000-0000-0000000000b5';
  v_pend uuid; v_appr uuid; v_d uuid; v_ok boolean;
BEGIN
  -- (j) a deduction backed only by a PENDING bonus cannot be approved (if the week were approved with the bonus still pending,
  --     the deduction would come out of base pay); approve the bonus first, then the deduction goes through unchanged.
  INSERT INTO payroll_bonus_lines (org_id, payroll_period_id, user_id, amount, status, bonus_type, source_key) VALUES (v_org, v_wk, v_u, 10, 'pending_approval', 'crew_done_right', 'k-j1') RETURNING id INTO v_pend;
  INSERT INTO payroll_bonus_lines (org_id, payroll_period_id, user_id, amount, status, bonus_type, source_key) VALUES (v_org, v_wk, v_u, -10, 'pending_approval', 'crew_deduction', 'k-j2') RETURNING id INTO v_d;
  BEGIN UPDATE payroll_bonus_lines SET status = 'approved' WHERE id = v_d; v_ok := false;
  EXCEPTION WHEN OTHERS THEN v_ok := SQLERRM LIKE '%crew_deduction_needs_bonuses%'; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'a deduction was approved against a bonus that is still pending'; END IF;
  IF (SELECT amount FROM payroll_bonus_lines WHERE id = v_d) <> -10 OR (SELECT status FROM payroll_bonus_lines WHERE id = v_d) <> 'pending_approval' THEN RAISE EXCEPTION 'a refused approval changed the deduction'; END IF;
  UPDATE payroll_bonus_lines SET status = 'approved' WHERE id = v_pend;
  UPDATE payroll_bonus_lines SET status = 'approved' WHERE id = v_d;
  IF (SELECT amount FROM payroll_bonus_lines WHERE id = v_d) <> -10 THEN RAISE EXCEPTION 'approving in the right order cut the deduction'; END IF;
  -- (k) the week is approved (locked) with a crew bonus still pending ("Not now"). Marking its lines paid and moving the stuck
  --     bonus onto the next open week (Pay this week -> Approve) must work, and the locked week's deduction is never rewritten.
  INSERT INTO payroll_bonus_lines (org_id, payroll_period_id, user_id, amount, status, bonus_type, source_key) VALUES (v_org, v_wk, v_u, 5, 'pending_approval', 'crew_review', 'k-k1') RETURNING id INTO v_appr;
  UPDATE payroll_periods SET status = 'locked', locked_at = now() WHERE id = v_wk;
  UPDATE payroll_bonus_lines SET status = 'paid' WHERE id = v_pend;
  UPDATE payroll_bonus_lines SET status = 'paid' WHERE id = v_d;
  UPDATE payroll_bonus_lines SET status = 'approved', payroll_period_id = v_next WHERE id = v_appr;
  IF (SELECT amount FROM payroll_bonus_lines WHERE id = v_d) <> -10 THEN RAISE EXCEPTION 'a locked week''s deduction was rewritten'; END IF;
  -- (l) a stuck pending crew bonus rejected on a locked week leaves the locked deduction alone too
  INSERT INTO payroll_bonus_lines (org_id, payroll_period_id, user_id, amount, status, bonus_type, source_key) VALUES (v_org, v_wk, v_u, 3, 'pending_approval', 'crew_beat_time', 'k-l1') RETURNING id INTO v_appr;
  UPDATE payroll_bonus_lines SET status = 'rejected' WHERE id = v_appr;
  IF (SELECT amount FROM payroll_bonus_lines WHERE id = v_d) <> -10 THEN RAISE EXCEPTION 'a locked week''s deduction was rewritten on reject'; END IF;
  RAISE NOTICE 'PASS 5b crew deduction: approval needs approved bonuses; a locked week''s lines can be marked paid / moved and are never rewritten';
END $$;

SELECT 'ALL PAYROLL PHASE2 TESTS PASSED';
