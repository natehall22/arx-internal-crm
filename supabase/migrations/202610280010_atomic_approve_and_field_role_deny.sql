-- Payroll Approve as ONE atomic database step. Additive: one table, one column, three functions, three triggers.
--
-- Before: Approve = claim -> (TypeScript) write snapshots/lines one request at a time -> flip to locked -> mark fixes applied
-- -> carry negative balances, with "undo" code for the failures. A crash or a write between those calls left a half-written week,
-- and the hours / bonus / fix writers only checked "is the week claimed?" in TypeScript, then wrote (check-then-write race).
--
-- After:
--   1. payroll_guard_claimed_period() — a trigger on payroll_rep_hours, payroll_bonus_lines and payroll_adjustments refuses any
--      insert/update/delete on a period that holds a LIVE lock claim (the claim is taken before the plan is computed and held until
--      the commit). The trigger takes the period row FOR SHARE, so a writer that is mid-flight makes the claim wait for it, and a
--      claim that is already held makes the writer fail. Atomic with the writer's own transaction.
--   2. payroll_commit_week() — claim holder only: writes the period snapshot, every job snapshot + payout line + job_payroll_state,
--      the frozen per-unit earnings, re-reads every person's total from the tables and REFUSES unless it equals the total the
--      admin approved, carries negative checks to the next week, marks the week's fixes applied and flips the period to locked.
--      Any failure raises and Postgres rolls the whole thing back.
--   3. payroll_unit_earnings — per-unit pay is stored at approval, so a locked/paid week never recalculates it.
--
-- Rollback (nothing here changes existing rows):
--   DROP TRIGGER trg_guard_claimed_period ON payroll_rep_hours; (and on payroll_bonus_lines, payroll_adjustments)
--   DROP FUNCTION payroll_commit_week(uuid,uuid,uuid,uuid,numeric,uuid,jsonb), payroll_week_person_totals(uuid,uuid),
--                 payroll_guard_claimed_period();
--   ALTER TABLE payroll_periods DROP COLUMN units_frozen_at;  DROP TABLE payroll_unit_earnings;
-- (Run AFTER 202610250010_payroll_adjustments.sql: the trigger and the carry reference payroll_adjustments.)
-- Also (section 5): can_view_job_board() gains a field-role hard deny (see there for its rollback).

-- 1. Frozen per-unit earnings ----------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payroll_unit_earnings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  payroll_period_id UUID NOT NULL REFERENCES payroll_periods(id) ON DELETE RESTRICT,
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  amount            NUMERIC(14, 2) NOT NULL,
  detail            JSONB,                                 -- the full PeriodUnitEarningsResult the statement renders
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (payroll_period_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_payroll_unit_earnings_org_user ON payroll_unit_earnings(org_id, user_id);
ALTER TABLE payroll_unit_earnings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON payroll_unit_earnings FROM anon, authenticated;
COMMENT ON TABLE payroll_unit_earnings IS 'Per-unit pay frozen when a week is approved. Locked/paid weeks read this, never a recalculation.';
ALTER TABLE payroll_periods ADD COLUMN IF NOT EXISTS units_frozen_at TIMESTAMPTZ;
COMMENT ON COLUMN payroll_periods.units_frozen_at IS 'Set by payroll_commit_week. NULL on a locked period = locked before per-unit pay was frozen (readers recompute, as they always did).';

-- 2. Claim guard on the three writers --------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payroll_guard_claimed_period()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_period uuid;
  v_live boolean;
BEGIN
  -- payroll_commit_week writes under the claim it holds.
  IF current_setting('arx.payroll_commit', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  FOR v_period IN
    SELECT DISTINCT x FROM (
      SELECT CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN OLD.payroll_period_id END AS x
      UNION ALL
      SELECT CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN NEW.payroll_period_id END
    ) s WHERE x IS NOT NULL
  LOOP
    -- FOR SHARE: a claim (an UPDATE of this row) waits for any writer already in flight; a claim already held is seen here.
    SELECT (lock_claim_token IS NOT NULL AND lock_claimed_at IS NOT NULL AND lock_claimed_at > now() - interval '15 minutes')
      INTO v_live FROM payroll_periods WHERE id = v_period FOR SHARE;
    IF COALESCE(v_live, false) THEN
      RAISE EXCEPTION 'payroll_period_claimed: this week is being approved right now; try again in a minute' USING ERRCODE = '55006';
    END IF;
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_claimed_period ON payroll_rep_hours;
CREATE TRIGGER trg_guard_claimed_period BEFORE INSERT OR UPDATE OR DELETE ON payroll_rep_hours
  FOR EACH ROW EXECUTE FUNCTION public.payroll_guard_claimed_period();
DROP TRIGGER IF EXISTS trg_guard_claimed_period ON payroll_bonus_lines;
CREATE TRIGGER trg_guard_claimed_period BEFORE INSERT OR UPDATE OR DELETE ON payroll_bonus_lines
  FOR EACH ROW EXECUTE FUNCTION public.payroll_guard_claimed_period();
DROP TRIGGER IF EXISTS trg_guard_claimed_period ON payroll_adjustments;
CREATE TRIGGER trg_guard_claimed_period BEFORE INSERT OR UPDATE OR DELETE ON payroll_adjustments
  FOR EACH ROW EXECUTE FUNCTION public.payroll_guard_claimed_period();

-- 3. One person-total definition, in SQL (mirrors composeWeek in lib/payroll-pay-week.ts) -----------------------------
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
    SELECT b.user_id, round(b.amount, 2) FROM payroll_bonus_lines b WHERE b.org_id = p_org_id AND b.payroll_period_id = p_period_id AND b.status IN ('approved', 'paid')
    UNION ALL
    SELECT a.user_id, round(a.amount, 2) FROM payroll_adjustments a WHERE a.org_id = p_org_id AND a.payroll_period_id = p_period_id AND a.status <> 'void'
  ) x GROUP BY x.user_id;
$$;

-- 4. The atomic commit -----------------------------------------------------------------------------------------------
-- p_plan = { jobs: [{ job_id, sale_amount, commission_comp_base, snapshot:{...}, lines:[{...}], state:{...} }],
--            units: [{ user_id, amount, detail }] }
CREATE OR REPLACE FUNCTION public.payroll_commit_week(
  p_org_id uuid,
  p_period_id uuid,
  p_token uuid,
  p_actor_user_id uuid,
  p_expected_total numeric,
  p_next_period_id uuid,
  p_plan jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_period payroll_periods%ROWTYPE;
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

  -- What the tables now say must equal what the admin approved, to the cent.
  SELECT COALESCE(sum(GREATEST(0, raw)), 0), count(*) FILTER (WHERE raw > 0), count(*) FILTER (WHERE raw < 0)
    INTO v_total, v_people, v_negative
  FROM payroll_week_person_totals(p_org_id, p_period_id);
  IF round(v_total, 2) <> round(p_expected_total, 2) THEN
    RAISE EXCEPTION 'payroll_commit:total_mismatch:%:%', round(v_total, 2), round(p_expected_total, 2);
  END IF;

  -- A check cannot go below $0: what is owed back is carried to next week, once per person per source week.
  IF v_negative > 0 THEN
    IF p_next_period_id IS NULL THEN RAISE EXCEPTION 'payroll_commit:no_next_period'; END IF;
    INSERT INTO payroll_adjustments (org_id, payroll_period_id, user_id, amount, reason, kind, status, source_period_id, created_by)
    SELECT p_org_id, p_next_period_id, t.user_id, t.raw,
           'Carried over from the week ending ' || to_char(v_period.cutoff_at AT TIME ZONE 'America/New_York', 'YYYY-MM-DD'),
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

REVOKE ALL ON FUNCTION public.payroll_guard_claimed_period() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.payroll_week_person_totals(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.payroll_commit_week(uuid, uuid, uuid, uuid, numeric, uuid, jsonb) FROM PUBLIC;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.payroll_week_person_totals(uuid, uuid) FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION public.payroll_commit_week(uuid, uuid, uuid, uuid, numeric, uuid, jsonb) FROM %I', r);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.payroll_week_person_totals(uuid, uuid) TO service_role;
    GRANT EXECUTE ON FUNCTION public.payroll_commit_week(uuid, uuid, uuid, uuid, numeric, uuid, jsonb) TO service_role;
  END IF;
END $$;

-- 5. Field-role hard deny in the SQL job-board test ----------------------------------------------------------------------
-- Setters, canvassers and inside sales / call center NEVER read the job board (so never production notes, the Job tab, pricing or
-- financials), whatever job permission was granted to their custom role or user. The deny runs BEFORE the positive grants; the
-- app side is lib/effective-permissions.ts + lib/threads/visibility.ts. Only tightens: owners/admins and every other role are
-- unchanged. Used by the production_job_notes RLS policies and message_visible_to.
-- Rollback: re-create the function without the `field` CTE (previous body: admin/owner OR legacy `operations` OR a jobs:view /
-- jobs:edit / admin:full grant).
CREATE OR REPLACE FUNCTION public.can_view_job_board(p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH u AS (
    SELECT lower(trim(us.role::text)) AS role, us.custom_role_id,
           lower(coalesce(cr.name, '') || ' ' || coalesce(cr.display_name, '')) AS crname
    FROM public.users us LEFT JOIN public.custom_roles cr ON cr.id = us.custom_role_id
    WHERE us.id = p_user
  ),
  field AS (
    SELECT EXISTS (
      SELECT 1 FROM u
      WHERE u.role IN ('setter', 'canvasser', 'inside_sales', 'inside sales', 'call_center')
         OR u.crname LIKE '%inside sales%' OR u.crname LIKE '%inside_sales%' OR u.crname LIKE '%call center%' OR u.crname LIKE '%call_center%'
    ) AS denied
  ),
  names AS (
    SELECT p.name
    FROM u
    JOIN public.role_permissions rp ON rp.role_id = u.custom_role_id
    JOIN public.permissions p ON p.id = rp.permission_id
    UNION ALL
    SELECT p.name
    FROM public.user_permissions up
    JOIN public.permissions p ON p.id = up.permission_id
    WHERE up.user_id = p_user
  )
  SELECT EXISTS (SELECT 1 FROM u)
    AND (
      EXISTS (SELECT 1 FROM u WHERE u.role IN ('admin', 'owner'))
      OR (
        NOT (SELECT denied FROM field)
        AND (
          EXISTS (SELECT 1 FROM u WHERE u.custom_role_id IS NULL AND u.role = ANY (ARRAY['operations']::text[])) -- JOB_BOARD_LEGACY_ROLES
          OR EXISTS (SELECT 1 FROM names WHERE name IN ('admin:full', 'jobs:view', 'jobs:edit'))
        )
      )
    );
$function$;
