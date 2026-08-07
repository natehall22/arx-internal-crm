-- Effective-dated management compensation overlays.
--
-- These records are deliberately separate from a user's primary production comp-plan
-- assignment. A manager may therefore carry one primary plan and, independently, one
-- setter-management overlay and/or one closer-management overlay for the same dates.
--
-- This migration is additive only. It does not infer or backfill historical
-- assignments or rates: a date with no recorded overlay remains blank in payroll.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Explicit per-job overrides remain the highest-precedence source. Separate roles
-- let an admin suppress or replace one management lane (including an explicit $0)
-- without suppressing the other lane for the same job and recipient.
ALTER TABLE deal_commission_roles
  DROP CONSTRAINT IF EXISTS deal_commission_roles_role_check;

ALTER TABLE deal_commission_roles
  ADD CONSTRAINT deal_commission_roles_role_check
  CHECK (
    role IN (
      'setter',
      'closer',
      'inspector',
      'field_manager',
      'senior_manager',
      'self_gen',
      'setter_manager_override',
      'closer_manager_override',
      'custom'
    )
  );

-- Composite tenant keys used by the foreign keys below. `id` remains each table's
-- primary key; these indexes add an organization boundary to every relationship.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_org_id_id
  ON users (org_id, id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_comp_plans_org_id_id
  ON comp_plans (org_id, id);

ALTER TABLE comp_plans
  ADD COLUMN IF NOT EXISTS plan_purpose TEXT NOT NULL DEFAULT 'primary';

ALTER TABLE comp_plans
  DROP CONSTRAINT IF EXISTS comp_plans_plan_purpose_check;

ALTER TABLE comp_plans
  ADD CONSTRAINT comp_plans_plan_purpose_check
  CHECK (plan_purpose IN ('primary', 'management_overlay'));

-- Primary assignments keep their own independent timeline. They may overlap a
-- management overlay, but never another primary plan for the same person/date.
DO $$
DECLARE
  overlap_count INTEGER;
BEGIN
  SELECT count(*)
  INTO overlap_count
  FROM user_comp_plans a
  JOIN user_comp_plans b
    ON a.org_id = b.org_id
   AND a.user_id = b.user_id
   AND a.id < b.id
   AND daterange(a.effective_from, a.effective_to, '[]') &&
       daterange(b.effective_from, b.effective_to, '[]')
  WHERE a.user_id IS NOT NULL;

  IF overlap_count > 0 THEN
    RAISE EXCEPTION
      'Cannot install primary comp-plan overlap protection: % overlapping assignment pair(s) exist',
      overlap_count;
  END IF;
END;
$$;

ALTER TABLE user_comp_plans
  DROP CONSTRAINT IF EXISTS user_comp_plans_no_overlap;

ALTER TABLE user_comp_plans
  ADD CONSTRAINT user_comp_plans_no_overlap
  EXCLUDE USING gist (
    org_id WITH =,
    user_id WITH =,
    daterange(effective_from, effective_to, '[]') WITH &&
  )
  WHERE (user_id IS NOT NULL);

ALTER TABLE user_comp_plans
  ADD COLUMN IF NOT EXISTS created_by_user_id UUID NULL;

ALTER TABLE user_comp_plans
  ADD COLUMN IF NOT EXISTS change_reason TEXT NULL;

ALTER TABLE user_comp_plans
  ADD COLUMN IF NOT EXISTS replaced_assignment_id UUID NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_comp_plans_org_id_id
  ON user_comp_plans (org_id, id);

ALTER TABLE user_comp_plans
  DROP CONSTRAINT IF EXISTS user_comp_plans_replaced_assignment_fkey;
ALTER TABLE user_comp_plans
  ADD CONSTRAINT user_comp_plans_replaced_assignment_fkey
  FOREIGN KEY (org_id, replaced_assignment_id)
  REFERENCES user_comp_plans(org_id, id) ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS primary_comp_plan_assignment_cancellations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE RESTRICT,
  assignment_id UUID NOT NULL,
  assignment_snapshot JSONB NOT NULL,
  cancelled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cancelled_by_user_id UUID NOT NULL,
  cancellation_reason TEXT NOT NULL CHECK (length(btrim(cancellation_reason)) > 0),
  FOREIGN KEY (org_id, cancelled_by_user_id)
    REFERENCES users(org_id, id) ON DELETE RESTRICT
);
ALTER TABLE primary_comp_plan_assignment_cancellations ENABLE ROW LEVEL SECURITY;

-- Keep the existing single-column FKs as the only PostgREST relationships so
-- `users(...)` and `comp_plans(...)` embeds do not become ambiguous. This trigger
-- adds the missing organization boundary, including for the audit actor.
CREATE OR REPLACE FUNCTION enforce_user_comp_plan_org_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM users WHERE id = NEW.user_id AND org_id = NEW.org_id
  ) THEN
    RAISE EXCEPTION 'user comp-plan recipient belongs to another organization';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM comp_plans WHERE id = NEW.comp_plan_id AND org_id = NEW.org_id
  ) THEN
    RAISE EXCEPTION 'user comp plan belongs to another organization';
  END IF;
  IF NEW.created_by_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM users WHERE id = NEW.created_by_user_id AND org_id = NEW.org_id
  ) THEN
    RAISE EXCEPTION 'user comp-plan actor belongs to another organization';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_user_comp_plan_org_scope ON user_comp_plans;
CREATE TRIGGER trg_enforce_user_comp_plan_org_scope
BEFORE INSERT OR UPDATE ON user_comp_plans
FOR EACH ROW EXECUTE FUNCTION enforce_user_comp_plan_org_scope();

-- All compensation mutations go through authenticated server routes and audited
-- service-role RPCs. Direct Data API writes would bypass effective-date and audit
-- enforcement, so retain read policies but remove legacy mutation policies.
DROP POLICY IF EXISTS "Admins can manage comp plans" ON comp_plans;
DROP POLICY IF EXISTS "Admins can manage user comp plans" ON user_comp_plans;
DROP POLICY IF EXISTS "Admins can manage comp plan assignments" ON user_comp_plans;

-- Immutable fixed-rate terms owned by a comp plan. There are intentionally no tier,
-- volume, or regional fields: only setter and closer management lanes are supported.
CREATE TABLE IF NOT EXISTS management_comp_overlay_plan_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  comp_plan_id UUID NOT NULL,
  lane TEXT NOT NULL,
  override_percent NUMERIC(5, 2) NOT NULL,
  effective_from DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by_user_id UUID NOT NULL,
  change_reason TEXT NOT NULL,

  CONSTRAINT management_overlay_version_lane_check
    CHECK (lane IN ('setter', 'closer')),
  CONSTRAINT management_overlay_version_rate_check
    CHECK (override_percent >= 0 AND override_percent <= 100),
  CONSTRAINT management_overlay_version_reason_check
    CHECK (length(btrim(change_reason)) > 0),
  CONSTRAINT management_overlay_version_org_fkey
    FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE RESTRICT,
  CONSTRAINT management_overlay_version_plan_org_fkey
    FOREIGN KEY (org_id, comp_plan_id)
    REFERENCES comp_plans(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT management_overlay_version_creator_org_fkey
    FOREIGN KEY (org_id, created_by_user_id)
    REFERENCES users(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT management_overlay_version_effective_unique
    UNIQUE (org_id, comp_plan_id, lane, effective_from)
);

CREATE INDEX IF NOT EXISTS idx_management_overlay_versions_lookup
  ON management_comp_overlay_plan_versions
    (org_id, comp_plan_id, lane, effective_from DESC);

ALTER TABLE management_comp_overlay_plan_versions ENABLE ROW LEVEL SECURITY;

-- A manager's effective-dated overlay assignment. Direct-report history determines
-- whose production rolls to the manager; this table only establishes which plan and
-- lane supplied that manager's terms on the sale date.
CREATE TABLE IF NOT EXISTS user_management_comp_overlay_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  user_id UUID NOT NULL,
  comp_plan_id UUID NOT NULL,
  replaced_assignment_id UUID NULL,
  lane TEXT NOT NULL,
  effective_from DATE NOT NULL,
  effective_to DATE NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by_user_id UUID NOT NULL,
  change_reason TEXT NOT NULL,
  ended_at TIMESTAMPTZ NULL,
  ended_by_user_id UUID NULL,
  end_reason TEXT NULL,
  cancelled_at TIMESTAMPTZ NULL,
  cancelled_by_user_id UUID NULL,
  cancellation_reason TEXT NULL,

  CONSTRAINT user_management_overlay_lane_check
    CHECK (lane IN ('setter', 'closer')),
  CONSTRAINT user_management_overlay_dates_check
    CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT user_management_overlay_reason_check
    CHECK (length(btrim(change_reason)) > 0),
  CONSTRAINT user_management_overlay_end_audit_check
    CHECK (
      (ended_at IS NULL AND ended_by_user_id IS NULL AND end_reason IS NULL)
      OR (ended_at IS NOT NULL AND ended_by_user_id IS NOT NULL AND length(btrim(end_reason)) > 0)
    ),
  CONSTRAINT user_management_overlay_cancel_audit_check
    CHECK (
      (cancelled_at IS NULL AND cancelled_by_user_id IS NULL AND cancellation_reason IS NULL)
      OR (cancelled_at IS NOT NULL AND cancelled_by_user_id IS NOT NULL AND length(btrim(cancellation_reason)) > 0)
    ),
  CONSTRAINT user_management_overlay_org_fkey
    FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE RESTRICT,
  CONSTRAINT user_management_overlay_user_org_fkey
    FOREIGN KEY (org_id, user_id)
    REFERENCES users(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT user_management_overlay_plan_org_fkey
    FOREIGN KEY (org_id, comp_plan_id)
    REFERENCES comp_plans(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT user_management_overlay_creator_org_fkey
    FOREIGN KEY (org_id, created_by_user_id)
    REFERENCES users(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT user_management_overlay_org_id_id_unique UNIQUE (org_id, id),
  CONSTRAINT user_management_overlay_replaced_assignment_fkey
    FOREIGN KEY (org_id, replaced_assignment_id)
    REFERENCES user_management_comp_overlay_assignments(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT user_management_overlay_ended_by_org_fkey
    FOREIGN KEY (org_id, ended_by_user_id)
    REFERENCES users(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT user_management_overlay_cancelled_by_org_fkey
    FOREIGN KEY (org_id, cancelled_by_user_id)
    REFERENCES users(org_id, id) ON DELETE RESTRICT,

  -- Inclusive effective_to semantics. The exclusion is per lane, so one manager may
  -- hold a setter overlay and a closer overlay concurrently, but never two competing
  -- plans for the same lane and date.
  CONSTRAINT user_management_overlay_no_overlap
    EXCLUDE USING gist (
      org_id WITH =,
      user_id WITH =,
      lane WITH =,
      daterange(effective_from, effective_to, '[]') WITH &&
    ) WHERE (cancelled_at IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_user_management_overlay_lookup
  ON user_management_comp_overlay_assignments
    (org_id, user_id, lane, effective_from, effective_to);

ALTER TABLE user_management_comp_overlay_assignments ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION protect_management_overlay_assignment_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_today DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::date;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'management overlay assignments cannot be deleted';
  END IF;

  IF NEW.org_id IS DISTINCT FROM OLD.org_id
    OR NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.comp_plan_id IS DISTINCT FROM OLD.comp_plan_id
    OR NEW.replaced_assignment_id IS DISTINCT FROM OLD.replaced_assignment_id
    OR NEW.lane IS DISTINCT FROM OLD.lane
    OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
    OR NEW.change_reason IS DISTINCT FROM OLD.change_reason THEN
    RAISE EXCEPTION 'management overlay assignment identity and audit history are immutable';
  END IF;

  IF OLD.cancelled_at IS NULL
    AND NEW.cancelled_at IS NOT NULL
    AND NEW.cancelled_by_user_id IS NOT NULL
    AND length(btrim(COALESCE(NEW.cancellation_reason, ''))) > 0
    AND OLD.effective_from > v_today
    AND NEW.effective_to IS NOT DISTINCT FROM OLD.effective_to
    AND NEW.ended_at IS NOT DISTINCT FROM OLD.ended_at
    AND NEW.ended_by_user_id IS NOT DISTINCT FROM OLD.ended_by_user_id
    AND NEW.end_reason IS NOT DISTINCT FROM OLD.end_reason THEN
    RETURN NEW;
  END IF;

  IF NEW.cancelled_at IS NOT DISTINCT FROM OLD.cancelled_at
    AND NEW.cancelled_by_user_id IS NOT DISTINCT FROM OLD.cancelled_by_user_id
    AND NEW.cancellation_reason IS NOT DISTINCT FROM OLD.cancellation_reason
    AND OLD.ended_at IS NULL
    AND NEW.ended_at IS NOT NULL
    AND NEW.ended_by_user_id IS NOT NULL
    AND length(btrim(COALESCE(NEW.end_reason, ''))) > 0
    AND NEW.effective_to IS NOT NULL
    AND NEW.effective_to >= GREATEST(OLD.effective_from, v_today)
    AND (OLD.effective_to IS NULL OR NEW.effective_to <= OLD.effective_to) THEN
    RETURN NEW;
  END IF;

  -- Cancelling a future replacement reopens only the exact predecessor that the
  -- cancelled row had scheduled to end. The cancellation row retains the actor,
  -- time, and reason for this restoration.
  IF OLD.ended_at IS NOT NULL
    AND OLD.effective_to IS NOT NULL
    AND OLD.effective_to >= v_today
    AND NEW.effective_to IS NULL
    AND NEW.ended_at IS NULL
    AND NEW.ended_by_user_id IS NULL
    AND NEW.end_reason IS NULL
    AND NEW.cancelled_at IS NOT DISTINCT FROM OLD.cancelled_at
    AND NEW.cancelled_by_user_id IS NOT DISTINCT FROM OLD.cancelled_by_user_id
    AND NEW.cancellation_reason IS NOT DISTINCT FROM OLD.cancellation_reason
    AND EXISTS (
      SELECT 1
      FROM user_management_comp_overlay_assignments cancelled_child
      WHERE cancelled_child.org_id = OLD.org_id
        AND cancelled_child.user_id = OLD.user_id
        AND cancelled_child.lane = OLD.lane
        AND cancelled_child.replaced_assignment_id = OLD.id
        AND cancelled_child.effective_from = OLD.effective_to + 1
        AND cancelled_child.cancelled_at IS NOT NULL
        AND cancelled_child.cancelled_by_user_id IS NOT NULL
        AND length(btrim(COALESCE(cancelled_child.cancellation_reason, ''))) > 0
    ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'management overlay assignments may only be cancelled or end-dated through audited payroll operations';
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_management_overlay_assignment_history
  ON user_management_comp_overlay_assignments;
CREATE TRIGGER trg_protect_management_overlay_assignment_history
BEFORE UPDATE OR DELETE ON user_management_comp_overlay_assignments
FOR EACH ROW EXECUTE FUNCTION protect_management_overlay_assignment_history();

-- Financial terms are append-only. A correction or rate change is represented by a
-- new future-effective version, preserving the exact term used by historical payroll.
CREATE OR REPLACE FUNCTION reject_management_overlay_version_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'management compensation overlay versions are immutable; insert a new effective-dated version';
END;
$$;

DROP TRIGGER IF EXISTS trg_reject_management_overlay_version_update
  ON management_comp_overlay_plan_versions;
CREATE TRIGGER trg_reject_management_overlay_version_update
BEFORE UPDATE OR DELETE ON management_comp_overlay_plan_versions
FOR EACH ROW EXECUTE FUNCTION reject_management_overlay_version_mutation();

DROP TRIGGER IF EXISTS trg_reject_primary_comp_plan_cancellation_mutation
  ON primary_comp_plan_assignment_cancellations;
CREATE TRIGGER trg_reject_primary_comp_plan_cancellation_mutation
BEFORE UPDATE OR DELETE ON primary_comp_plan_assignment_cancellations
FOR EACH ROW EXECUTE FUNCTION reject_management_overlay_version_mutation();

-- Atomically schedule a manager's overlay and its fixed plan rate. Normal changes
-- start no earlier than tomorrow in the organization's operating timezone, close the
-- prior open assignment the day before, and never rewrite an already-earned date.
CREATE OR REPLACE FUNCTION assign_management_comp_overlay(
  p_org_id UUID,
  p_user_id UUID,
  p_comp_plan_id UUID,
  p_lane TEXT,
  p_override_percent NUMERIC,
  p_effective_from DATE,
  p_created_by_user_id UUID,
  p_change_reason TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::date;
  v_assignment_id UUID;
  v_replaced_assignment_id UUID;
  v_existing_rate NUMERIC(5, 2);
BEGIN
  IF p_lane NOT IN ('setter', 'closer') THEN
    RAISE EXCEPTION 'invalid management overlay lane';
  END IF;
  IF p_override_percent < 0 OR p_override_percent > 100 THEN
    RAISE EXCEPTION 'management overlay rate must be between 0 and 100';
  END IF;
  IF p_effective_from <= v_today THEN
    RAISE EXCEPTION 'management overlay changes must start after today';
  END IF;
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

  PERFORM 1 FROM users
  WHERE id = p_user_id
    AND org_id = p_org_id
    AND active = true
    AND (
      (p_lane = 'setter' AND role = 'setter_manager')
      OR (p_lane = 'closer' AND role = 'sales_manager')
    );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'overlay recipient role does not match the selected lane';
  END IF;

  PERFORM 1 FROM comp_plans
  WHERE id = p_comp_plan_id
    AND org_id = p_org_id
    AND plan_purpose = 'management_overlay'
    AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'active management overlay plan not found';
  END IF;

  -- Keep one manageable future change per lane. A scheduled row must be cancelled
  -- before another is added, so cancellation can restore its exact predecessor
  -- without having to rewire a hidden chain of later assignments.
  PERFORM 1
  FROM user_management_comp_overlay_assignments
  WHERE org_id = p_org_id
    AND user_id = p_user_id
    AND lane = p_lane
    AND effective_from > v_today
    AND cancelled_at IS NULL;
  IF FOUND THEN
    RAISE EXCEPTION 'a management overlay is already scheduled on or after this date';
  END IF;

  SELECT override_percent
  INTO v_existing_rate
  FROM management_comp_overlay_plan_versions
  WHERE org_id = p_org_id
    AND comp_plan_id = p_comp_plan_id
    AND lane = p_lane
    AND effective_from <= p_effective_from
  ORDER BY effective_from DESC
  LIMIT 1;

  IF v_existing_rate IS NULL OR v_existing_rate IS DISTINCT FROM p_override_percent THEN
    INSERT INTO management_comp_overlay_plan_versions (
      org_id,
      comp_plan_id,
      lane,
      override_percent,
      effective_from,
      created_by_user_id,
      change_reason
    ) VALUES (
      p_org_id,
      p_comp_plan_id,
      p_lane,
      p_override_percent,
      p_effective_from,
      p_created_by_user_id,
      p_change_reason
    )
    ON CONFLICT (org_id, comp_plan_id, lane, effective_from) DO NOTHING;

    SELECT override_percent
    INTO v_existing_rate
    FROM management_comp_overlay_plan_versions
    WHERE org_id = p_org_id
      AND comp_plan_id = p_comp_plan_id
      AND lane = p_lane
      AND effective_from = p_effective_from;
    IF v_existing_rate IS DISTINCT FROM p_override_percent THEN
      RAISE EXCEPTION 'a different management overlay rate already exists on this effective date';
    END IF;
  END IF;

  UPDATE user_management_comp_overlay_assignments
  SET effective_to = p_effective_from - 1,
      ended_at = NOW(),
      ended_by_user_id = p_created_by_user_id,
      end_reason = 'Replaced by scheduled overlay: ' || p_change_reason
  WHERE org_id = p_org_id
    AND user_id = p_user_id
    AND lane = p_lane
    AND effective_from < p_effective_from
    AND cancelled_at IS NULL
    AND (effective_to IS NULL OR effective_to >= p_effective_from)
  RETURNING id INTO v_replaced_assignment_id;

  INSERT INTO user_management_comp_overlay_assignments (
    org_id,
    user_id,
    comp_plan_id,
    replaced_assignment_id,
    lane,
    effective_from,
    created_by_user_id,
    change_reason
  ) VALUES (
    p_org_id,
    p_user_id,
    p_comp_plan_id,
    v_replaced_assignment_id,
    p_lane,
    p_effective_from,
    p_created_by_user_id,
    p_change_reason
  )
  RETURNING id INTO v_assignment_id;

  RETURN v_assignment_id;
END;
$$;

REVOKE ALL ON FUNCTION assign_management_comp_overlay(
  UUID, UUID, UUID, TEXT, NUMERIC, DATE, UUID, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION assign_management_comp_overlay(
  UUID, UUID, UUID, TEXT, NUMERIC, DATE, UUID, TEXT
) TO service_role;

CREATE OR REPLACE FUNCTION cancel_management_comp_overlay(
  p_org_id UUID,
  p_assignment_id UUID,
  p_created_by_user_id UUID,
  p_change_reason TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::date;
  v_replaced_assignment_id UUID;
  v_effective_from DATE;
BEGIN
  IF length(btrim(COALESCE(p_change_reason, ''))) = 0 THEN
    RAISE EXCEPTION 'cancellation reason is required';
  END IF;
  PERFORM 1 FROM users
  WHERE id = p_created_by_user_id AND org_id = p_org_id
    AND role IN ('admin', 'owner', 'operations') AND active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'payroll administrator not found'; END IF;

  UPDATE user_management_comp_overlay_assignments
  SET cancelled_at = NOW(),
      cancelled_by_user_id = p_created_by_user_id,
      cancellation_reason = p_change_reason
  WHERE id = p_assignment_id
    AND org_id = p_org_id
    AND effective_from > v_today
    AND cancelled_at IS NULL
  RETURNING replaced_assignment_id, effective_from
    INTO v_replaced_assignment_id, v_effective_from;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'future management overlay assignment not found';
  END IF;

  IF v_replaced_assignment_id IS NOT NULL THEN
    UPDATE user_management_comp_overlay_assignments
    SET effective_to = NULL,
        ended_at = NULL,
        ended_by_user_id = NULL,
        end_reason = NULL
    WHERE id = v_replaced_assignment_id
      AND org_id = p_org_id
      AND effective_to = v_effective_from - 1
      AND cancelled_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'the replaced overlay could not be restored safely';
    END IF;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION cancel_management_comp_overlay(UUID, UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION cancel_management_comp_overlay(UUID, UUID, UUID, TEXT)
  TO service_role;

CREATE OR REPLACE FUNCTION end_management_comp_overlay(
  p_org_id UUID,
  p_assignment_id UUID,
  p_effective_to DATE,
  p_created_by_user_id UUID,
  p_change_reason TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::date;
BEGIN
  IF p_effective_to < v_today THEN
    RAISE EXCEPTION 'management overlay end date cannot be in the past';
  END IF;
  IF length(btrim(COALESCE(p_change_reason, ''))) = 0 THEN
    RAISE EXCEPTION 'end reason is required';
  END IF;
  PERFORM 1 FROM users
  WHERE id = p_created_by_user_id AND org_id = p_org_id
    AND role IN ('admin', 'owner', 'operations') AND active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'payroll administrator not found'; END IF;

  UPDATE user_management_comp_overlay_assignments
  SET effective_to = p_effective_to,
      ended_at = NOW(),
      ended_by_user_id = p_created_by_user_id,
      end_reason = p_change_reason
  WHERE id = p_assignment_id
    AND org_id = p_org_id
    AND effective_from <= p_effective_to
    AND effective_from <= v_today
    AND cancelled_at IS NULL
    AND ended_at IS NULL
    AND (effective_to IS NULL OR effective_to > p_effective_to);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'current management overlay assignment not found';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION end_management_comp_overlay(UUID, UUID, DATE, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION end_management_comp_overlay(UUID, UUID, DATE, UUID, TEXT)
  TO service_role;

CREATE OR REPLACE FUNCTION assign_primary_comp_plan(
  p_org_id UUID,
  p_user_id UUID,
  p_comp_plan_id UUID,
  p_effective_from DATE,
  p_override_percentage NUMERIC,
  p_created_by_user_id UUID,
  p_change_reason TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::date;
  v_assignment_id UUID;
  v_replaced_assignment_id UUID;
BEGIN
  IF p_effective_from <= v_today THEN
    RAISE EXCEPTION 'primary comp-plan changes must start after today';
  END IF;
  IF p_override_percentage IS NOT NULL
    AND (p_override_percentage < 0 OR p_override_percentage > 100) THEN
    RAISE EXCEPTION 'personal plan rate override must be between 0 and 100';
  END IF;
  IF length(btrim(COALESCE(p_change_reason, ''))) = 0 THEN
    RAISE EXCEPTION 'change reason is required';
  END IF;

  PERFORM 1 FROM users
  WHERE id = p_created_by_user_id
    AND org_id = p_org_id
    AND role IN ('admin', 'owner', 'operations')
    AND active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'payroll administrator not found'; END IF;

  PERFORM 1
  FROM users target
  JOIN comp_plans plan
    ON plan.id = p_comp_plan_id
   AND plan.org_id = p_org_id
  WHERE target.id = p_user_id
    AND target.org_id = p_org_id
    AND target.active = true
    AND plan.plan_purpose = 'primary'
    AND plan.is_active = true
    AND target.role = ANY(COALESCE(plan.applicable_roles, ARRAY[]::TEXT[]));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'active primary plan is not compatible with the recipient role';
  END IF;

  PERFORM 1 FROM user_comp_plans
  WHERE org_id = p_org_id
    AND user_id = p_user_id
    AND effective_from > v_today;
  IF FOUND THEN RAISE EXCEPTION 'a primary comp plan is already scheduled on or after this date'; END IF;

  UPDATE user_comp_plans
  SET effective_to = p_effective_from - 1
  WHERE org_id = p_org_id
    AND user_id = p_user_id
    AND effective_from < p_effective_from
    AND (effective_to IS NULL OR effective_to >= p_effective_from)
  RETURNING id INTO v_replaced_assignment_id;

  INSERT INTO user_comp_plans (
    org_id,
    user_id,
    comp_plan_id,
    replaced_assignment_id,
    effective_from,
    override_percentage,
    created_by_user_id,
    change_reason
  ) VALUES (
    p_org_id,
    p_user_id,
    p_comp_plan_id,
    v_replaced_assignment_id,
    p_effective_from,
    p_override_percentage,
    p_created_by_user_id,
    p_change_reason
  )
  RETURNING id INTO v_assignment_id;

  RETURN v_assignment_id;
END;
$$;

REVOKE ALL ON FUNCTION assign_primary_comp_plan(
  UUID, UUID, UUID, DATE, NUMERIC, UUID, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION assign_primary_comp_plan(
  UUID, UUID, UUID, DATE, NUMERIC, UUID, TEXT
) TO service_role;

CREATE OR REPLACE FUNCTION cancel_scheduled_primary_comp_plan(
  p_org_id UUID,
  p_assignment_id UUID,
  p_created_by_user_id UUID,
  p_change_reason TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::date;
  v_assignment user_comp_plans%ROWTYPE;
BEGIN
  IF length(btrim(COALESCE(p_change_reason, ''))) = 0 THEN
    RAISE EXCEPTION 'cancellation reason is required';
  END IF;
  PERFORM 1 FROM users
  WHERE id = p_created_by_user_id AND org_id = p_org_id
    AND role IN ('admin', 'owner', 'operations') AND active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'payroll administrator not found'; END IF;

  SELECT * INTO v_assignment
  FROM user_comp_plans
  WHERE id = p_assignment_id
    AND org_id = p_org_id
    AND effective_from > v_today
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'future primary comp-plan assignment not found'; END IF;

  INSERT INTO primary_comp_plan_assignment_cancellations (
    org_id, assignment_id, assignment_snapshot, cancelled_by_user_id, cancellation_reason
  ) VALUES (
    p_org_id, v_assignment.id, to_jsonb(v_assignment), p_created_by_user_id, p_change_reason
  );

  DELETE FROM user_comp_plans
  WHERE id = v_assignment.id AND org_id = p_org_id;

  UPDATE user_comp_plans
  SET effective_to = NULL
  WHERE org_id = p_org_id
    AND user_id = v_assignment.user_id
    AND id = v_assignment.replaced_assignment_id
    AND effective_to = v_assignment.effective_from - 1;
END;
$$;

REVOKE ALL ON FUNCTION cancel_scheduled_primary_comp_plan(UUID, UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION cancel_scheduled_primary_comp_plan(UUID, UUID, UUID, TEXT)
  TO service_role;

COMMENT ON TABLE management_comp_overlay_plan_versions IS
  'Append-only fixed-rate management overlay terms by comp plan, lane, and effective date. No row for a sale date means no derived manager override.';

COMMENT ON TABLE user_management_comp_overlay_assignments IS
  'Effective-dated management overlay assignments, separate from primary production comp-plan assignments. No historical row means no derived manager override.';

COMMENT ON COLUMN comp_plans.plan_purpose IS
  'primary plans pay a user''s own production; management_overlay plans supply a separately assigned fixed manager override.';

COMMENT ON COLUMN orgs.manager_override_commission_rate IS
  'Legacy manager override setting retained for compatibility. Payroll manager overrides now resolve from effective-dated management overlay plan versions.';

SELECT pg_notify('pgrst', 'reload schema');
