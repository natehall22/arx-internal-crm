-- Payroll Approve as ONE atomic database step + the field-role hard deny. Additive tables/columns; replaces three live functions.
--
-- Before: Approve = claim -> (TypeScript) write snapshots/lines one request at a time -> flip to locked -> mark fixes applied
-- -> carry negative balances, with "undo" code for the failures. A crash or a write between those calls left a half-written week,
-- and the hours / bonus / fix writers only checked "is the week claimed?" in TypeScript, then wrote (check-then-write race).
--
-- After:
--   1. payroll_guard_claimed_period() — a trigger on payroll_rep_hours, payroll_bonus_lines and payroll_adjustments. Under a
--      FOR SHARE lock on the period row it refuses a write when the period holds a LIVE lock claim OR is not 'open'. A writer that
--      was waiting on a claim re-reads the committed row afterwards, sees 'locked', and is refused. Money lines of a closed week can
--      never change; only the moves that cannot change a check are allowed (a pending bonus landing on / leaving a closed week, a
--      bonus marked paid, a pending bonus moved onto an OPEN week).
--   2. payroll_commit_week() — claim holder only: writes the period snapshot, every job snapshot + payout line + job_payroll_state,
--      the frozen per-unit earnings, re-reads every person's total from the tables and REFUSES unless it equals the total the
--      admin approved, finds-or-creates next week IN THE SAME TRANSACTION, locks it, verifies it is open and unclaimed, carries
--      negative checks into it, marks the week's fixes applied and flips the period to locked. Any failure rolls everything back.
--   3. payroll_unit_earnings — per-unit pay is stored at approval, so a locked/paid week never recalculates it.
--   4. payroll_guard_frozen_period_status() — an approved week that holds frozen unit pay, applied fixes or carried balances can
--      never be reopened or cancelled (the carry would be orphaned).
--   5. Field roles (setter, canvasser, inside sales, call center — by role slug OR custom-role NAME) NEVER read the job board,
--      Production/Crew messages or pricing. ONE definition: arx_private.is_field_role(); lib/permissions.ts isFieldRoleLike mirrors
--      it and job-notes-rls-parity.test.ts keeps them equal.
--   6. The SECURITY DEFINER evaluators moved to the private schema arx_private (service-only). The public can_view_job_board() /
--      message_visible_to() are thin wrappers bound to auth.uid(): a signed-in user can no longer probe another person's access.
--
-- Rollback (nothing here changes existing rows):
--   DROP TRIGGER trg_guard_claimed_period ON payroll_rep_hours; (and on payroll_bonus_lines, payroll_adjustments)
--   DROP TRIGGER trg_guard_frozen_period_status ON payroll_periods;
--   DROP FUNCTION payroll_commit_week(uuid,uuid,uuid,uuid,numeric,jsonb), payroll_week_person_totals(uuid,uuid),
--                 payroll_guard_claimed_period(), payroll_guard_frozen_period_status();
--   ALTER TABLE payroll_periods DROP COLUMN units_frozen_at;  DROP TABLE payroll_unit_earnings;
--   Re-create the previous public.can_view_job_board(uuid) (admin/owner OR legacy `operations` OR a jobs:view / jobs:edit / admin:full
--   grant) and the 202610270010 body of public.message_visible_to(); then DROP SCHEMA arx_private CASCADE.
-- (Run AFTER 202610250010_payroll_adjustments.sql and 202610270010_threads_audiences.sql.)

-- 0. Private schema (service-only) -----------------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS arx_private;
REVOKE ALL ON SCHEMA arx_private FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON SCHEMA arx_private FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON SCHEMA arx_private FROM authenticated; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN GRANT USAGE ON SCHEMA arx_private TO service_role; END IF;
END $$;

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

-- 2. Writer guard: live claim OR closed week ------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payroll_guard_claimed_period()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_period uuid;
  v_status text;
  v_live boolean;
  v_is_bonus boolean := (TG_TABLE_NAME = 'payroll_bonus_lines');
  v_old_p uuid;
  v_new_p uuid;
  v_old_money boolean := false;   -- the row counted toward a check before this write (approved / paid bonus)
  v_new_money boolean := false;   -- ... and after it
  v_paid_only boolean := false;   -- an approved bonus being marked paid, nothing else changed
BEGIN
  -- payroll_commit_week writes under the claim it holds.
  IF current_setting('arx.payroll_commit', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN v_old_p := OLD.payroll_period_id; END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN v_new_p := NEW.payroll_period_id; END IF;
  IF v_is_bonus THEN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN v_old_money := OLD.status::text IN ('approved', 'paid'); END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') THEN v_new_money := NEW.status::text IN ('approved', 'paid'); END IF;
    IF TG_OP = 'UPDATE' THEN
      v_paid_only := OLD.status::text = 'approved' AND NEW.status::text = 'paid' AND OLD.amount = NEW.amount AND OLD.user_id = NEW.user_id;
    END IF;
  END IF;

  FOR v_period IN SELECT DISTINCT x FROM unnest(ARRAY[v_old_p, v_new_p]) AS x WHERE x IS NOT NULL LOOP
    -- FOR SHARE: a claim / commit (an UPDATE of this row) waits for a writer already in flight, and a writer that waited for a
    -- claim re-reads the COMMITTED row (now 'locked') here.
    SELECT status, (lock_claim_token IS NOT NULL AND lock_claimed_at IS NOT NULL AND lock_claimed_at > now() - interval '15 minutes')
      INTO v_status, v_live FROM payroll_periods WHERE id = v_period FOR SHARE;
    IF NOT FOUND THEN CONTINUE; END IF;
    IF COALESCE(v_live, false) THEN
      RAISE EXCEPTION 'payroll_period_claimed: this week is being approved right now; try again in a minute' USING ERRCODE = '55006';
    END IF;
    IF v_status <> 'open' THEN
      -- Only writes that cannot change what a check is made of may touch a closed week (bonuses only).
      IF v_is_bonus AND (
           (v_period = v_old_p AND v_period = v_new_p
              AND ((NOT v_old_money AND NOT v_new_money)
                   OR v_paid_only))
        OR (v_period = v_old_p AND v_period IS DISTINCT FROM v_new_p AND NOT v_old_money)    -- a pending line moved out onto an open week
        OR (v_period = v_new_p AND v_period IS DISTINCT FROM v_old_p AND NOT v_new_money)    -- a pending/rejected line landing on a closed week
      ) THEN
        CONTINUE;
      END IF;
      RAISE EXCEPTION 'payroll_period_not_open: this week is already approved; its hours, bonuses and fixes can no longer change' USING ERRCODE = '55006';
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

-- 2b. An approved week with frozen pay / applied fixes / carried balances can never be reopened or cancelled ------------
CREATE OR REPLACE FUNCTION public.payroll_guard_frozen_period_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_setting('arx.payroll_commit', true) = 'on' THEN RETURN NEW; END IF;
  IF OLD.status IN ('locked', 'paid') AND NEW.status IN ('open', 'cancelled') AND (
       OLD.units_frozen_at IS NOT NULL
    OR EXISTS (SELECT 1 FROM payroll_adjustments a WHERE a.payroll_period_id = OLD.id AND a.status = 'applied')
    OR EXISTS (SELECT 1 FROM payroll_adjustments c WHERE c.source_period_id = OLD.id AND c.kind = 'balance' AND c.status <> 'void')
  ) THEN
    RAISE EXCEPTION 'payroll_period_frozen: an approved week with frozen pay, applied fixes or carried balances cannot be reopened or cancelled; correct it with a fix on the next open week' USING ERRCODE = '55006';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_frozen_period_status ON payroll_periods;
CREATE TRIGGER trg_guard_frozen_period_status BEFORE UPDATE OF status ON payroll_periods
  FOR EACH ROW EXECUTE FUNCTION public.payroll_guard_frozen_period_status();

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
DROP FUNCTION IF EXISTS public.payroll_commit_week(uuid, uuid, uuid, uuid, numeric, uuid, jsonb);
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

  -- A check cannot go below $0: what is owed back is carried into the next OPEN week, once per person per source week.
  -- The target is found (or created) HERE, locked, and verified in this same transaction — never trusted from the caller.
  IF v_negative > 0 THEN
    v_date := (v_period.cutoff_at AT TIME ZONE 'America/New_York')::date;
    v_target := NULL;
    FOR v_k IN 1..8 LOOP
      -- Eastern calendar weeks rebuilt with the timezone database (never fixed 24 h days).
      v_tc := ((v_date + 7 * v_k) + time '23:59:59.999') AT TIME ZONE 'America/New_York';
      SELECT id INTO v_cand FROM payroll_periods
        WHERE org_id = p_org_id AND status <> 'cancelled' AND cutoff_at BETWEEN v_tc - interval '36 hours' AND v_tc + interval '36 hours'
        ORDER BY created_at, id LIMIT 1;
      IF v_cand IS NULL THEN
        INSERT INTO payroll_periods (org_id, period_label, cutoff_at, lock_at, scheduled_pay_date, status)
        VALUES (p_org_id, 'Week ending ' || to_char(v_date + 7 * v_k, 'YYYY-MM-DD'), v_tc, v_tc, (v_date + 7 * v_k + 2), 'open')
        ON CONFLICT DO NOTHING;
        SELECT id INTO v_cand FROM payroll_periods
          WHERE org_id = p_org_id AND status <> 'cancelled' AND cutoff_at BETWEEN v_tc - interval '36 hours' AND v_tc + interval '36 hours'
          ORDER BY created_at, id LIMIT 1;
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

-- 5. ONE field-role classification (SQL side) ------------------------------------------------------------------------
-- Role slug in the list, or a custom role whose NAME (name + display name, lowercased) contains the word setter / canvasser /
-- inside sales / call center — unless it is a manager role. lib/permissions.ts isFieldRoleLike is the TypeScript mirror.
CREATE OR REPLACE FUNCTION arx_private.is_field_role(p_role text, p_crname text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT lower(btrim(coalesce(p_role, ''))) IN ('setter', 'canvasser', 'inside_sales', 'inside sales', 'call_center', 'call center')
      OR (lower(coalesce(p_crname, '')) !~ 'manager'
          AND lower(coalesce(p_crname, '')) ~ '(^|[^a-z])(setter|canvasser|inside[ _-]?sales|call[ _-]?cent(er|re))s?([^a-z]|$)');
$$;

-- 6. Private evaluators (service-only) + public wrappers bound to the caller -----------------------------------------------
CREATE OR REPLACE FUNCTION arx_private.can_view_job_board(p_user uuid)
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
    SELECT EXISTS (SELECT 1 FROM u WHERE arx_private.is_field_role(u.role, u.crname)) AS denied
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

CREATE OR REPLACE FUNCTION arx_private.message_visible_to(
  p_viewer uuid, p_audience text, p_restricted boolean, p_org uuid, p_opportunity uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH v AS (
    SELECT u.id, u.org_id, lower(trim(u.role::text)) AS role, u.custom_role_id, coalesce(u.is_super_admin, false) AS sa, u.active,
           lower(coalesce(cr.name, '') || ' ' || coalesce(cr.display_name, '')) AS crname
    FROM users u LEFT JOIN custom_roles cr ON cr.id = u.custom_role_id
    WHERE u.id = p_viewer
  ),
  d AS (SELECT o.owner_user_id, o.setter_user_id FROM opportunities o WHERE o.id = p_opportunity),
  f AS (
    SELECT
      v.org_id = p_org AND coalesce(v.active, true) AS in_org,
      (v.sa OR v.role IN ('owner','admin')) AS owner_like,
      arx_private.can_view_job_board(v.id) AS job_board,
      v.role IN ('manager','sales_manager','regional_manager','operations') AS manager_like,
      (v.role IN ('setter','canvasser')) AS base_setter,
      (v.role IN ('rep','sales_rep','closer')) AS closer_role,
      (v.role IN ('rep','sales_rep','closer') AND (EXISTS (SELECT 1 FROM d WHERE d.owner_user_id = v.id)
        OR EXISTS (SELECT 1 FROM scheduled_appointments sa WHERE sa.opportunity_id = p_opportunity AND sa.closer_user_id = v.id))) AS own_closer,
      (v.role IN ('inside_sales','inside sales','call_center')
        OR v.crname LIKE '%inside sales%' OR v.crname LIKE '%inside_sales%' OR v.crname LIKE '%call center%' OR v.crname LIKE '%call_center%') AS inside_like,
      v.role IN ('admin','owner','operations','manager','sales_manager','regional_manager','rep','sales_rep','closer') OR v.sa AS pricing_role,
      arx_private.is_field_role(v.role, v.crname) AS field_role,
      (EXISTS (SELECT 1 FROM d WHERE d.owner_user_id = v.id OR d.setter_user_id = v.id)
        OR EXISTS (SELECT 1 FROM scheduled_appointments sa WHERE sa.opportunity_id = p_opportunity AND (sa.closer_user_id = v.id OR sa.canvasser_user_id = v.id))) AS own_deal
    FROM v
  ),
  g AS (SELECT f.*, (f.owner_like OR f.job_board OR f.manager_like OR f.closer_role OR f.base_setter OR f.inside_like) AS recognized,
        (f.base_setter AND NOT f.inside_like) AS setter_like, (f.pricing_role AND NOT f.field_role) AS pricing_ok FROM f)
  SELECT CASE
    WHEN p_audience IS NULL THEN true                       -- legacy rows: unchanged behaviour
    WHEN NOT coalesce((SELECT in_org FROM g), false) THEN false
    WHEN coalesce((SELECT owner_like FROM g), false) THEN true
    WHEN NOT coalesce((SELECT recognized FROM g), false) THEN false     -- unknown roles (sub, custom-only) see nothing
    WHEN p_restricted IS TRUE AND NOT coalesce((SELECT pricing_ok FROM g), false) THEN false
    WHEN p_audience IN ('production','crew') THEN
      coalesce((SELECT NOT field_role AND (job_board OR manager_like OR own_closer) FROM g), false)
    ELSE  -- team | sales
      CASE WHEN coalesce((SELECT setter_like OR closer_role FROM g), false) THEN (p_opportunity IS NOT NULL AND coalesce((SELECT own_deal FROM g), false))   -- no deal = not theirs (same as canReadRowOnDeal 'none')
           ELSE true END
  END;
$$;

-- The public functions keep their signatures (live RLS policies call them with auth.uid()) but can only answer for the CALLER —
-- or for the server (service role / a direct database session).
CREATE OR REPLACE FUNCTION public.can_view_job_board(p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN p_user IS NOT NULL AND (p_user = auth.uid() OR auth.role() = 'service_role' OR session_user IN ('postgres', 'supabase_admin'))
    THEN arx_private.can_view_job_board(p_user)
    ELSE false
  END;
$function$;

CREATE OR REPLACE FUNCTION public.message_visible_to(
  p_viewer uuid, p_audience text, p_restricted boolean, p_org uuid, p_opportunity uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_viewer IS NOT NULL AND (p_viewer = auth.uid() OR auth.role() = 'service_role' OR session_user IN ('postgres', 'supabase_admin'))
    THEN arx_private.message_visible_to(p_viewer, p_audience, p_restricted, p_org, p_opportunity)
    ELSE false
  END;
$$;

-- search_messages is service-only: it calls the private evaluator directly.
CREATE OR REPLACE FUNCTION public.search_messages(p_org uuid, p_viewer uuid, p_q text, p_limit int DEFAULT 20)
RETURNS TABLE (id uuid, opportunity_id uuid, lead_id uuid, customer_id uuid, body text, created_at timestamptz, score real)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
  WITH q AS (
    SELECT lower(btrim(p_q)) AS t,
           '%' || replace(replace(replace(lower(btrim(p_q)), '\', '\\'), '%', '\%'), '_', '\_') || '%' AS pat
  )
  SELECT a.id, a.opportunity_id, a.lead_id, a.customer_id, a.body, a.created_at,
         greatest(word_similarity(q.t, lower(a.body)), CASE WHEN lower(a.body) LIKE q.pat THEN 1 ELSE 0 END)::real AS score
  FROM activities a, q
  WHERE a.org_id = p_org
    AND a.deleted_at IS NULL
    AND a.referral_partner_id IS NULL
    AND a.audience IS NOT NULL
    AND a.opportunity_id IS NOT NULL
    AND coalesce(a.origin, 'human') = 'human'
    AND length(q.t) >= 2
    AND (lower(a.body) LIKE q.pat OR q.t <% lower(a.body))
    AND arx_private.message_visible_to(p_viewer, a.audience, a.restricted_pricing, a.org_id, a.opportunity_id)
  ORDER BY score DESC, a.created_at DESC
  LIMIT greatest(1, least(p_limit, 50));
$$;

-- Privileges --------------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.payroll_guard_claimed_period() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.payroll_guard_frozen_period_status() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.payroll_week_person_totals(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.payroll_commit_week(uuid, uuid, uuid, uuid, numeric, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION arx_private.is_field_role(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION arx_private.can_view_job_board(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION arx_private.message_visible_to(uuid, text, boolean, uuid, uuid) FROM PUBLIC;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.payroll_week_person_totals(uuid, uuid) FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION public.payroll_commit_week(uuid, uuid, uuid, uuid, numeric, jsonb) FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION arx_private.is_field_role(text, text) FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION arx_private.can_view_job_board(uuid) FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION arx_private.message_visible_to(uuid, text, boolean, uuid, uuid) FROM %I', r);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.payroll_week_person_totals(uuid, uuid) TO service_role;
    GRANT EXECUTE ON FUNCTION public.payroll_commit_week(uuid, uuid, uuid, uuid, numeric, jsonb) TO service_role;
    GRANT EXECUTE ON FUNCTION arx_private.is_field_role(text, text) TO service_role;
    GRANT EXECUTE ON FUNCTION arx_private.can_view_job_board(uuid) TO service_role;
    GRANT EXECUTE ON FUNCTION arx_private.message_visible_to(uuid, text, boolean, uuid, uuid) TO service_role;
  END IF;
END $$;
