-- Payroll phase 2, new pay-week path only. Additive; nothing reads these while PAYROLL_PAY_WEEK_ENABLED is off.
--   1. Advances / draws: payroll_advances (what was advanced, the recovery rule) + payroll_adjustments.advance_id. A recovery is an
--      ordinary NEGATIVE adjustment line (kind 'advance_recovery'), so the one person-total list (PAY_LINE_SOURCES, 'Adjustment')
--      already counts it: no new pay source, no change to payroll_week_person_totals. Outstanding = amount - recoveries on approved
--      weeks (derived, never stored). A guard trigger makes over-recovering impossible. payroll_commit_week writes the week's
--      recoveries (p_plan->'advances') in the same transaction as everything else. payroll_record_advance / payroll_cancel_advance
--      are the only writers (owner = super admin, checked here too).
--   2. payroll_approval_links: one-time links behind the "Approve $X for N people" notification (only a hash of the token is stored).
--   3. users.payroll_employee_id (the provider's employee / file number) and users.payroll_state (home payroll state, 2 letters):
--      provider export + the multi-state warning.
-- Run AFTER 202611120010_payroll_pay_week_minimums_job_split.sql. Deploy order: this migration, then the code.
-- Rollback: DROP FUNCTION public.payroll_record_advance(uuid, uuid, uuid, numeric, text, numeric, date, date, text, uuid, boolean);
--   DROP FUNCTION public.payroll_cancel_advance(uuid, uuid, uuid, text); DROP TRIGGER trg_payroll_advance_guard ON payroll_adjustments;
--   DROP FUNCTION public.payroll_advance_guard(); DROP TABLE payroll_approval_links; ALTER TABLE users DROP COLUMN payroll_employee_id, DROP COLUMN payroll_state;
--   DROP INDEX uq_payroll_adjustments_one_recovery; ALTER TABLE payroll_adjustments DROP COLUMN advance_id; DROP TABLE payroll_advances;
--   restore the kind check (fix, balance, chargeback, resplit, topup) and re-run payroll_commit_week from 202611120010.
SET lock_timeout = '5s';

-- 1. Advances -------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payroll_advances (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  amount              NUMERIC(14, 2) NOT NULL CHECK (amount > 0 AND amount <= 100000),
  given_on            DATE NOT NULL,
  note                TEXT CHECK (note IS NULL OR char_length(note) <= 300),
  -- How it is taken back: the whole balance, a fixed amount per week, or a percent of the person's pay that week.
  recovery_mode       TEXT NOT NULL CHECK (recovery_mode IN ('full', 'fixed', 'percent')),
  recovery_value      NUMERIC(14, 4),
  first_week_ending   DATE NOT NULL,                      -- the first pay week that takes some back (the week's last day, company zone)
  below_minimum_ok    BOOLEAN NOT NULL DEFAULT FALSE,     -- the owner agreed it may take a check below the person's weekly minimum
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  paid_adjustment_id  UUID,                               -- the + line when it was paid on a pay week's check (otherwise paid outside payroll)
  created_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cancelled_at        TIMESTAMPTZ,
  cancelled_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  cancel_reason       TEXT,
  CONSTRAINT payroll_advances_rule_ck CHECK (
    (recovery_mode = 'full' AND recovery_value IS NULL)
    OR (recovery_mode = 'fixed' AND recovery_value > 0 AND recovery_value <= amount)
    OR (recovery_mode = 'percent' AND recovery_value > 0 AND recovery_value <= 100))
);
CREATE INDEX IF NOT EXISTS idx_payroll_advances_user ON payroll_advances(org_id, user_id) WHERE status = 'active';
ALTER TABLE payroll_advances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON payroll_advances FROM anon, authenticated;
COMMENT ON TABLE payroll_advances IS 'Money advanced to a person and how it is recovered from future pay. Service role only. Outstanding = amount minus recovery lines on approved weeks.';

ALTER TABLE payroll_adjustments ADD COLUMN IF NOT EXISTS advance_id UUID REFERENCES payroll_advances(id) ON DELETE RESTRICT;
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT conname FROM pg_constraint WHERE conrelid = 'public.payroll_adjustments'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%chargeback%' LOOP
    EXECUTE format('ALTER TABLE payroll_adjustments DROP CONSTRAINT %I', r.conname);
  END LOOP;
  ALTER TABLE payroll_adjustments ADD CONSTRAINT payroll_adjustments_kind_check
    CHECK (kind IN ('fix', 'balance', 'chargeback', 'resplit', 'topup', 'advance', 'advance_recovery'));
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_adjustments_one_recovery ON payroll_adjustments(payroll_period_id, advance_id) WHERE kind = 'advance_recovery' AND status <> 'void';

-- A recovery line can never take back more than was advanced, nor on a cancelled advance; the + line is positive. Serialised per advance.
CREATE OR REPLACE FUNCTION public.payroll_advance_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_adv payroll_advances%ROWTYPE;
  v_other numeric;
BEGIN
  IF NEW.kind NOT IN ('advance', 'advance_recovery') THEN RETURN NEW; END IF;
  IF NEW.advance_id IS NULL THEN RAISE EXCEPTION 'payroll_advance:missing_advance'; END IF;
  SELECT * INTO v_adv FROM payroll_advances WHERE id = NEW.advance_id FOR UPDATE;
  IF NOT FOUND OR v_adv.org_id IS DISTINCT FROM NEW.org_id OR v_adv.user_id IS DISTINCT FROM NEW.user_id THEN RAISE EXCEPTION 'payroll_advance:wrong_person'; END IF;
  IF NEW.kind = 'advance' THEN
    IF NEW.amount <= 0 THEN RAISE EXCEPTION 'payroll_advance:amount_sign'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.amount >= 0 THEN RAISE EXCEPTION 'payroll_advance:amount_sign'; END IF;
  IF NEW.status = 'void' THEN RETURN NEW; END IF;
  IF v_adv.status <> 'active' THEN RAISE EXCEPTION 'payroll_advance:cancelled'; END IF;
  SELECT COALESCE(sum(-a.amount), 0) INTO v_other FROM payroll_adjustments a
    WHERE a.advance_id = NEW.advance_id AND a.kind = 'advance_recovery' AND a.status <> 'void' AND a.id <> NEW.id;
  IF round(v_other - NEW.amount, 2) > v_adv.amount THEN RAISE EXCEPTION 'payroll_advance:over_recovered'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_payroll_advance_guard ON payroll_adjustments;
CREATE TRIGGER trg_payroll_advance_guard BEFORE INSERT OR UPDATE OF amount, status, kind, advance_id ON payroll_adjustments
  FOR EACH ROW EXECUTE FUNCTION public.payroll_advance_guard();

-- Record an advance (owner only). Optionally paid on an open week's check as a + line ("Advance"): that week cannot also recover it.
CREATE OR REPLACE FUNCTION public.payroll_record_advance(
  p_org_id uuid, p_actor uuid, p_user uuid, p_amount numeric, p_mode text, p_value numeric,
  p_given_on date, p_first_week_ending date, p_note text, p_pay_period_id uuid, p_below_ok boolean
) RETURNS uuid
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_id uuid;
  v_adj uuid;
  v_period payroll_periods%ROWTYPE;
  v_week record;
  v_day date;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_actor AND org_id = p_org_id AND is_super_admin IS TRUE AND COALESCE(active, true)) THEN
    RAISE EXCEPTION 'payroll_advance:owner_only';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_user AND org_id = p_org_id) THEN RAISE EXCEPTION 'payroll_advance:person_not_found'; END IF;
  INSERT INTO payroll_advances (org_id, user_id, amount, given_on, note, recovery_mode, recovery_value, first_week_ending, below_minimum_ok, created_by)
  VALUES (p_org_id, p_user, round(p_amount, 2), p_given_on, NULLIF(btrim(p_note), ''), p_mode, p_value, p_first_week_ending, COALESCE(p_below_ok, false), p_actor)
  RETURNING id INTO v_id;
  IF p_pay_period_id IS NOT NULL THEN
    SELECT * INTO v_period FROM payroll_periods WHERE id = p_pay_period_id AND org_id = p_org_id FOR SHARE;
    IF NOT FOUND OR v_period.status <> 'open' THEN RAISE EXCEPTION 'payroll_advance:week_not_open'; END IF;
    SELECT * INTO v_week FROM arx_private.payroll_org_week(p_org_id);
    v_day := (v_period.cutoff_at AT TIME ZONE v_week.tz)::date;
    IF p_first_week_ending <= v_day THEN RAISE EXCEPTION 'payroll_advance:recover_after_paid_week'; END IF;
    INSERT INTO payroll_adjustments (org_id, payroll_period_id, user_id, amount, reason, kind, status, advance_id, created_by)
    VALUES (p_org_id, p_pay_period_id, p_user, round(p_amount, 2), 'Advance', 'advance', 'pending', v_id, p_actor)
    RETURNING id INTO v_adj;
    UPDATE payroll_advances SET paid_adjustment_id = v_adj WHERE id = v_id;
  END IF;
  RETURN v_id;
END;
$$;

-- Stop recovering (owner only): the rest is written off (or the advance is withdrawn if its + line is still waiting on an open week).
CREATE OR REPLACE FUNCTION public.payroll_cancel_advance(p_org_id uuid, p_actor uuid, p_advance uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_adv payroll_advances%ROWTYPE;
  v_recovered numeric;
  v_withdrawn boolean := false;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_actor AND org_id = p_org_id AND is_super_admin IS TRUE AND COALESCE(active, true)) THEN
    RAISE EXCEPTION 'payroll_advance:owner_only';
  END IF;
  SELECT * INTO v_adv FROM payroll_advances WHERE id = p_advance AND org_id = p_org_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'payroll_advance:not_found'; END IF;
  IF v_adv.status = 'cancelled' THEN RAISE EXCEPTION 'payroll_advance:already_cancelled'; END IF;
  -- Its + line waiting on an open week is withdrawn with it (a paid one stays: that money went out).
  UPDATE payroll_adjustments SET status = 'void' WHERE id = v_adv.paid_adjustment_id AND status = 'pending';
  GET DIAGNOSTICS v_recovered = ROW_COUNT;
  v_withdrawn := v_recovered > 0;
  SELECT COALESCE(sum(-a.amount), 0) INTO v_recovered FROM payroll_adjustments a WHERE a.advance_id = p_advance AND a.kind = 'advance_recovery' AND a.status = 'applied';
  UPDATE payroll_advances SET status = 'cancelled', cancelled_at = now(), cancelled_by = p_actor, cancel_reason = NULLIF(btrim(p_reason), '') WHERE id = p_advance;
  RETURN jsonb_build_object('recovered', v_recovered, 'written_off', CASE WHEN v_withdrawn THEN 0 ELSE round(v_adv.amount - v_recovered, 2) END, 'withdrawn', v_withdrawn);
END;
$$;

-- 2. One-time approval links ---------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payroll_approval_links (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  payroll_period_id UUID NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,   -- the owner the link was sent to; only they can use it
  token_hash      TEXT NOT NULL UNIQUE,                                     -- sha256 of the token; the token itself is never stored
  notified_total  NUMERIC(14, 2) NOT NULL,
  notified_people INTEGER NOT NULL,
  expires_at      TIMESTAMPTZ NOT NULL,
  used_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payroll_approval_links_period ON payroll_approval_links(payroll_period_id, user_id);
ALTER TABLE payroll_approval_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON payroll_approval_links FROM anon, authenticated;
COMMENT ON TABLE payroll_approval_links IS 'One-time links in the "Approve $X for N people" notification. Service role only; used_at set once.';

-- 3. Provider export + multi-state --------------------------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS payroll_employee_id TEXT CHECK (payroll_employee_id IS NULL OR char_length(payroll_employee_id) <= 40);
ALTER TABLE users ADD COLUMN IF NOT EXISTS payroll_state TEXT CHECK (payroll_state IS NULL OR payroll_state ~ '^[A-Z]{2}$');
COMMENT ON COLUMN users.payroll_employee_id IS 'The payroll provider''s employee / file number (ADP File #). Used only by the pay-week export.';
COMMENT ON COLUMN users.payroll_state IS 'Two-letter state the person is paid in. Only used to warn when a week pays them for a job in another state.';

-- 4. The atomic commit, now writing the week''s advance recoveries --------------------------------------------------------------
-- p_plan = { jobs, units, minimums, advances: [{ advance_id, amount (positive), reason }] }
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

  -- Advance recoveries (phase 2): the plan worked each one out from the person's pay this week and the advance's rule; they become
  -- ordinary negative lines on the check (kind 'advance_recovery'), so the person total below counts them with no new source.
  -- Replace semantics (a retried approve never keeps a stale line). The person always comes from the advance row, never the plan;
  -- the guard trigger refuses a line that would recover more than the advance (or on a cancelled advance).
  DELETE FROM payroll_adjustments WHERE org_id = p_org_id AND payroll_period_id = p_period_id AND kind = 'advance_recovery' AND status = 'pending';
  INSERT INTO payroll_adjustments (org_id, payroll_period_id, user_id, amount, reason, kind, status, advance_id, created_by)
  SELECT p_org_id, p_period_id, a.user_id, -round((x->>'amount')::numeric, 2), COALESCE(NULLIF(btrim(x->>'reason'), ''), 'Advance repaid'),
         'advance_recovery', 'pending', a.id, p_actor_user_id
  FROM jsonb_array_elements(COALESCE(p_plan->'advances', '[]'::jsonb)) x
  JOIN payroll_advances a ON a.id = (x->>'advance_id')::uuid AND a.org_id = p_org_id
  WHERE (x->>'amount')::numeric > 0;

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

-- Privileges --------------------------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.payroll_advance_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.payroll_record_advance(uuid, uuid, uuid, numeric, text, numeric, date, date, text, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.payroll_cancel_advance(uuid, uuid, uuid, text) FROM PUBLIC;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.payroll_advance_guard() FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION public.payroll_record_advance(uuid, uuid, uuid, numeric, text, numeric, date, date, text, uuid, boolean) FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION public.payroll_cancel_advance(uuid, uuid, uuid, text) FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION public.payroll_commit_week(uuid, uuid, uuid, uuid, numeric, jsonb) FROM %I', r);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.payroll_record_advance(uuid, uuid, uuid, numeric, text, numeric, date, date, text, uuid, boolean) TO service_role;
    GRANT EXECUTE ON FUNCTION public.payroll_cancel_advance(uuid, uuid, uuid, text) TO service_role;
    GRANT EXECUTE ON FUNCTION public.payroll_commit_week(uuid, uuid, uuid, uuid, numeric, jsonb) TO service_role;
  END IF;
END $$;
