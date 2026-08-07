-- Management compensation eligibility follows effective-dated reporting assignments,
-- not a user's CRM access role. The selected overlay lane remains independent so a
-- manager can receive setter and closer overrides as separate compensation overlays.
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

  PERFORM 1
  FROM users AS manager
  WHERE manager.id = p_user_id
    AND manager.org_id = p_org_id
    AND manager.active = true
    AND EXISTS (
      SELECT 1
      FROM user_manager_assignments AS reporting
      JOIN users AS report
        ON report.id = reporting.user_id
       AND report.org_id = reporting.org_id
       AND report.active = true
      WHERE reporting.org_id = p_org_id
        AND reporting.manager_user_id = manager.id
        AND reporting.effective_from <= p_effective_from
        AND (reporting.effective_to IS NULL OR reporting.effective_to >= p_effective_from)
    );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'overlay recipient has no direct reports on the effective date';
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
