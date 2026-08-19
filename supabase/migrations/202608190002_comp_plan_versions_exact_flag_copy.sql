-- Fix-up to 202608190001, caught by the post-migration run of
-- scripts/comp-plan-version-parity.ts --live before any code shipped against the table.
--
-- The version table declared the three plan flags NOT NULL with defaults, so the backfill
-- had to COALESCE them. Three prod plans (Call center rep, FM 2.0, Setter) carry
-- personal_sales_enabled = NULL, which the backfill turned into TRUE. Nothing pays
-- differently — calculateCommissionFromPlanForSale never reads that flag, every UI
-- consumer tests `!== false` or is gated behind is_manager_plan, and all three plans are
-- non-manager — but a version row is supposed to be exactly what the plan was on that
-- date, not a normalized version of it. A version that quietly disagrees with its source
-- is the failure mode this whole table exists to prevent.
--
-- So: allow NULL, then restate the backfilled rows as verbatim copies.

ALTER TABLE comp_plan_versions ALTER COLUMN is_manager_plan DROP NOT NULL;
ALTER TABLE comp_plan_versions ALTER COLUMN is_manager_plan DROP DEFAULT;
ALTER TABLE comp_plan_versions ALTER COLUMN personal_sales_enabled DROP NOT NULL;
ALTER TABLE comp_plan_versions ALTER COLUMN personal_sales_enabled DROP DEFAULT;
ALTER TABLE comp_plan_versions ALTER COLUMN team_override_enabled DROP NOT NULL;
ALTER TABLE comp_plan_versions ALTER COLUMN team_override_enabled DROP DEFAULT;

-- The append-only trigger is doing its job; this is the one legitimate correction of a
-- backfill that no deployed code has read yet. Disabled for this statement only.
ALTER TABLE comp_plan_versions DISABLE TRIGGER comp_plan_versions_append_only;

UPDATE comp_plan_versions v
SET is_manager_plan = p.is_manager_plan,
    personal_sales_enabled = p.personal_sales_enabled,
    team_override_enabled = p.team_override_enabled
FROM comp_plans p
WHERE p.id = v.comp_plan_id
  AND v.effective_from = DATE '2000-01-01'
  AND v.created_by_user_id IS NULL;

ALTER TABLE comp_plan_versions ENABLE TRIGGER comp_plan_versions_append_only;

-- And stop the RPC from doing the same coercion on every future amendment, in the
-- version row and in the plan-row mirror alike. The admin UI deliberately sends null for
-- personal_sales_enabled / team_override_enabled on non-manager plans.
CREATE OR REPLACE FUNCTION amend_comp_plan_version(
  p_org_id UUID,
  p_comp_plan_id UUID,
  p_effective_from DATE,
  p_body JSONB,
  p_created_by_user_id UUID,
  p_change_reason TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_version_id UUID;
BEGIN
  IF length(btrim(COALESCE(p_change_reason, ''))) = 0 THEN
    RAISE EXCEPTION 'change reason is required';
  END IF;

  PERFORM 1
  FROM users
  WHERE id = p_created_by_user_id
    AND org_id = p_org_id
    AND role IN ('admin', 'owner', 'operations')
    AND active = TRUE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'payroll administrator not found';
  END IF;

  PERFORM 1 FROM comp_plans WHERE id = p_comp_plan_id AND org_id = p_org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'comp plan not found';
  END IF;

  IF EXISTS (
    SELECT 1 FROM comp_plan_versions
    WHERE org_id = p_org_id
      AND comp_plan_id = p_comp_plan_id
      AND effective_from = p_effective_from
  ) THEN
    RAISE EXCEPTION 'a version of this plan already starts on %; versions are append-only, choose another date', p_effective_from;
  END IF;

  INSERT INTO comp_plan_versions (
    org_id, comp_plan_id, effective_from,
    plan_type, base_percentage, flat_amount, hourly_rate, unit_rate, unit_type,
    hybrid_components, tiers, volume_bonuses, team_overrides,
    is_manager_plan, personal_sales_enabled, team_override_enabled,
    created_by_user_id, change_reason
  ) VALUES (
    p_org_id, p_comp_plan_id, p_effective_from,
    (p_body ->> 'plan_type')::comp_plan_type,
    NULLIF(p_body ->> 'base_percentage', '')::NUMERIC,
    NULLIF(p_body ->> 'flat_amount', '')::NUMERIC,
    NULLIF(p_body ->> 'hourly_rate', '')::NUMERIC,
    NULLIF(p_body ->> 'unit_rate', '')::NUMERIC,
    NULLIF(p_body ->> 'unit_type', ''),
    CASE WHEN jsonb_typeof(p_body -> 'hybrid_components') = 'array' THEN p_body -> 'hybrid_components' END,
    CASE WHEN jsonb_typeof(p_body -> 'tiers') = 'array' THEN p_body -> 'tiers' END,
    CASE WHEN jsonb_typeof(p_body -> 'volume_bonuses') = 'array' THEN p_body -> 'volume_bonuses' END,
    CASE WHEN jsonb_typeof(p_body -> 'team_overrides') IN ('array', 'object') THEN p_body -> 'team_overrides' END,
    (p_body ->> 'is_manager_plan')::BOOLEAN,
    (p_body ->> 'personal_sales_enabled')::BOOLEAN,
    (p_body ->> 'team_override_enabled')::BOOLEAN,
    p_created_by_user_id,
    btrim(p_change_reason)
  )
  RETURNING id INTO v_version_id;

  IF p_effective_from <= (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::date THEN
    UPDATE comp_plans SET
      plan_type = (p_body ->> 'plan_type')::comp_plan_type,
      base_percentage = NULLIF(p_body ->> 'base_percentage', '')::NUMERIC,
      flat_amount = NULLIF(p_body ->> 'flat_amount', '')::NUMERIC,
      hourly_rate = NULLIF(p_body ->> 'hourly_rate', '')::NUMERIC,
      unit_rate = NULLIF(p_body ->> 'unit_rate', '')::NUMERIC,
      unit_type = NULLIF(p_body ->> 'unit_type', ''),
      hybrid_components = CASE WHEN jsonb_typeof(p_body -> 'hybrid_components') = 'array' THEN p_body -> 'hybrid_components' END,
      tiers = CASE WHEN jsonb_typeof(p_body -> 'tiers') = 'array' THEN p_body -> 'tiers' END,
      volume_bonuses = CASE WHEN jsonb_typeof(p_body -> 'volume_bonuses') = 'array' THEN p_body -> 'volume_bonuses' END,
      team_overrides = CASE WHEN jsonb_typeof(p_body -> 'team_overrides') IN ('array', 'object') THEN p_body -> 'team_overrides' END,
      is_manager_plan = (p_body ->> 'is_manager_plan')::BOOLEAN,
      personal_sales_enabled = (p_body ->> 'personal_sales_enabled')::BOOLEAN,
      team_override_enabled = (p_body ->> 'team_override_enabled')::BOOLEAN,
      updated_at = NOW()
    WHERE id = p_comp_plan_id AND org_id = p_org_id;
  END IF;

  RETURN v_version_id;
END;
$$;

REVOKE ALL ON FUNCTION amend_comp_plan_version(UUID, UUID, DATE, JSONB, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION amend_comp_plan_version(UUID, UUID, DATE, JSONB, UUID, TEXT)
  TO service_role;
