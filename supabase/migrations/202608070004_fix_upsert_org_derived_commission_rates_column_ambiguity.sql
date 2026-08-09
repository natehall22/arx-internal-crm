-- Fixes a bug in upsert_org_derived_commission_rates (migration 202608070003):
-- the RETURNS TABLE output columns were named identically to
-- org_derived_commission_rates' own columns (effective_from, etc). PL/pgSQL scopes
-- OUT parameters as variables for the whole function body, so the ON CONFLICT
-- clause's column reference became ambiguous between the OUT variable and the
-- table column, and every call errored with "column reference is ambiguous".
-- Found via manual verification (a rolled-back transaction against prod, no rows
-- changed) before this function was used by any caller.
--
-- Fix: prefix the OUT columns (out_*). DROP is required because CREATE OR REPLACE
-- cannot change a function's return type.
DROP FUNCTION IF EXISTS upsert_org_derived_commission_rates(UUID, NUMERIC, NUMERIC, NUMERIC, DATE, UUID, TEXT, BOOLEAN);

CREATE FUNCTION upsert_org_derived_commission_rates(
  p_org_id UUID,
  p_inspection NUMERIC,
  p_manager_override NUMERIC,
  p_self_gen NUMERIC,
  p_effective_from DATE,
  p_created_by_user_id UUID,
  p_change_reason TEXT,
  p_apply_to_later_rows BOOLEAN DEFAULT false
)
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
