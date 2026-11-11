-- Payroll phase 1 ("make it solid"), new pay-week path only. Additive; nothing reads these while PAYROLL_PAY_WEEK_ENABLED is off.
--   1. Pay week per company: arx_private.payroll_org_week() reads orgs.settings.payWeek + orgs.timezone, the SQL twin of
--      lib/payroll-week-schedule.ts (readPayWeekSchedule). payroll_commit_week's carry-over target now uses it instead of a
--      hard-coded Eastern Wednesday + Friday. No saved schedule = the old values (Thursday-Wednesday, 23:59:59.999, payday +2).
--   2. Weekly minimum ("greater of a fixed amount or the commission"): comp_plans.weekly_minimum + payroll_week_minimums
--      (the office's yes/no answer and, at approval, the frozen top-up). Writer guard = the same trigger as hours/bonuses/fixes.
--   3. payroll_week_person_totals counts the minimum top-up. It is the SQL copy of ONE definition, PAY_LINE_SOURCES in
--      lib/payroll-week-total.ts; lib/__tests__/payroll-week-total-parity.test.ts reads this file and fails if they differ.
--   6. payroll_set_pay_week(): the setting + closing old open weeks in ONE transaction.
--   5. payroll_move_open_week(): a pay-week change closes an old-schedule open week cleanly (its hours/bonuses/fixes move forward).
--   4. payroll_set_job_split(): the "Change" sheet's one write — every per-job commission change (deal_commission_roles) and its
--      audit rows for one job in ONE transaction, refused once the job is paid.
-- Run AFTER 202610280010_atomic_approve_and_field_role_deny.sql. Deploy order: this migration, then the code (the code only calls
-- these when the flag is on; payroll_set_job_split missing answers 503 "needs the database update").
-- Rollback: DROP FUNCTION public.payroll_set_pay_week(uuid, jsonb); DROP FUNCTION public.payroll_move_open_week(uuid, uuid, uuid); DROP FUNCTION public.payroll_week_minimum_unanswered(uuid, uuid); DROP FUNCTION public.payroll_set_job_split(uuid, uuid, uuid, uuid, text, jsonb); DROP TABLE payroll_week_minimums;
--   ALTER TABLE comp_plans DROP COLUMN weekly_minimum; DROP FUNCTION arx_private.payroll_org_week(uuid); then re-run sections 3 and 4
--   of 202610280010 (payroll_week_person_totals and payroll_commit_week as they were).
SET lock_timeout = '5s';

-- 1. The company's pay week (SQL twin of readPayWeekSchedule) ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION arx_private.payroll_org_week(p_org_id uuid)
RETURNS TABLE (tz text, cutoff_time time, payday_offset integer, cutoff_dow integer)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_settings jsonb;
  v_tz text;
  v_start integer := 4;          -- LEGACY_PAY_WEEK.weekStartDay (Thursday)
  v_cut text := '23:59';          -- LEGACY_PAY_WEEK.cutoffTime
  v_pay integer := 5;            -- LEGACY_PAY_WEEK.paydayWeekday (Friday)
  v_pw jsonb;
  v_cutday integer;
BEGIN
  SELECT o.settings, o.timezone INTO v_settings, v_tz FROM orgs o WHERE o.id = p_org_id;
  -- orgTimeZone(): a valid IANA zone, else the app default.
  IF v_tz IS NULL OR btrim(v_tz) = '' OR NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = btrim(v_tz)) THEN
    v_tz := 'America/New_York';   -- DEFAULT_TIMEZONE (lib/timezone.ts)
  END IF;
  v_pw := v_settings->'payWeek';
  -- parsePayWeek(): only a complete, valid schedule replaces the legacy one.
  IF jsonb_typeof(v_pw) = 'object'
     AND jsonb_typeof(v_pw->'weekStartDay') = 'number' AND (v_pw->>'weekStartDay') ~ '^[0-6]$'
     AND jsonb_typeof(v_pw->'paydayWeekday') = 'number' AND (v_pw->>'paydayWeekday') ~ '^[0-6]$'
     AND (v_pw->>'cutoffTime') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
    v_start := (v_pw->>'weekStartDay')::integer;
    v_cut := v_pw->>'cutoffTime';
    v_pay := (v_pw->>'paydayWeekday')::integer;
  END IF;
  v_cutday := (v_start + 6) % 7;                                     -- cutoffWeekday()
  tz := btrim(v_tz);
  cutoff_time := (v_cut || ':59.999')::time;                         -- localInstant(): HH:MM:59.999
  payday_offset := COALESCE(NULLIF((v_pay - v_cutday + 7) % 7, 0), 7);  -- paydayOffsetDays()
  cutoff_dow := v_cutday;                                            -- cutoffWeekday() (0 = Sunday, as extract(dow))
  RETURN NEXT;
END;
$$;

-- 2. Weekly minimum -----------------------------------------------------------------------------------------------------------
ALTER TABLE comp_plans ADD COLUMN IF NOT EXISTS weekly_minimum jsonb;
COMMENT ON COLUMN comp_plans.weekly_minimum IS
  '{ "amount": number, "needsCheck": boolean } or NULL. Pay for the week = the greater of amount or the person''s commission lines that week '
  '(lib/payroll-weekly-minimum.ts). needsCheck = the office confirms the week''s requirements were met. Edited in place: an approved '
  'week stores its top-up in payroll_week_minimums and never recalculates.';

CREATE TABLE IF NOT EXISTS payroll_week_minimums (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  payroll_period_id UUID NOT NULL REFERENCES payroll_periods(id) ON DELETE RESTRICT,
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  met               BOOLEAN,                                -- the office's answer; NULL = not asked / not needed
  decided_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_at        TIMESTAMPTZ,
  amount            NUMERIC(14, 2),                         -- the top-up, written ONLY by payroll_commit_week at approval
  detail            JSONB,                                  -- { minimum, commission, plan } for the line's math
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (payroll_period_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_payroll_week_minimums_org_user ON payroll_week_minimums(org_id, user_id);
ALTER TABLE payroll_week_minimums ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON payroll_week_minimums FROM anon, authenticated;
COMMENT ON TABLE payroll_week_minimums IS 'Weekly minimum per person per week: the office''s yes/no and the top-up frozen at approval. Service role only.';

DROP TRIGGER IF EXISTS trg_guard_claimed_period ON payroll_week_minimums;
CREATE TRIGGER trg_guard_claimed_period BEFORE INSERT OR UPDATE OR DELETE ON payroll_week_minimums
  FOR EACH ROW EXECUTE FUNCTION public.payroll_guard_claimed_period();

-- 2b. Who still needs an answer for the weekly minimum this week (SQL twin of loadWeekMinimums' "needs_answer"; lib/payroll-weekly-minimum.ts).
-- A person on a plan with a weekly minimum, whose basis earnings this week are below the (pro-rated) minimum, whose plan needs the
-- office's check (or who has left), and who has no yes/no yet. payroll_commit_week refuses to approve while anyone is listed.
CREATE OR REPLACE FUNCTION public.payroll_week_minimum_unanswered(p_org_id uuid, p_period_id uuid)
RETURNS TABLE (user_id uuid, minimum numeric, earned numeric)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH w AS (SELECT * FROM arx_private.payroll_org_week(p_org_id)),
  per AS (
    SELECT p.id, p.cutoff_at, (p.cutoff_at AT TIME ZONE w.tz)::date AS d, w.tz
    FROM payroll_periods p, w WHERE p.id = p_period_id AND p.org_id = p_org_id
  ),
  prev AS (
    SELECT max((pp.cutoff_at AT TIME ZONE per.tz)::date) AS d FROM payroll_periods pp, per
    WHERE pp.org_id = p_org_id AND pp.status <> 'cancelled' AND pp.cutoff_at < per.cutoff_at AND pp.id <> per.id
  ),
  days AS (SELECT CASE WHEN prev.d IS NOT NULL AND per.d - prev.d BETWEEN 1 AND 13 THEN per.d - prev.d ELSE 7 END AS n FROM per, prev),
  plans AS (
    SELECT DISTINCT ON (ucp.user_id) ucp.user_id, cp.weekly_minimum AS wm
    FROM user_comp_plans ucp JOIN comp_plans cp ON cp.id = ucp.comp_plan_id, per
    WHERE ucp.org_id = p_org_id AND ucp.effective_from <= per.d AND (ucp.effective_to IS NULL OR ucp.effective_to >= per.d)
    ORDER BY ucp.user_id, ucp.effective_from DESC
  ),
  rules AS (  -- parseWeeklyMinimum()
    SELECT pl.user_id, (pl.wm->>'amount')::numeric AS amt,
           COALESCE(pl.wm->>'needsCheck', 'true') <> 'false' AS chk,
           COALESCE(pl.wm->>'prorate', 'true') <> 'false' AS pr,
           CASE WHEN pl.wm->>'basis' = 'commission' THEN 'commission' ELSE 'gross' END AS basis
    FROM plans pl
    WHERE jsonb_typeof(pl.wm) = 'object' AND (pl.wm->>'amount') ~ '^[0-9]+(\.[0-9]+)?$'
      AND (pl.wm->>'amount')::numeric > 0 AND (pl.wm->>'amount')::numeric <= 100000
  ),
  lines AS (  -- countsTowardMinimum(): kind, amount
    SELECT l.user_id, 'commission' AS k, round(l.net_amount, 2) AS amt FROM payroll_payout_lines l WHERE l.org_id = p_org_id AND l.payroll_period_id = p_period_id
    UNION ALL SELECT a.user_id, 'commission', round(a.amount, 2) FROM payroll_adjustments a
      WHERE a.org_id = p_org_id AND a.payroll_period_id = p_period_id AND a.status <> 'void' AND a.kind = 'fix' AND a.job_id IS NOT NULL
    UNION ALL SELECT h.user_id, 'gross', round(h.hourly_earnings, 2) FROM payroll_rep_hours h WHERE h.org_id = p_org_id AND h.payroll_period_id = p_period_id AND COALESCE(h.hourly_earnings, 0) > 0
    UNION ALL SELECT u.user_id, 'gross', round(u.amount, 2) FROM payroll_unit_earnings u WHERE u.org_id = p_org_id AND u.payroll_period_id = p_period_id AND u.amount > 0
    UNION ALL SELECT b.user_id, 'gross', round(b.amount, 2) FROM payroll_bonus_lines b WHERE b.org_id = p_org_id AND b.payroll_period_id = p_period_id AND b.status IN ('approved', 'paid')
  ),
  scored AS (
    SELECT r.user_id,
           CASE WHEN r.pr AND days.n <> 7 THEN round(r.amt * days.n / 7, 2) ELSE r.amt END AS minimum,
           COALESCE((SELECT sum(x.amt) FROM lines x WHERE x.user_id = r.user_id AND (x.k = 'commission' OR r.basis = 'gross')), 0) AS earned,
           r.chk, COALESCE(us.active, true) AS active
    FROM rules r JOIN users us ON us.id = r.user_id AND us.org_id = p_org_id, days
    WHERE COALESCE(us.is_test_account, false) = false
  )
  SELECT sc.user_id, sc.minimum, sc.earned FROM scored sc
  WHERE round(sc.minimum - sc.earned, 2) > 0
    AND (sc.chk OR NOT sc.active)
    AND NOT EXISTS (SELECT 1 FROM payroll_week_minimums m WHERE m.payroll_period_id = p_period_id AND m.user_id = sc.user_id AND m.met IS NOT NULL);
$$;

-- 3. One person-total definition (SQL copy of PAY_LINE_SOURCES, lib/payroll-week-total.ts) ------------------------------------
CREATE OR REPLACE FUNCTION public.payroll_week_person_totals(p_org_id uuid, p_period_id uuid)
RETURNS TABLE (user_id uuid, raw numeric)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT x.user_id, round(sum(x.amt), 2) AS raw FROM (
    SELECT l.user_id, round(l.net_amount, 2) AS amt FROM payroll_payout_lines l WHERE l.org_id = p_org_id AND l.payroll_period_id = p_period_id
    UNION ALL
    SELECT h.user_id, round(h.hourly_earnings, 2) FROM payroll_rep_hours h WHERE h.org_id = p_org_id AND h.payroll_period_id = p_period_id AND COALESCE(h.hourly_earnings, 0) > 0
    UNION ALL
    SELECT u.user_id, round(u.amount, 2) FROM payroll_unit_earnings u WHERE u.org_id = p_org_id AND u.payroll_period_id = p_period_id AND u.amount > 0
    UNION ALL
    SELECT m.user_id, round(m.amount, 2) FROM payroll_week_minimums m WHERE m.org_id = p_org_id AND m.payroll_period_id = p_period_id AND COALESCE(m.amount, 0) > 0
    UNION ALL
    SELECT b.user_id, round(b.amount, 2) FROM payroll_bonus_lines b WHERE b.org_id = p_org_id AND b.payroll_period_id = p_period_id AND b.status IN ('approved', 'paid')
    UNION ALL
    SELECT a.user_id, round(a.amount, 2) FROM payroll_adjustments a WHERE a.org_id = p_org_id AND a.payroll_period_id = p_period_id AND a.status <> 'void'
  ) x GROUP BY x.user_id;
$$;

-- The atomic commit, now with the weekly minimum and the company's pay week for the carry-over target.
-- p_plan = { jobs: [...], units: [{ user_id, amount, detail }], minimums: [{ user_id, amount, detail }] }
CREATE OR REPLACE FUNCTION public.payroll_commit_week(
  p_org_id uuid,
  p_period_id uuid,
  p_token uuid,
  p_actor_user_id uuid,
  p_expected_total numeric,
  p_plan jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_period payroll_periods%ROWTYPE;
  v_next payroll_periods%ROWTYPE;
  v_psnap uuid;
  v_job jsonb;
  v_snap_id uuid;
  v_live record;
  v_n integer;
  v_lines integer := 0;
  v_snapshots integer := 0;
  v_total numeric;
  v_people integer;
  v_carried integer := 0;
  v_negative integer;
  v_date date;
  v_k integer;
  v_tc timestamptz;
  v_cand uuid;
  v_target uuid;
  v_week record;
  v_first date;
  v_day date;
BEGIN
  PERFORM set_config('arx.payroll_commit', 'on', true);

  SELECT * INTO v_period FROM payroll_periods WHERE id = p_period_id AND org_id = p_org_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'payroll_commit:not_found'; END IF;
  IF v_period.status <> 'open' OR v_period.lock_claim_token IS DISTINCT FROM p_token THEN
    RAISE EXCEPTION 'payroll_commit:claim_lost';
  END IF;

  -- Fixes for a paid week land on the next OPEN week: approving a later week first would strand them.
  IF EXISTS (
    SELECT 1 FROM payroll_adjustments a
    JOIN payroll_periods pp ON pp.id = a.payroll_period_id
    WHERE a.org_id = p_org_id AND a.status = 'pending' AND pp.status = 'open' AND pp.id <> p_period_id AND pp.cutoff_at < v_period.cutoff_at
  ) THEN
    RAISE EXCEPTION 'payroll_commit:earlier_week_open';
  END IF;

  IF jsonb_array_length(COALESCE(p_plan->'jobs', '[]'::jsonb)) > 0 THEN
    INSERT INTO payroll_period_snapshots (org_id, payroll_period_id, locked_at, locked_by)
    VALUES (p_org_id, p_period_id, now(), p_actor_user_id)
    ON CONFLICT (payroll_period_id) DO UPDATE SET locked_at = EXCLUDED.locked_at, locked_by = EXCLUDED.locked_by
    RETURNING id INTO v_psnap;
  END IF;

  FOR v_job IN SELECT * FROM jsonb_array_elements(COALESCE(p_plan->'jobs', '[]'::jsonb)) LOOP
    -- The inputs the plan was computed from must still be what is in the database.
    SELECT status, sale_amount, commission_comp_base, payroll_settled_externally_at INTO v_live
    FROM production_jobs WHERE id = (v_job->>'job_id')::uuid AND org_id = p_org_id FOR SHARE;
    IF NOT FOUND
       OR v_live.status NOT IN ('complete', 'collected')
       OR v_live.payroll_settled_externally_at IS NOT NULL
       OR v_live.sale_amount IS DISTINCT FROM NULLIF(v_job->>'sale_amount', '')::numeric
       OR v_live.commission_comp_base IS DISTINCT FROM NULLIF(v_job->>'commission_comp_base', '')::numeric THEN
      RAISE EXCEPTION 'payroll_commit:job_changed:%', v_job->>'job_id';
    END IF;

    INSERT INTO payroll_job_snapshots (
      org_id, payroll_period_snapshot_id, payroll_period_id, job_id, contract_total, signed_change_orders_total,
      commissionable_change_orders_total, dealer_fee, deductible_costs_total, commission_base, comp_plan_version,
      participants, gross_payout_total, net_payout_total, pay_date, payload
    )
    SELECT p_org_id, v_psnap, p_period_id, s.job_id, s.contract_total, s.signed_change_orders_total,
           s.commissionable_change_orders_total, s.dealer_fee, s.deductible_costs_total, s.commission_base, s.comp_plan_version,
           COALESCE(s.participants, '[]'::jsonb), s.gross_payout_total, s.net_payout_total, s.pay_date, s.payload
    FROM jsonb_populate_record(NULL::payroll_job_snapshots, v_job->'snapshot') s
    ON CONFLICT (payroll_period_id, job_id) DO UPDATE SET
      payroll_period_snapshot_id = EXCLUDED.payroll_period_snapshot_id, contract_total = EXCLUDED.contract_total,
      signed_change_orders_total = EXCLUDED.signed_change_orders_total,
      commissionable_change_orders_total = EXCLUDED.commissionable_change_orders_total, dealer_fee = EXCLUDED.dealer_fee,
      deductible_costs_total = EXCLUDED.deductible_costs_total, commission_base = EXCLUDED.commission_base,
      comp_plan_version = EXCLUDED.comp_plan_version, participants = EXCLUDED.participants,
      gross_payout_total = EXCLUDED.gross_payout_total, net_payout_total = EXCLUDED.net_payout_total,
      pay_date = EXCLUDED.pay_date, payload = EXCLUDED.payload
    RETURNING id INTO v_snap_id;
    v_snapshots := v_snapshots + 1;

    INSERT INTO payroll_payout_lines (
      org_id, payroll_period_id, payroll_job_snapshot_id, job_id, user_id, participant_role, gross_amount, net_amount,
      chargeback_applied_amount, comp_plan_snapshot
    )
    SELECT p_org_id, p_period_id, v_snap_id, l.job_id, l.user_id, l.participant_role, COALESCE(l.gross_amount, 0),
           COALESCE(l.net_amount, 0), COALESCE(l.chargeback_applied_amount, 0), l.comp_plan_snapshot
    FROM jsonb_populate_recordset(NULL::payroll_payout_lines, COALESCE(v_job->'lines', '[]'::jsonb)) l
    WHERE NOT EXISTS (
      SELECT 1 FROM payroll_payout_lines e
      WHERE e.payroll_period_id = p_period_id AND e.job_id = l.job_id AND e.user_id = l.user_id AND e.participant_role = l.participant_role
    );
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_lines := v_lines + v_n;

    INSERT INTO job_payroll_state (
      job_id, org_id, install_completed_at, fully_funded_at, costs_ready_at, payroll_eligible_at, payroll_cutoff_at,
      scheduled_pay_date, current_payroll_period_id, updated_at
    )
    SELECT st.job_id, p_org_id, st.install_completed_at, st.fully_funded_at, st.costs_ready_at, st.payroll_eligible_at,
           st.payroll_cutoff_at, st.scheduled_pay_date, p_period_id, now()
    FROM jsonb_populate_record(NULL::job_payroll_state, v_job->'state') st
    ON CONFLICT (job_id) DO UPDATE SET
      install_completed_at = EXCLUDED.install_completed_at, fully_funded_at = EXCLUDED.fully_funded_at,
      costs_ready_at = EXCLUDED.costs_ready_at, payroll_eligible_at = EXCLUDED.payroll_eligible_at,
      payroll_cutoff_at = EXCLUDED.payroll_cutoff_at, scheduled_pay_date = EXCLUDED.scheduled_pay_date,
      current_payroll_period_id = EXCLUDED.current_payroll_period_id, updated_at = EXCLUDED.updated_at;
  END LOOP;

  -- Freeze per-unit pay (replace, so a re-approved reopened week never keeps a stale person).
  DELETE FROM payroll_unit_earnings WHERE org_id = p_org_id AND payroll_period_id = p_period_id;
  INSERT INTO payroll_unit_earnings (org_id, payroll_period_id, user_id, amount, detail)
  SELECT p_org_id, p_period_id, (u->>'user_id')::uuid, round((u->>'amount')::numeric, 2), u->'detail'
  FROM jsonb_array_elements(COALESCE(p_plan->'units', '[]'::jsonb)) u
  WHERE (u->>'amount')::numeric > 0;

  -- Freeze each weekly minimum ("greater of $X or the commission"): the top-up the plan computed, on the person's row for this week.
  -- Replace semantics like per-unit pay: a person no longer owed a top-up keeps the row (their yes/no answer) with amount 0.
  UPDATE payroll_week_minimums SET amount = 0, detail = NULL, updated_at = now()
  WHERE org_id = p_org_id AND payroll_period_id = p_period_id;
  INSERT INTO payroll_week_minimums (org_id, payroll_period_id, user_id, amount, detail)
  SELECT p_org_id, p_period_id, (m->>'user_id')::uuid, round((m->>'amount')::numeric, 2), m->'detail'
  FROM jsonb_array_elements(COALESCE(p_plan->'minimums', '[]'::jsonb)) m
  WHERE (m->>'amount')::numeric > 0
  ON CONFLICT (payroll_period_id, user_id) DO UPDATE SET amount = EXCLUDED.amount, detail = EXCLUDED.detail, updated_at = now();

  -- Nobody may be left without an answer to their weekly minimum (approving would silently pay commission only).
  IF EXISTS (SELECT 1 FROM payroll_week_minimum_unanswered(p_org_id, p_period_id)) THEN
    RAISE EXCEPTION 'payroll_commit:minimum_unanswered';
  END IF;

  -- What the tables now say must equal what the admin approved, to the cent.
  SELECT COALESCE(sum(GREATEST(0, raw)), 0), count(*) FILTER (WHERE raw > 0), count(*) FILTER (WHERE raw < 0)
    INTO v_total, v_people, v_negative
  FROM payroll_week_person_totals(p_org_id, p_period_id);
  IF round(v_total, 2) <> round(p_expected_total, 2) THEN
    RAISE EXCEPTION 'payroll_commit:total_mismatch:%:%', round(v_total, 2), round(p_expected_total, 2);
  END IF;

  -- A check cannot go below $0: what is owed back is carried into the next OPEN week, once per person per source week.
  -- The target is found (or created) HERE, locked, and verified in this same transaction — never trusted from the caller.
  IF v_negative > 0 THEN
    SELECT * INTO v_week FROM arx_private.payroll_org_week(p_org_id);
    v_date := (v_period.cutoff_at AT TIME ZONE v_week.tz)::date;
    -- nextWeekCutoff(): the first cutoff day of the CURRENT schedule strictly after this week's date (after a pay-week change the
    -- week after an old Wednesday week is the first new Sunday week, never another Wednesday).
    v_first := v_date + COALESCE(NULLIF((v_week.cutoff_dow - extract(dow FROM v_date)::int + 7) % 7, 0), 7);
    v_target := NULL;
    FOR v_k IN 1..8 LOOP
      -- Calendar weeks in the company's zone, rebuilt with the timezone database (never fixed 24 h days).
      v_day := v_first + 7 * (v_k - 1);
      v_tc := (v_day + v_week.cutoff_time) AT TIME ZONE v_week.tz;
      -- sameWeekEnding(): the week whose cutoff falls on that calendar date in the company's zone (a one-day-off week never matches).
      SELECT id INTO v_cand FROM payroll_periods
        WHERE org_id = p_org_id AND status <> 'cancelled' AND cutoff_at BETWEEN v_tc - interval '36 hours' AND v_tc + interval '36 hours'
          AND (cutoff_at AT TIME ZONE v_week.tz)::date = v_day
        ORDER BY created_at, id LIMIT 1;
      IF v_cand IS NULL THEN
        INSERT INTO payroll_periods (org_id, period_label, cutoff_at, lock_at, scheduled_pay_date, status)
        VALUES (p_org_id, 'Week ending ' || to_char(v_day, 'YYYY-MM-DD'), v_tc, v_tc, (v_day + v_week.payday_offset), 'open')
        ON CONFLICT DO NOTHING;
        SELECT id INTO v_cand FROM payroll_periods
          WHERE org_id = p_org_id AND status <> 'cancelled' AND cutoff_at BETWEEN v_tc - interval '36 hours' AND v_tc + interval '36 hours'
            AND (cutoff_at AT TIME ZONE v_week.tz)::date = v_day
          ORDER BY created_at, id LIMIT 1;
        IF v_cand IS NULL THEN  -- the label is held by a CANCELLED week (findOrCreateWeek does the same)
          INSERT INTO payroll_periods (org_id, period_label, cutoff_at, lock_at, scheduled_pay_date, status)
          VALUES (p_org_id, 'Week ending ' || to_char(v_day, 'YYYY-MM-DD') || ' (2)', v_tc, v_tc, (v_day + v_week.payday_offset), 'open')
          ON CONFLICT DO NOTHING;
          SELECT id INTO v_cand FROM payroll_periods
            WHERE org_id = p_org_id AND status <> 'cancelled' AND cutoff_at BETWEEN v_tc - interval '36 hours' AND v_tc + interval '36 hours'
              AND (cutoff_at AT TIME ZONE v_week.tz)::date = v_day
            ORDER BY created_at, id LIMIT 1;
        END IF;
      END IF;
      CONTINUE WHEN v_cand IS NULL;
      SELECT * INTO v_next FROM payroll_periods WHERE id = v_cand AND org_id = p_org_id FOR UPDATE;
      CONTINUE WHEN NOT FOUND;
      IF v_next.status = 'open' THEN
        IF v_next.lock_claim_token IS NOT NULL AND v_next.lock_claimed_at IS NOT NULL AND v_next.lock_claimed_at > now() - interval '15 minutes' THEN
          RAISE EXCEPTION 'payroll_commit:next_week_busy';
        END IF;
        v_target := v_next.id;
        EXIT;
      END IF;
    END LOOP;
    IF v_target IS NULL THEN RAISE EXCEPTION 'payroll_commit:no_next_period'; END IF;
    INSERT INTO payroll_adjustments (org_id, payroll_period_id, user_id, amount, reason, kind, status, source_period_id, created_by)
    SELECT p_org_id, v_target, t.user_id, t.raw,
           'Carried over from the week ending ' || to_char(v_date, 'YYYY-MM-DD'),
           'balance', 'pending', p_period_id, p_actor_user_id
    FROM payroll_week_person_totals(p_org_id, p_period_id) t
    WHERE t.raw < 0
    ON CONFLICT (source_period_id, user_id) WHERE kind = 'balance' AND status <> 'void' DO NOTHING;
    GET DIAGNOSTICS v_carried = ROW_COUNT;
  END IF;

  -- The week's fixes are now part of an approved check.
  UPDATE payroll_adjustments SET status = 'applied', applied_at = now()
  WHERE org_id = p_org_id AND payroll_period_id = p_period_id AND status = 'pending';

  UPDATE payroll_periods
  SET status = 'locked', locked_at = now(), units_frozen_at = now(), lock_claimed_at = NULL, lock_claim_token = NULL
  WHERE id = p_period_id AND org_id = p_org_id;

  RETURN jsonb_build_object('ok', true, 'total', round(v_total, 2), 'people', v_people, 'snapshots', v_snapshots, 'lines', v_lines, 'carried', v_carried);
END;
$$;


-- Shares typed on the Change sheet (and automatic lines it pins) are kept to 6 decimals, not 2: a 1.333% manager override pinned
-- at 1.33% would pay a different number of cents. Widening a numeric is lossless for every existing value.
ALTER TABLE deal_commission_roles ALTER COLUMN override_percent TYPE numeric(10, 6);

-- 4. The Change sheet's one write ---------------------------------------------------------------------------------------------
-- p_rows = [{ user_id, role, override_percent | null, override_amount | null, clear: boolean }]: the final state of each
-- deal_commission_roles row the sheet touched. clear = delete the row (back to the pay plan). One audit row per real change.
CREATE OR REPLACE FUNCTION public.payroll_set_job_split(
  p_org_id uuid,
  p_job_id uuid,
  p_period_id uuid,
  p_actor_user_id uuid,
  p_reason text,
  p_rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_job record;
  v_row jsonb;
  v_user uuid;
  v_role text;
  v_pct numeric;
  v_amt numeric;
  v_old deal_commission_roles%ROWTYPE;
  v_found boolean;
  v_changed integer := 0;
BEGIN
  IF btrim(COALESCE(p_reason, '')) = '' THEN RAISE EXCEPTION 'job_split:reason_required'; END IF;
  SELECT id, payroll_settled_externally_at INTO v_job FROM production_jobs WHERE id = p_job_id AND org_id = p_org_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'job_split:job_not_found'; END IF;
  IF v_job.payroll_settled_externally_at IS NOT NULL THEN RAISE EXCEPTION 'job_split:settled_externally'; END IF;
  -- Settled pay stays settled: a job with lines in an approved week cannot be re-split (fix it on the next open week instead).
  IF EXISTS (SELECT 1 FROM payroll_payout_lines l JOIN payroll_periods pp ON pp.id = l.payroll_period_id
             WHERE l.org_id = p_org_id AND l.job_id = p_job_id AND pp.status IN ('locked', 'paid')) THEN
    RAISE EXCEPTION 'job_split:already_paid';
  END IF;
  -- Not while the week is being approved (the plan the approver is committing must not move under it).
  IF p_period_id IS NOT NULL AND EXISTS (SELECT 1 FROM payroll_periods WHERE id = p_period_id AND org_id = p_org_id
             AND lock_claim_token IS NOT NULL AND lock_claimed_at > now() - interval '15 minutes') THEN
    RAISE EXCEPTION 'payroll_period_claimed: this week is being approved right now; try again in a minute' USING ERRCODE = '55006';
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) LOOP
    v_user := (v_row->>'user_id')::uuid;
    v_role := v_row->>'role';
    v_pct := NULLIF(v_row->>'override_percent', '')::numeric;
    v_amt := NULLIF(v_row->>'override_amount', '')::numeric;
    IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_user AND org_id = p_org_id) THEN RAISE EXCEPTION 'job_split:user_not_found'; END IF;
    IF v_pct IS NOT NULL AND (v_pct < 0 OR v_pct > 100) THEN RAISE EXCEPTION 'job_split:bad_percent'; END IF;
    IF v_amt IS NOT NULL AND v_amt < 0 THEN RAISE EXCEPTION 'job_split:bad_amount'; END IF;
    IF v_pct IS NOT NULL AND v_amt IS NOT NULL THEN v_pct := NULL; END IF;  -- flat dollars win, as payroll reads it

    SELECT * INTO v_old FROM deal_commission_roles WHERE org_id = p_org_id AND job_id = p_job_id AND user_id = v_user AND role = v_role FOR UPDATE;
    v_found := FOUND;
    IF COALESCE((v_row->>'clear')::boolean, false) THEN
      CONTINUE WHEN NOT v_found;
      DELETE FROM deal_commission_roles WHERE id = v_old.id;
    ELSIF v_found THEN
      CONTINUE WHEN v_old.override_percent IS NOT DISTINCT FROM v_pct AND v_old.override_amount IS NOT DISTINCT FROM v_amt;
      UPDATE deal_commission_roles SET override_percent = v_pct, override_amount = v_amt WHERE id = v_old.id;
    ELSE
      INSERT INTO deal_commission_roles (org_id, job_id, user_id, role, override_percent, override_amount)
      VALUES (p_org_id, p_job_id, v_user, v_role, v_pct, v_amt);
    END IF;
    INSERT INTO payroll_override_audit (org_id, override_type, job_id, payroll_period_id, actor_user_id, reason, before_value, after_value)
    VALUES (p_org_id, 'manual_adjustment', p_job_id, p_period_id, p_actor_user_id, btrim(p_reason),
            CASE WHEN v_found THEN jsonb_build_object('override_amount', v_old.override_amount, 'override_percent', v_old.override_percent, 'role', v_role, 'user_id', v_user) END,
            CASE WHEN COALESCE((v_row->>'clear')::boolean, false) THEN NULL
                 ELSE jsonb_build_object('override_amount', v_amt, 'override_percent', v_pct, 'role', v_role, 'user_id', v_user) END);
    v_changed := v_changed + 1;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'changed', v_changed);
END;
$$;

-- 5. Closing an old-schedule open week when the pay week changes -------------------------------------------------------------
-- Everything still waiting on it (hours, bonuses, pending fixes and carried balances) moves to the new-schedule week p_to_id in ONE
-- transaction, then the old week is cancelled. Weekly-minimum answers are week-specific and are dropped (asked again on the new
-- week). Refused when the old week has pay lines (money already written), when either week is not open or is being approved, or
-- when the same person already has hours (or the same manual bonus) on the new week — the owner sorts that out first.
CREATE OR REPLACE FUNCTION public.payroll_move_open_week(p_org_id uuid, p_from_id uuid, p_to_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_from payroll_periods%ROWTYPE;
  v_to payroll_periods%ROWTYPE;
  v_h integer; v_b integer; v_a integer;
BEGIN
  IF p_from_id = p_to_id THEN RAISE EXCEPTION 'move_week:same_week'; END IF;
  SELECT * INTO v_from FROM payroll_periods WHERE id = p_from_id AND org_id = p_org_id FOR UPDATE;
  SELECT * INTO v_to FROM payroll_periods WHERE id = p_to_id AND org_id = p_org_id FOR UPDATE;
  IF v_from.id IS NULL OR v_to.id IS NULL THEN RAISE EXCEPTION 'move_week:not_found'; END IF;
  IF v_from.status <> 'open' OR v_to.status <> 'open' THEN RAISE EXCEPTION 'move_week:not_open'; END IF;
  IF (v_from.lock_claim_token IS NOT NULL AND v_from.lock_claimed_at > now() - interval '15 minutes')
     OR (v_to.lock_claim_token IS NOT NULL AND v_to.lock_claimed_at > now() - interval '15 minutes') THEN
    RAISE EXCEPTION 'payroll_period_claimed: a week is being approved right now; try again in a minute' USING ERRCODE = '55006';
  END IF;
  IF EXISTS (SELECT 1 FROM payroll_payout_lines WHERE payroll_period_id = p_from_id) THEN RAISE EXCEPTION 'move_week:has_pay_lines'; END IF;
  IF EXISTS (SELECT 1 FROM payroll_rep_hours a JOIN payroll_rep_hours b ON b.user_id = a.user_id AND b.payroll_period_id = p_to_id WHERE a.payroll_period_id = p_from_id) THEN
    RAISE EXCEPTION 'move_week:hours_conflict';
  END IF;
  IF EXISTS (SELECT 1 FROM payroll_bonus_lines a JOIN payroll_bonus_lines b ON b.user_id = a.user_id AND b.bonus_type = a.bonus_type AND b.payroll_period_id = p_to_id AND b.source_id IS NULL
             WHERE a.payroll_period_id = p_from_id AND a.source_id IS NULL) THEN
    RAISE EXCEPTION 'move_week:bonus_conflict';
  END IF;
  UPDATE payroll_rep_hours SET payroll_period_id = p_to_id WHERE payroll_period_id = p_from_id;
  GET DIAGNOSTICS v_h = ROW_COUNT;
  UPDATE payroll_bonus_lines SET payroll_period_id = p_to_id WHERE payroll_period_id = p_from_id;
  GET DIAGNOSTICS v_b = ROW_COUNT;
  UPDATE payroll_adjustments SET payroll_period_id = p_to_id WHERE payroll_period_id = p_from_id AND status = 'pending';
  GET DIAGNOSTICS v_a = ROW_COUNT;
  DELETE FROM payroll_week_minimums WHERE payroll_period_id = p_from_id;
  UPDATE payroll_periods SET status = 'cancelled' WHERE id = p_from_id;
  RETURN jsonb_build_object('ok', true, 'hours', v_h, 'bonuses', v_b, 'fixes', v_a);
END;
$$;

-- 6. Saving a new pay week: the setting AND the closing of every old-schedule open week in ONE transaction (all or nothing).
-- Called only by savePayWeekSchedule (lib/payroll-week-schedule-server.ts) after it validated p_pay_week (parsePayWeek). An old
-- open week moves to the new week covering its last day (found by exact calendar date, created if missing) via
-- payroll_move_open_week; any refusal rolls back everything, including the setting.
CREATE OR REPLACE FUNCTION public.payroll_set_pay_week(p_org_id uuid, p_pay_week jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_week record;
  v_old record;
  v_d date;
  v_target_d date;
  v_tc timestamptz;
  v_target uuid;
  v_moved integer := 0;
BEGIN
  IF jsonb_typeof(p_pay_week) <> 'object' THEN RAISE EXCEPTION 'pay_week:bad_schedule'; END IF;
  PERFORM 1 FROM orgs WHERE id = p_org_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'pay_week:org_not_found'; END IF;
  UPDATE orgs SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{payWeek}', p_pay_week, true) WHERE id = p_org_id;
  SELECT * INTO v_week FROM arx_private.payroll_org_week(p_org_id);

  FOR v_old IN
    SELECT id, cutoff_at FROM payroll_periods
    WHERE org_id = p_org_id AND status = 'open' AND extract(dow FROM (cutoff_at AT TIME ZONE v_week.tz)::date)::int <> v_week.cutoff_dow
    ORDER BY cutoff_at FOR UPDATE
  LOOP
    v_d := (v_old.cutoff_at AT TIME ZONE v_week.tz)::date;
    v_target_d := v_d + ((v_week.cutoff_dow - extract(dow FROM v_d)::int + 7) % 7);   -- moveTargetCutoff(): first new cutoff day on/after
    v_tc := (v_target_d + v_week.cutoff_time) AT TIME ZONE v_week.tz;
    SELECT id INTO v_target FROM payroll_periods
      WHERE org_id = p_org_id AND status <> 'cancelled' AND cutoff_at BETWEEN v_tc - interval '36 hours' AND v_tc + interval '36 hours'
        AND (cutoff_at AT TIME ZONE v_week.tz)::date = v_target_d
      ORDER BY created_at, id LIMIT 1;
    IF v_target IS NULL THEN
      INSERT INTO payroll_periods (org_id, period_label, cutoff_at, lock_at, scheduled_pay_date, status)
      VALUES (p_org_id, 'Week ending ' || to_char(v_target_d, 'YYYY-MM-DD'), v_tc, v_tc, v_target_d + v_week.payday_offset, 'open')
      ON CONFLICT DO NOTHING RETURNING id INTO v_target;
      IF v_target IS NULL THEN
        SELECT id INTO v_target FROM payroll_periods
          WHERE org_id = p_org_id AND status <> 'cancelled' AND (cutoff_at AT TIME ZONE v_week.tz)::date = v_target_d
            AND cutoff_at BETWEEN v_tc - interval '36 hours' AND v_tc + interval '36 hours'
          ORDER BY created_at, id LIMIT 1;
      END IF;
      IF v_target IS NULL THEN  -- label held by a cancelled week
        INSERT INTO payroll_periods (org_id, period_label, cutoff_at, lock_at, scheduled_pay_date, status)
        VALUES (p_org_id, 'Week ending ' || to_char(v_target_d, 'YYYY-MM-DD') || ' (2)', v_tc, v_tc, v_target_d + v_week.payday_offset, 'open')
        RETURNING id INTO v_target;
      END IF;
    END IF;
    BEGIN
      PERFORM payroll_move_open_week(p_org_id, v_old.id, v_target);
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'pay_week:%:%', to_char(v_d, 'YYYY-MM-DD'), SQLERRM USING ERRCODE = SQLSTATE;
    END;
    v_moved := v_moved + 1;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'closed', v_moved);
END;
$$;

-- Privileges -------------------------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION arx_private.payroll_org_week(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.payroll_week_person_totals(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.payroll_commit_week(uuid, uuid, uuid, uuid, numeric, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.payroll_set_job_split(uuid, uuid, uuid, uuid, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.payroll_move_open_week(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.payroll_set_pay_week(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.payroll_week_minimum_unanswered(uuid, uuid) FROM PUBLIC;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION arx_private.payroll_org_week(uuid) FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION public.payroll_week_person_totals(uuid, uuid) FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION public.payroll_commit_week(uuid, uuid, uuid, uuid, numeric, jsonb) FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION public.payroll_set_job_split(uuid, uuid, uuid, uuid, text, jsonb) FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION public.payroll_move_open_week(uuid, uuid, uuid) FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION public.payroll_set_pay_week(uuid, jsonb) FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION public.payroll_week_minimum_unanswered(uuid, uuid) FROM %I', r);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION arx_private.payroll_org_week(uuid) TO service_role;
    GRANT EXECUTE ON FUNCTION public.payroll_week_person_totals(uuid, uuid) TO service_role;
    GRANT EXECUTE ON FUNCTION public.payroll_commit_week(uuid, uuid, uuid, uuid, numeric, jsonb) TO service_role;
    GRANT EXECUTE ON FUNCTION public.payroll_set_job_split(uuid, uuid, uuid, uuid, text, jsonb) TO service_role;
    GRANT EXECUTE ON FUNCTION public.payroll_move_open_week(uuid, uuid, uuid) TO service_role;
    GRANT EXECUTE ON FUNCTION public.payroll_set_pay_week(uuid, jsonb) TO service_role;
    GRANT EXECUTE ON FUNCTION public.payroll_week_minimum_unanswered(uuid, uuid) TO service_role;
  END IF;
END $$;
