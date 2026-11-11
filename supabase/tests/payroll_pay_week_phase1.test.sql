-- DB test for migration 202611120010 (pay week per company, weekly minimum, one total, job split) and the stale-week data fix.
-- Builds a throwaway minimal payroll schema, applies sections 0–2b of 202610280010 (private schema, frozen units, writer guards),
-- then 202611120010 and the data fix, and checks the SQL against the TypeScript rules. Prints ALL PAYROLL PHASE1 TESTS PASSED.
\set ON_ERROR_STOP on
DO $$ BEGIN IF current_database() NOT LIKE 'payroll_phase1_test_%' THEN RAISE EXCEPTION 'refusing: not a payroll_phase1_test_ database'; END IF; END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;

CREATE TABLE orgs (id uuid PRIMARY KEY, name text, settings jsonb DEFAULT '{}'::jsonb, timezone text);
CREATE TABLE users (id uuid PRIMARY KEY, org_id uuid REFERENCES orgs(id), full_name text, role text, active boolean DEFAULT true, is_super_admin boolean);
CREATE TABLE comp_plans (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid, name text);
CREATE TABLE payroll_periods (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES orgs(id), period_label text, cutoff_at timestamptz, lock_at timestamptz,
  scheduled_pay_date date, status text NOT NULL DEFAULT 'open', locked_at timestamptz, paid_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  lock_claimed_at timestamptz, lock_claim_token uuid, UNIQUE (org_id, period_label));
CREATE TABLE production_jobs (id uuid PRIMARY KEY, org_id uuid, job_number text, status text, sale_amount numeric, commission_comp_base numeric, payroll_settled_externally_at timestamptz);
CREATE TABLE payroll_period_snapshots (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid, payroll_period_id uuid UNIQUE, locked_at timestamptz, locked_by uuid);
CREATE TABLE payroll_job_snapshots (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid, payroll_period_snapshot_id uuid, payroll_period_id uuid, job_id uuid,
  contract_total numeric, signed_change_orders_total numeric, commissionable_change_orders_total numeric, dealer_fee numeric, deductible_costs_total numeric,
  commission_base numeric, comp_plan_version text, participants jsonb, gross_payout_total numeric, net_payout_total numeric, pay_date date, payload jsonb, UNIQUE (payroll_period_id, job_id));
CREATE TABLE payroll_payout_lines (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid, payroll_period_id uuid REFERENCES payroll_periods(id), payroll_job_snapshot_id uuid,
  job_id uuid, user_id uuid, participant_role text, gross_amount numeric, net_amount numeric, chargeback_applied_amount numeric, comp_plan_snapshot jsonb);
CREATE TABLE job_payroll_state (job_id uuid PRIMARY KEY, org_id uuid, install_completed_at timestamptz, fully_funded_at timestamptz, costs_ready_at timestamptz,
  payroll_eligible_at timestamptz, payroll_cutoff_at timestamptz, scheduled_pay_date date, current_payroll_period_id uuid, updated_at timestamptz);
CREATE TABLE payroll_rep_hours (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid, payroll_period_id uuid REFERENCES payroll_periods(id), user_id uuid,
  regular_hours numeric, overtime_hours numeric, hourly_earnings numeric, UNIQUE (payroll_period_id, user_id));
CREATE TABLE payroll_bonus_lines (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid, payroll_period_id uuid REFERENCES payroll_periods(id), user_id uuid,
  amount numeric, status text, bonus_type text, source_id uuid);
CREATE TABLE payroll_adjustments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid, payroll_period_id uuid REFERENCES payroll_periods(id), user_id uuid, amount numeric,
  reason text, kind text DEFAULT 'fix', status text DEFAULT 'pending', source_period_id uuid, created_by uuid, applied_at timestamptz);
CREATE UNIQUE INDEX ON payroll_adjustments (source_period_id, user_id) WHERE kind = 'balance' AND status <> 'void';
CREATE TABLE deal_commission_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid, job_id uuid, role text, user_id uuid, override_amount numeric(14,2),
  override_percent numeric(5,2), created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), UNIQUE (job_id, role, user_id));
CREATE TABLE payroll_override_audit (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid, override_type text, job_id uuid, payroll_period_id uuid, actor_user_id uuid,
  reason text NOT NULL, before_value jsonb, after_value jsonb, created_at timestamptz DEFAULT now());

\ir :sections0to2b
\ir ../migrations/202611120010_payroll_pay_week_minimums_job_split.sql
\ir :datafix

INSERT INTO orgs VALUES ('00000000-0000-0000-0000-00000000000a', 'Legacy', '{}', 'America/New_York'),
                        ('00000000-0000-0000-0000-00000000000b', 'MonSun', '{"payWeek":{"weekStartDay":1,"cutoffTime":"23:59","paydayWeekday":5,"lateFunding":{"weekday":3,"time":"23:59"}}}', 'America/New_York'),
                        ('00000000-0000-0000-0000-00000000000c', 'BadZone', '{"payWeek":{"weekStartDay":"1"}}', 'Mars/Olympus');
INSERT INTO users VALUES ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000b', 'Owner', 'admin', true, true),
                         ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-00000000000b', 'Rep', 'canvasser', true, false),
                         ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-00000000000a', 'Other co', 'canvasser', true, false);

-- 1. payroll_org_week = readPayWeekSchedule ---------------------------------------------------------------------------------
DO $$ DECLARE r record; BEGIN
  SELECT * INTO r FROM arx_private.payroll_org_week('00000000-0000-0000-0000-00000000000a');
  IF r.tz <> 'America/New_York' OR r.cutoff_time <> time '23:59:59.999' OR r.payday_offset <> 2 THEN RAISE EXCEPTION 'legacy week wrong: %', r; END IF;
  SELECT * INTO r FROM arx_private.payroll_org_week('00000000-0000-0000-0000-00000000000b');
  IF r.payday_offset <> 5 OR r.cutoff_time <> time '23:59:59.999' THEN RAISE EXCEPTION 'mon-sun week wrong: %', r; END IF;
  SELECT * INTO r FROM arx_private.payroll_org_week('00000000-0000-0000-0000-00000000000c');
  IF r.tz <> 'America/New_York' OR r.payday_offset <> 2 THEN RAISE EXCEPTION 'junk settings/zone must fall back: %', r; END IF;
  RAISE NOTICE 'PASS 1 payroll_org_week';
END $$;

-- 2. Approve on Mon–Sun, fall-back week: minimum top-up stored + counted; negative balance carried to the next SUNDAY 23:59:59.999 local, paid FRIDAY.
DO $$
DECLARE v_org uuid := '00000000-0000-0000-0000-00000000000b'; v_p uuid := gen_random_uuid(); v_tok uuid := gen_random_uuid(); v_res jsonb; v_next record; v_raw numeric;
BEGIN
  -- Week Mon 10-26 – Sun 11-01 (clocks fall back that Sunday): cutoff Sun 11-01 23:59:59.999 EST.
  INSERT INTO payroll_periods (id, org_id, period_label, cutoff_at, lock_at, scheduled_pay_date) VALUES (v_p, v_org, 'Week ending 2026-11-01', '2026-11-02T04:59:59.999Z', '2026-11-02T04:59:59.999Z', '2026-11-06');
  INSERT INTO payroll_payout_lines (org_id, payroll_period_id, job_id, user_id, participant_role, gross_amount, net_amount) VALUES (v_org, v_p, gen_random_uuid(), '00000000-0000-0000-0000-0000000000a2', 'setter', 180, 180);
  INSERT INTO payroll_adjustments (org_id, payroll_period_id, user_id, amount, reason) VALUES (v_org, v_p, '00000000-0000-0000-0000-0000000000a1', -50, 'clawback');
  INSERT INTO payroll_week_minimums (org_id, payroll_period_id, user_id, met) VALUES (v_org, v_p, '00000000-0000-0000-0000-0000000000a2', true);
  UPDATE payroll_periods SET lock_claim_token = v_tok, lock_claimed_at = now() WHERE id = v_p;
  v_res := payroll_commit_week(v_org, v_p, v_tok, '00000000-0000-0000-0000-0000000000a1', 500,
    jsonb_build_object('jobs', '[]'::jsonb, 'units', '[]'::jsonb, 'minimums', jsonb_build_array(jsonb_build_object('user_id', '00000000-0000-0000-0000-0000000000a2', 'amount', 320, 'detail', '{"minimum":500,"commission":180}'::jsonb))));
  IF (v_res->>'total')::numeric <> 500 OR (v_res->>'carried')::int <> 1 THEN RAISE EXCEPTION 'commit result %', v_res; END IF;
  SELECT raw INTO v_raw FROM payroll_week_person_totals(v_org, v_p) WHERE user_id = '00000000-0000-0000-0000-0000000000a2';
  IF v_raw <> 500 THEN RAISE EXCEPTION 'total with minimum %', v_raw; END IF;
  IF (SELECT met FROM payroll_week_minimums WHERE payroll_period_id = v_p) IS NOT TRUE THEN RAISE EXCEPTION 'answer lost'; END IF;
  SELECT p.* INTO v_next FROM payroll_periods p JOIN payroll_adjustments a ON a.payroll_period_id = p.id WHERE a.source_period_id = v_p;
  IF v_next.cutoff_at <> '2026-11-09T04:59:59.999Z'::timestamptz OR v_next.scheduled_pay_date <> date '2026-11-13' OR v_next.period_label <> 'Week ending 2026-11-08' THEN
    RAISE EXCEPTION 'carry target wrong: % % %', v_next.cutoff_at, v_next.scheduled_pay_date, v_next.period_label;
  END IF;
  RAISE NOTICE 'PASS 2 commit: minimum frozen + counted; carry to Sun 11-08 23:59:59.999 EST, paid Fri 11-13';
END $$;

-- 3. Writer guard (new transaction: the commit's bypass is transaction-local): no answer may change on an approved week.
DO $$ BEGIN
  BEGIN
    UPDATE payroll_week_minimums SET met = false WHERE payroll_period_id = (SELECT id FROM payroll_periods WHERE period_label = 'Week ending 2026-11-01');
    RAISE EXCEPTION 'guard did not fire';
  EXCEPTION WHEN SQLSTATE '55006' THEN RAISE NOTICE 'PASS 3 minimum answers frozen on an approved week';
  END;
END $$;

-- 4. Spring forward: a Mon–Sun carry from the week ending Sun 03-01 lands on Sun 03-08 23:59:59.999 EDT.
DO $$
DECLARE v_org uuid := '00000000-0000-0000-0000-00000000000b'; v_p uuid := gen_random_uuid(); v_tok uuid := gen_random_uuid(); v_next record;
BEGIN
  INSERT INTO payroll_periods (id, org_id, period_label, cutoff_at, lock_at, scheduled_pay_date) VALUES (v_p, v_org, 'Week ending 2026-03-01', '2026-03-02T04:59:59.999Z', '2026-03-02T04:59:59.999Z', '2026-03-06');
  INSERT INTO payroll_adjustments (org_id, payroll_period_id, user_id, amount, reason) VALUES (v_org, v_p, '00000000-0000-0000-0000-0000000000a2', -10, 'x');
  UPDATE payroll_periods SET lock_claim_token = v_tok, lock_claimed_at = now() WHERE id = v_p;
  PERFORM payroll_commit_week(v_org, v_p, v_tok, '00000000-0000-0000-0000-0000000000a1', 0, '{"jobs":[],"units":[]}'::jsonb);
  SELECT p.* INTO v_next FROM payroll_periods p JOIN payroll_adjustments a ON a.payroll_period_id = p.id WHERE a.source_period_id = v_p;
  IF v_next.cutoff_at <> '2026-03-09T03:59:59.999Z'::timestamptz OR v_next.scheduled_pay_date <> date '2026-03-13' THEN RAISE EXCEPTION 'spring carry wrong: % %', v_next.cutoff_at, v_next.scheduled_pay_date; END IF;
  RAISE NOTICE 'PASS 4 spring-forward carry to Sun 03-08 23:59:59.999 EDT, paid Fri 03-13';
END $$;

-- 5. Legacy company unchanged: carry lands on Wednesday 23:59:59.999, paid the Friday after.
DO $$
DECLARE v_org uuid := '00000000-0000-0000-0000-00000000000a'; v_p uuid := gen_random_uuid(); v_tok uuid := gen_random_uuid(); v_next record;
BEGIN
  INSERT INTO payroll_periods (id, org_id, period_label, cutoff_at, lock_at, scheduled_pay_date) VALUES (v_p, v_org, 'Week ending 2026-10-28', '2026-10-29T03:59:59.999Z', '2026-10-29T03:59:59.999Z', '2026-10-30');
  INSERT INTO payroll_adjustments (org_id, payroll_period_id, user_id, amount, reason) VALUES (v_org, v_p, '00000000-0000-0000-0000-0000000000a3', -10, 'x');
  UPDATE payroll_periods SET lock_claim_token = v_tok, lock_claimed_at = now() WHERE id = v_p;
  PERFORM payroll_commit_week(v_org, v_p, v_tok, '00000000-0000-0000-0000-0000000000a3', 0, '{"jobs":[],"units":[]}'::jsonb);
  SELECT p.* INTO v_next FROM payroll_periods p JOIN payroll_adjustments a ON a.payroll_period_id = p.id WHERE a.source_period_id = v_p;
  IF v_next.cutoff_at <> '2026-11-05T04:59:59.999Z'::timestamptz OR v_next.scheduled_pay_date <> date '2026-11-06' THEN RAISE EXCEPTION 'legacy carry changed: % %', v_next.cutoff_at, v_next.scheduled_pay_date; END IF;
  RAISE NOTICE 'PASS 5 legacy company: Wed 11-04 23:59:59.999 EST, Fri 11-06 (as before)';
END $$;

-- 6. Job split: one transaction, audited, unchanged rows skipped, refused once paid / other company's person.
DO $$
DECLARE v_org uuid := '00000000-0000-0000-0000-00000000000b'; v_job uuid := gen_random_uuid(); v_res jsonb; v_p uuid := gen_random_uuid();
BEGIN
  INSERT INTO production_jobs (id, org_id, job_number, status) VALUES (v_job, v_org, '26-9001', 'complete');
  v_res := payroll_set_job_split(v_org, v_job, NULL, '00000000-0000-0000-0000-0000000000a1', 'Closed alone',
    '[{"user_id":"00000000-0000-0000-0000-0000000000a1","role":"closer","override_percent":9,"override_amount":null,"clear":false},
      {"user_id":"00000000-0000-0000-0000-0000000000a2","role":"setter","override_percent":0,"override_amount":null,"clear":false}]'::jsonb);
  IF (v_res->>'changed')::int <> 2 OR (SELECT count(*) FROM payroll_override_audit WHERE job_id = v_job) <> 2 THEN RAISE EXCEPTION 'split write %', v_res; END IF;
  v_res := payroll_set_job_split(v_org, v_job, NULL, '00000000-0000-0000-0000-0000000000a1', 'same again', '[{"user_id":"00000000-0000-0000-0000-0000000000a1","role":"closer","override_percent":9,"override_amount":null,"clear":false}]'::jsonb);
  IF (v_res->>'changed')::int <> 0 THEN RAISE EXCEPTION 'unchanged row was rewritten'; END IF;
  v_res := payroll_set_job_split(v_org, v_job, NULL, '00000000-0000-0000-0000-0000000000a1', 'back', '[{"user_id":"00000000-0000-0000-0000-0000000000a2","role":"setter","override_percent":null,"override_amount":null,"clear":true}]'::jsonb);
  IF EXISTS (SELECT 1 FROM deal_commission_roles WHERE job_id = v_job AND role = 'setter') THEN RAISE EXCEPTION 'clear did not delete'; END IF;
  BEGIN
    PERFORM payroll_set_job_split(v_org, v_job, NULL, '00000000-0000-0000-0000-0000000000a1', 'x', '[{"user_id":"00000000-0000-0000-0000-0000000000a3","role":"custom","override_percent":1,"override_amount":null,"clear":false}]'::jsonb);
    RAISE EXCEPTION 'foreign user accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'job_split:user_not_found%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM payroll_set_job_split(v_org, v_job, NULL, '00000000-0000-0000-0000-0000000000a1', '  ', '[]'::jsonb);
    RAISE EXCEPTION 'blank reason accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'job_split:reason_required%' THEN RAISE; END IF;
  END;
  INSERT INTO payroll_periods (id, org_id, period_label, cutoff_at, status) VALUES (v_p, v_org, 'paid wk', now() - interval '30 days', 'locked');
  INSERT INTO payroll_payout_lines (org_id, payroll_period_id, job_id, user_id, participant_role, gross_amount, net_amount) VALUES (v_org, v_p, v_job, '00000000-0000-0000-0000-0000000000a1', 'sales_rep', 1, 1);
  BEGIN
    PERFORM payroll_set_job_split(v_org, v_job, NULL, '00000000-0000-0000-0000-0000000000a1', 'x', '[]'::jsonb);
    RAISE EXCEPTION 'paid job re-split';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'job_split:already_paid%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS 6 job split atomic + audited; refusals';
END $$;

-- 7. Data fix: an old empty-of-money open week is cancelled (hours kept), one with lines is refused; undo reopens.
DO $$
DECLARE v_org uuid := '00000000-0000-0000-0000-00000000000a'; v_stale uuid := gen_random_uuid(); v_busy uuid := gen_random_uuid(); v_res jsonb;
BEGIN
  INSERT INTO payroll_periods (id, org_id, period_label, cutoff_at, scheduled_pay_date) VALUES (v_stale, v_org, '2026-W27', '2026-07-01T16:21:00Z', '2026-07-03'),
                                                                                             (v_busy, v_org, 'busy', '2026-07-08T16:21:00Z', '2026-07-10');
  INSERT INTO payroll_rep_hours (org_id, payroll_period_id, user_id, regular_hours, hourly_earnings) VALUES (v_org, v_stale, '00000000-0000-0000-0000-0000000000a3', 36, 180);
  INSERT INTO payroll_payout_lines (org_id, payroll_period_id, job_id, user_id, participant_role, gross_amount, net_amount) VALUES (v_org, v_busy, gen_random_uuid(), '00000000-0000-0000-0000-0000000000a3', 'setter', 1, 1);
  v_res := release_backups.close_stale_payroll_weeks(v_org, 'preview');
  IF jsonb_array_length((release_backups.close_stale_payroll_weeks('00000000-0000-0000-0000-00000000000b', 'preview'))->'will_cancel') <> 0 THEN RAISE EXCEPTION 'other company touched'; END IF;
  -- will cancel exactly the stale week; refuses 'busy' (a line) and the carry target from case 4 (a pending balance fix).
  IF jsonb_array_length(v_res->'will_cancel') <> 1 OR (v_res->'will_cancel'->0->>'id')::uuid <> v_stale
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_res->'refused_money_in_flight') x WHERE (x->>'id')::uuid = v_busy) THEN RAISE EXCEPTION 'preview %', v_res; END IF;
  IF (SELECT status FROM payroll_periods WHERE id = v_stale) <> 'open' THEN RAISE EXCEPTION 'preview wrote'; END IF;
  v_res := release_backups.close_stale_payroll_weeks(v_org, 'apply');
  IF (SELECT status FROM payroll_periods WHERE id = v_stale) <> 'cancelled' OR (SELECT status FROM payroll_periods WHERE id = v_busy) <> 'open' THEN RAISE EXCEPTION 'apply %', v_res; END IF;
  IF (SELECT count(*) FROM payroll_rep_hours WHERE payroll_period_id = v_stale) <> 1 THEN RAISE EXCEPTION 'hours history lost'; END IF;
  v_res := release_backups.undo_close_stale_payroll_weeks();
  IF (SELECT status FROM payroll_periods WHERE id = v_stale) <> 'open' THEN RAISE EXCEPTION 'undo %', v_res; END IF;
  RAISE NOTICE 'PASS 7 stale-week data fix preview/apply/undo';
END $$;

-- 8. Schedule change Wed -> Thu (one day): carry-over from an old Wednesday week lands on the NEXT DAY's Thursday week, a new row,
--    never the old Wednesday week 1 day away (±36 h window, date must match).
DO $$
DECLARE v_org uuid := gen_random_uuid(); v_p uuid := gen_random_uuid(); v_tok uuid := gen_random_uuid(); v_next record;
BEGIN
  INSERT INTO orgs VALUES (v_org, 'WedToThu', '{"payWeek":{"weekStartDay":5,"cutoffTime":"23:59","paydayWeekday":5,"lateFunding":null}}', 'America/New_York');
  INSERT INTO users VALUES (gen_random_uuid(), v_org, 'x', 'admin', true, true);
  -- the old Wednesday week (ending 11-04) is being approved; next Wednesday's old week (11-11) also exists, open.
  INSERT INTO payroll_periods (id, org_id, period_label, cutoff_at, lock_at, scheduled_pay_date) VALUES (v_p, v_org, 'Week ending 2026-11-04', '2026-11-05T04:59:59.999Z', '2026-11-05T04:59:59.999Z', '2026-11-06');
  INSERT INTO payroll_periods (org_id, period_label, cutoff_at, scheduled_pay_date) VALUES (v_org, 'Week ending 2026-11-11', '2026-11-12T04:59:59.999Z', '2026-11-13');
  INSERT INTO payroll_adjustments (org_id, payroll_period_id, user_id, amount, reason) VALUES (v_org, v_p, (SELECT id FROM users WHERE org_id = v_org), -10, 'x');
  UPDATE payroll_periods SET lock_claim_token = v_tok, lock_claimed_at = now() WHERE id = v_p;
  PERFORM payroll_commit_week(v_org, v_p, v_tok, (SELECT id FROM users WHERE org_id = v_org), 0, '{"jobs":[],"units":[]}'::jsonb);
  SELECT p.* INTO v_next FROM payroll_periods p JOIN payroll_adjustments a ON a.payroll_period_id = p.id WHERE a.source_period_id = v_p;
  IF v_next.cutoff_at <> '2026-11-06T04:59:59.999Z'::timestamptz OR v_next.period_label <> 'Week ending 2026-11-05' THEN RAISE EXCEPTION 'one-day shift carry wrong: % %', v_next.cutoff_at, v_next.period_label; END IF;
  RAISE NOTICE 'PASS 8 Wed->Thu: carry lands on Thu 11-05 (new row), not the old Wed week';
END $$;

-- 9. Closing an old open week on a schedule change: hours / bonus / pending fix move in one step, minimum answers dropped, week cancelled.
DO $$
DECLARE v_org uuid := '00000000-0000-0000-0000-00000000000b'; v_old uuid := gen_random_uuid(); v_new uuid := gen_random_uuid(); v_res jsonb;
BEGIN
  INSERT INTO payroll_periods (id, org_id, period_label, cutoff_at, scheduled_pay_date) VALUES (v_old, v_org, 'old wed', '2026-12-03T04:59:59.999Z', '2026-12-04'),
                                                                                            (v_new, v_org, 'new sun', '2026-12-07T04:59:59.999Z', '2026-12-11');
  INSERT INTO payroll_rep_hours (org_id, payroll_period_id, user_id, regular_hours, hourly_earnings) VALUES (v_org, v_old, '00000000-0000-0000-0000-0000000000a2', 5, 50);
  INSERT INTO payroll_bonus_lines (org_id, payroll_period_id, user_id, amount, status, bonus_type) VALUES (v_org, v_old, '00000000-0000-0000-0000-0000000000a2', 100, 'approved', 'manual');
  INSERT INTO payroll_adjustments (org_id, payroll_period_id, user_id, amount, reason) VALUES (v_org, v_old, '00000000-0000-0000-0000-0000000000a2', 25, 'fix');
  INSERT INTO payroll_week_minimums (org_id, payroll_period_id, user_id, met) VALUES (v_org, v_old, '00000000-0000-0000-0000-0000000000a2', true);
  v_res := payroll_move_open_week(v_org, v_old, v_new);
  IF (v_res->>'hours')::int <> 1 OR (v_res->>'bonuses')::int <> 1 OR (v_res->>'fixes')::int <> 1 THEN RAISE EXCEPTION 'move %', v_res; END IF;
  IF (SELECT status FROM payroll_periods WHERE id = v_old) <> 'cancelled' THEN RAISE EXCEPTION 'old week not closed'; END IF;
  IF (SELECT raw FROM payroll_week_person_totals(v_org, v_new) WHERE user_id = '00000000-0000-0000-0000-0000000000a2') <> 175 THEN RAISE EXCEPTION 'moved total wrong'; END IF;
  IF EXISTS (SELECT 1 FROM payroll_week_minimums WHERE payroll_period_id = v_old) THEN RAISE EXCEPTION 'answers kept'; END IF;
  -- a second move into a week that already has that person's hours is refused, nothing moved
  INSERT INTO payroll_periods (id, org_id, period_label, cutoff_at, scheduled_pay_date) VALUES (v_old, v_org, 'old wed 2', '2026-12-10T04:59:59.999Z', '2026-12-11')
    ON CONFLICT (id) DO UPDATE SET status = 'open';
  INSERT INTO payroll_rep_hours (org_id, payroll_period_id, user_id, regular_hours, hourly_earnings) VALUES (v_org, v_old, '00000000-0000-0000-0000-0000000000a2', 1, 10);
  BEGIN
    PERFORM payroll_move_open_week(v_org, v_old, v_new);
    RAISE EXCEPTION 'conflict accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'move_week:hours_conflict%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS 9 old open week closed cleanly; conflicts refused';
END $$;

SELECT 'ALL PAYROLL PHASE1 TESTS PASSED';
