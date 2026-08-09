-- Phase 1 of the comp-rate admin editor (docs/prompts/comp-plan-admin-editing.md).
--
-- Adds audit columns to org_derived_commission_rates and an RPC that lets a payroll
-- admin edit the org's three derived commission rates (inspection, manager override,
-- self-generated) at any effective date, including backdating into currently-open
-- payroll periods. All schema changes are additive/nullable — existing rows predate
-- this and are left untouched.

ALTER TABLE org_derived_commission_rates
  ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS change_reason TEXT,
  ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ;

COMMENT ON COLUMN org_derived_commission_rates.created_by_user_id IS
  'Payroll admin who saved this rate row via upsert_org_derived_commission_rates. '
  'NULL on rows created by the orgs-column AFTER UPDATE trigger or by the original '
  'migration 202608050002 backfill.';
COMMENT ON COLUMN org_derived_commission_rates.change_reason IS
  'Free-text reason required on every admin-initiated save. NULL on trigger/backfill rows.';
COMMENT ON COLUMN org_derived_commission_rates.superseded_at IS
  'Reserved for future use; not set by this migration.';

-- The orgs AFTER UPDATE trigger (202608050002) must not fire when
-- upsert_org_derived_commission_rates itself updates the orgs columns to keep them
-- in sync with a versioned row — that would insert a second, tomorrow-dated row for
-- a change that already has its own explicit effective date. A transaction-local
-- GUC flag lets the RPC say "skip yourself" without touching trigger wiring.
CREATE OR REPLACE FUNCTION record_org_derived_commission_rates()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_setting('app.skip_org_derived_rate_trigger', true) = 'true' THEN
    RETURN NEW;
  END IF;

  IF NEW.inspection_commission_rate IS DISTINCT FROM OLD.inspection_commission_rate
    OR NEW.manager_override_commission_rate IS DISTINCT FROM OLD.manager_override_commission_rate
    OR NEW.self_gen_commission_rate IS DISTINCT FROM OLD.self_gen_commission_rate THEN
    INSERT INTO org_derived_commission_rates (
      org_id,
      inspection_commission_rate,
      manager_override_commission_rate,
      self_gen_commission_rate,
      effective_from
    ) VALUES (
      NEW.id,
      COALESCE(NEW.inspection_commission_rate, 0),
      NEW.manager_override_commission_rate,
      NEW.self_gen_commission_rate,
      (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::date + 1
    )
    ON CONFLICT (org_id, effective_from) DO UPDATE SET
      inspection_commission_rate = EXCLUDED.inspection_commission_rate,
      manager_override_commission_rate = EXCLUDED.manager_override_commission_rate,
      self_gen_commission_rate = EXCLUDED.self_gen_commission_rate,
      created_at = NOW();
  END IF;
  RETURN NEW;
END;
$$;

-- Upserts a versioned org_derived_commission_rates row for an arbitrary effective
-- date (past, today, or future), keeps orgs' "current" columns in sync with
-- whichever row is now the latest one in effect, and — when p_apply_to_later_rows
-- is true — also overwrites every existing row with a LATER effective_from to the
-- same three rates, so an admin can close the gap where a later zero-rate row would
-- otherwise silently shadow the one they just saved.
--
-- SECURITY DEFINER + fixed search_path, following assign_management_comp_overlay
-- (migration 202608070001).
CREATE OR REPLACE FUNCTION upsert_org_derived_commission_rates(
  p_org_id UUID,
  p_inspection NUMERIC,
  p_manager_override NUMERIC,
  p_self_gen NUMERIC,
  p_effective_from DATE,
  p_created_by_user_id UUID,
  p_change_reason TEXT,
  p_apply_to_later_rows BOOLEAN DEFAULT false
)
-- Output columns are prefixed (out_*) rather than named after the table's own
-- columns: PL/pgSQL treats RETURNS TABLE columns as variables in scope for the
-- whole function body, and a same-named OUT column silently shadows the table
-- column of the same name in statements like `ON CONFLICT (org_id, effective_from)`,
-- producing "column reference is ambiguous" errors (caught in manual verification
-- of this migration before it was reused anywhere).
RETURNS TABLE (
  out_effective_from DATE,
  out_inspection_commission_rate NUMERIC,
  out_manager_override_commission_rate NUMERIC,
  out_self_gen_commission_rate NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::date;
  v_current RECORD;
BEGIN
  IF length(btrim(COALESCE(p_change_reason, ''))) = 0 THEN
    RAISE EXCEPTION 'change reason is required';
  END IF;

  PERFORM 1
  FROM users
  WHERE id = p_created_by_user_id
    AND org_id = p_org_id
    AND role IN ('admin', 'owner', 'operations')
    AND active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'payroll administrator not found';
  END IF;

  IF p_inspection IS NULL OR p_manager_override IS NULL OR p_self_gen IS NULL THEN
    RAISE EXCEPTION 'all three rates are required';
  END IF;
  IF p_inspection < 0 OR p_inspection > 25
    OR p_manager_override < 0 OR p_manager_override > 25
    OR p_self_gen < 0 OR p_self_gen > 25 THEN
    RAISE EXCEPTION 'rates must be between 0 and 25';
  END IF;
  IF round(p_inspection, 2) <> p_inspection
    OR round(p_manager_override, 2) <> p_manager_override
    OR round(p_self_gen, 2) <> p_self_gen THEN
    RAISE EXCEPTION 'rates support at most 2 decimal places';
  END IF;

  INSERT INTO org_derived_commission_rates (
    org_id,
    inspection_commission_rate,
    manager_override_commission_rate,
    self_gen_commission_rate,
    effective_from,
    created_by_user_id,
    change_reason
  ) VALUES (
    p_org_id,
    p_inspection,
    p_manager_override,
    p_self_gen,
    p_effective_from,
    p_created_by_user_id,
    p_change_reason
  )
  ON CONFLICT (org_id, effective_from) DO UPDATE SET
    inspection_commission_rate = EXCLUDED.inspection_commission_rate,
    manager_override_commission_rate = EXCLUDED.manager_override_commission_rate,
    self_gen_commission_rate = EXCLUDED.self_gen_commission_rate,
    created_by_user_id = EXCLUDED.created_by_user_id,
    change_reason = EXCLUDED.change_reason;

  IF p_apply_to_later_rows THEN
    UPDATE org_derived_commission_rates
    SET inspection_commission_rate = p_inspection,
        manager_override_commission_rate = p_manager_override,
        self_gen_commission_rate = p_self_gen,
        created_by_user_id = p_created_by_user_id,
        change_reason = p_change_reason
    WHERE org_id = p_org_id
      AND effective_from > p_effective_from;
  END IF;

  -- Keep orgs' "current" columns equal to whichever row is now latest-in-effect as
  -- of today, recomputed fresh rather than assumed from p_effective_from alone —
  -- correct whether or not this call touched today's row.
  SELECT *
  INTO v_current
  FROM org_derived_commission_rates
  WHERE org_id = p_org_id
    AND effective_from <= v_today
  ORDER BY effective_from DESC
  LIMIT 1;

  IF FOUND THEN
    PERFORM set_config('app.skip_org_derived_rate_trigger', 'true', true);
    UPDATE orgs
    SET inspection_commission_rate = v_current.inspection_commission_rate,
        manager_override_commission_rate = v_current.manager_override_commission_rate,
        self_gen_commission_rate = v_current.self_gen_commission_rate
    WHERE id = p_org_id;
  END IF;

  RETURN QUERY
  SELECT r.effective_from, r.inspection_commission_rate, r.manager_override_commission_rate,
         r.self_gen_commission_rate
  FROM org_derived_commission_rates r
  WHERE r.org_id = p_org_id
  ORDER BY r.effective_from ASC;
END;
$$;


COMMENT ON FUNCTION upsert_org_derived_commission_rates IS
  'Admin entry point for editing the three org-wide derived commission rates '
  '(inspection, manager override, self-gen) at an explicit effective date. Requires '
  'a non-empty change_reason and an active admin/owner/operations user. Keeps '
  'orgs.* in sync with whichever row is latest-in-effect and suppresses the '
  'orgs AFTER UPDATE trigger while doing so (app.skip_org_derived_rate_trigger) so '
  'the sync never creates a second, tomorrow-dated history row for the same change. '
  'p_apply_to_later_rows overwrites every existing row with a later effective_from '
  'to the same three rates — used when the caller has confirmed they want to close '
  'the gap where a later, already-scheduled row would otherwise shadow this one.';

SELECT pg_notify('pgrst', 'reload schema');
