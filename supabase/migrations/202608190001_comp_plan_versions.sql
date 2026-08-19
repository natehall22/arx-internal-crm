-- Phase 3 — effective-dated comp plan bodies (design: docs/prompts/comp-plan-versioning-phase3.md).
--
-- `comp_plans` carries both a plan's identity and its pay-affecting terms, with no
-- history, so editing a live plan silently restates what every past job pays. That is
-- why PUT /api/admin/data?resource=comp_plan hard-409s on any assigned plan — and since
-- all 8 prod plans are assigned, no comp plan was editable at all.
--
-- This table holds the terms instead, append-only, one row per change with an
-- effective_from. Payroll resolves the body on the job's SALE DATE, exactly as it already
-- resolves org derived rates (org_derived_commission_rates) and management overlay rates
-- (management_comp_overlay_plan_versions). Amending then means "add a version from date
-- X" and history keeps paying what it always paid.
--
-- Additive only: nothing is dropped, nothing existing is rewritten. The backfill copies
-- each plan body verbatim at a date that predates every sale, so resolution is a no-op on
-- day one. That neutrality was proved before this ran, over every real (assignment, sale
-- date) pair, by scripts/comp-plan-version-parity.ts (18,496 comparisons, zero diffs).

CREATE TABLE IF NOT EXISTS comp_plan_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  comp_plan_id UUID NOT NULL,
  effective_from DATE NOT NULL,

  -- The pay-affecting body. Mirrors COMP_PLAN_BODY_FIELDS in lib/comp-plan-version.ts.
  -- `is_manager_plan` belongs here rather than with identity: it gates who earns derived
  -- lines in buildAdditiveParticipantsForJob, so changing it changes pay.
  plan_type comp_plan_type NOT NULL,
  base_percentage NUMERIC(5, 2) NULL,
  flat_amount NUMERIC(10, 2) NULL,
  hourly_rate NUMERIC(10, 2) NULL,
  unit_rate NUMERIC(10, 2) NULL,
  unit_type VARCHAR NULL,
  hybrid_components JSONB NULL,
  tiers JSONB NULL,
  volume_bonuses JSONB NULL,
  team_overrides JSONB NULL,
  is_manager_plan BOOLEAN NOT NULL DEFAULT FALSE,
  personal_sales_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  team_override_enabled BOOLEAN NOT NULL DEFAULT FALSE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- NULL only for the backfill below, which has no human actor. Every version written
  -- through amend_comp_plan_version() records one.
  created_by_user_id UUID NULL,
  change_reason TEXT NOT NULL,

  CONSTRAINT comp_plan_versions_reason_check
    CHECK (length(btrim(change_reason)) > 0),
  CONSTRAINT comp_plan_versions_base_percentage_check
    CHECK (base_percentage IS NULL OR (base_percentage >= 0 AND base_percentage <= 100)),
  CONSTRAINT comp_plan_versions_non_negative_check
    CHECK (
      (flat_amount IS NULL OR flat_amount >= 0)
      AND (hourly_rate IS NULL OR hourly_rate >= 0)
      AND (unit_rate IS NULL OR unit_rate >= 0)
    ),
  CONSTRAINT comp_plan_versions_org_fkey
    FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE RESTRICT,
  CONSTRAINT comp_plan_versions_plan_org_fkey
    FOREIGN KEY (org_id, comp_plan_id) REFERENCES comp_plans(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT comp_plan_versions_creator_org_fkey
    FOREIGN KEY (org_id, created_by_user_id) REFERENCES users(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT comp_plan_versions_effective_unique
    UNIQUE (org_id, comp_plan_id, effective_from)
);

CREATE INDEX IF NOT EXISTS idx_comp_plan_versions_lookup
  ON comp_plan_versions (org_id, comp_plan_id, effective_from DESC);

ALTER TABLE comp_plan_versions ENABLE ROW LEVEL SECURITY;

-- Append-only, like management_comp_overlay_plan_versions. A version that could be
-- edited in place would reintroduce exactly the problem this table exists to fix.
CREATE OR REPLACE FUNCTION reject_comp_plan_version_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'comp_plan_versions is append-only — amend the plan with a new effective-dated version instead';
END;
$$;

DROP TRIGGER IF EXISTS comp_plan_versions_append_only ON comp_plan_versions;
CREATE TRIGGER comp_plan_versions_append_only
  BEFORE UPDATE OR DELETE ON comp_plan_versions
  FOR EACH ROW EXECUTE FUNCTION reject_comp_plan_version_mutation();

-- Backfill: one version per plan, dated before every sale in the system (earliest prod
-- sale is 2026-02-28). Using the earliest assignment date instead would leave a window
-- that resolves to nothing, which is how a resolver silently pays zero.
INSERT INTO comp_plan_versions (
  org_id, comp_plan_id, effective_from,
  plan_type, base_percentage, flat_amount, hourly_rate, unit_rate, unit_type,
  hybrid_components, tiers, volume_bonuses, team_overrides,
  is_manager_plan, personal_sales_enabled, team_override_enabled,
  created_by_user_id, change_reason
)
SELECT
  org_id, id, DATE '2000-01-01',
  plan_type, base_percentage, flat_amount, hourly_rate, unit_rate, unit_type,
  hybrid_components, tiers, volume_bonuses, team_overrides,
  COALESCE(is_manager_plan, FALSE), COALESCE(personal_sales_enabled, TRUE), COALESCE(team_override_enabled, FALSE),
  NULL,
  'Backfilled from the plan row when plan versioning was introduced — identical terms, no change in pay'
FROM comp_plans
ON CONFLICT (org_id, comp_plan_id, effective_from) DO NOTHING;

-- Amend = add a version. The only write path.
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

  -- Same payroll-admin set as every other comp RPC. Never widen this.
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
    COALESCE((p_body ->> 'is_manager_plan')::BOOLEAN, FALSE),
    COALESCE((p_body ->> 'personal_sales_enabled')::BOOLEAN, TRUE),
    COALESCE((p_body ->> 'team_override_enabled')::BOOLEAN, FALSE),
    p_created_by_user_id,
    btrim(p_change_reason)
  )
  RETURNING id INTO v_version_id;

  -- Keep the plan row as a mirror of the version in effect TODAY, the same way
  -- upsert_org_derived_commission_rates syncs the orgs columns. Two reasons: the many
  -- non-payroll surfaces that still read comp_plans directly (plan cards, the estimator,
  -- the rep commission widget) stay correct, and the resolver's no-version fallback can
  -- never disagree with the current version. A future-dated amendment deliberately does
  -- NOT touch the plan row — it is not in effect yet.
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
      is_manager_plan = COALESCE((p_body ->> 'is_manager_plan')::BOOLEAN, FALSE),
      personal_sales_enabled = COALESCE((p_body ->> 'personal_sales_enabled')::BOOLEAN, TRUE),
      team_override_enabled = COALESCE((p_body ->> 'team_override_enabled')::BOOLEAN, FALSE),
      updated_at = NOW()
    WHERE id = p_comp_plan_id AND org_id = p_org_id;
  END IF;

  RETURN v_version_id;
END;
$$;

-- Postgres grants EXECUTE on a new function to PUBLIC, which in Supabase includes anon
-- and authenticated. Without this pair any authenticated rep could call the RPC straight
-- from the SDK, passing some admin's id as p_created_by_user_id, and rewrite plan terms —
-- see migration 202608070005, which exists because that exact hole was shipped once.
REVOKE ALL ON FUNCTION amend_comp_plan_version(UUID, UUID, DATE, JSONB, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION amend_comp_plan_version(UUID, UUID, DATE, JSONB, UUID, TEXT)
  TO service_role;

COMMENT ON TABLE comp_plan_versions IS
  'Append-only effective-dated comp plan terms. Payroll resolves the body on a job''s sale date; comp_plans keeps identity only.';
