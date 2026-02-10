-- Add volume_bonuses and manager compensation columns to comp_plans table
-- Migration: 025_comp_plan_volume_bonuses.sql

-- Add the volume_bonuses JSONB column if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'comp_plans' AND column_name = 'volume_bonuses'
  ) THEN
    ALTER TABLE comp_plans ADD COLUMN volume_bonuses JSONB;
    COMMENT ON COLUMN comp_plans.volume_bonuses IS 'Sliding scale volume bonuses. Array of: {min_volume: number, max_volume: number|null, bonus_type: "percentage"|"flat", bonus_value: number}';
  END IF;
  
  -- Manager-specific columns
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'comp_plans' AND column_name = 'is_manager_plan'
  ) THEN
    ALTER TABLE comp_plans ADD COLUMN is_manager_plan BOOLEAN DEFAULT false;
    COMMENT ON COLUMN comp_plans.is_manager_plan IS 'Whether this is a manager compensation plan with team overrides';
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'comp_plans' AND column_name = 'personal_sales_enabled'
  ) THEN
    ALTER TABLE comp_plans ADD COLUMN personal_sales_enabled BOOLEAN DEFAULT true;
    COMMENT ON COLUMN comp_plans.personal_sales_enabled IS 'Manager can earn commission on their own sales';
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'comp_plans' AND column_name = 'team_override_enabled'
  ) THEN
    ALTER TABLE comp_plans ADD COLUMN team_override_enabled BOOLEAN DEFAULT false;
    COMMENT ON COLUMN comp_plans.team_override_enabled IS 'Manager earns override on team sales';
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'comp_plans' AND column_name = 'team_overrides'
  ) THEN
    ALTER TABLE comp_plans ADD COLUMN team_overrides JSONB;
    COMMENT ON COLUMN comp_plans.team_overrides IS 'Sliding scale team overrides. Array of: {min_team_volume: number, max_team_volume: number|null, override_type: "percentage"|"flat", override_value: number}';
  END IF;
END $$;

-- Example volume_bonuses structure:
-- [
--   {"min_volume": 0, "max_volume": 50000, "bonus_type": "percentage", "bonus_value": 0},
--   {"min_volume": 50001, "max_volume": 100000, "bonus_type": "percentage", "bonus_value": 1},
--   {"min_volume": 100001, "max_volume": 200000, "bonus_type": "percentage", "bonus_value": 2},
--   {"min_volume": 200001, "max_volume": null, "bonus_type": "percentage", "bonus_value": 3}
-- ]
--
-- Or with flat dollar bonuses:
-- [
--   {"min_volume": 0, "max_volume": 50000, "bonus_type": "flat", "bonus_value": 0},
--   {"min_volume": 50001, "max_volume": 100000, "bonus_type": "flat", "bonus_value": 500},
--   {"min_volume": 100001, "max_volume": null, "bonus_type": "flat", "bonus_value": 1500}
-- ]

-- Update the calculate_commission function to include volume bonuses
CREATE OR REPLACE FUNCTION calculate_commission_with_volume(
  p_user_id UUID,
  p_sale_amount NUMERIC,
  p_period_volume NUMERIC DEFAULT 0,  -- Total volume for the period (for volume bonus calculation)
  p_sale_date DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  comp_plan_id UUID,
  base_rate NUMERIC,
  volume_bonus_rate NUMERIC,
  volume_bonus_flat NUMERIC,
  effective_rate NUMERIC,
  commission_amount NUMERIC,
  bonus_amount NUMERIC,
  total_amount NUMERIC
) AS $$
DECLARE
  v_plan RECORD;
  v_base_rate NUMERIC;
  v_commission NUMERIC;
  v_volume_bonus_rate NUMERIC := 0;
  v_volume_bonus_flat NUMERIC := 0;
  v_effective_rate NUMERIC;
  v_bonus NUMERIC := 0;
  v_volume_tier RECORD;
BEGIN
  -- Get user's active comp plan
  SELECT cp.* INTO v_plan
  FROM user_comp_plans ucp
  JOIN comp_plans cp ON cp.id = ucp.comp_plan_id
  WHERE ucp.user_id = p_user_id
    AND ucp.effective_from <= p_sale_date
    AND (ucp.effective_to IS NULL OR ucp.effective_to >= p_sale_date)
    AND cp.is_active = true
  ORDER BY ucp.effective_from DESC
  LIMIT 1;
  
  IF v_plan IS NULL THEN
    -- Fall back to default plan
    SELECT * INTO v_plan
    FROM comp_plans
    WHERE org_id = (SELECT org_id FROM users WHERE id = p_user_id)
      AND is_default = true
      AND is_active = true
    LIMIT 1;
  END IF;
  
  IF v_plan IS NULL THEN
    RETURN;
  END IF;
  
  -- Calculate base rate based on plan type
  CASE v_plan.plan_type
    WHEN 'flat_rate' THEN
      v_base_rate := 0;
      v_commission := COALESCE(v_plan.flat_amount, 0);
    WHEN 'percentage' THEN
      v_base_rate := COALESCE(v_plan.base_percentage, 0);
    WHEN 'tiered' THEN
      -- Find applicable tier based on sale amount
      SELECT (tier->>'rate')::NUMERIC INTO v_base_rate
      FROM jsonb_array_elements(v_plan.tiers) AS tier
      WHERE (tier->>'min')::NUMERIC <= p_sale_amount
        AND ((tier->>'max')::NUMERIC >= p_sale_amount OR tier->>'max' IS NULL)
      LIMIT 1;
      v_base_rate := COALESCE(v_base_rate, v_plan.base_percentage, 0);
    ELSE
      v_base_rate := COALESCE(v_plan.base_percentage, 0);
  END CASE;
  
  -- Calculate volume bonus if applicable
  IF v_plan.volume_bonuses IS NOT NULL AND p_period_volume > 0 THEN
    SELECT 
      CASE WHEN (vb->>'bonus_type') = 'percentage' THEN (vb->>'bonus_value')::NUMERIC ELSE 0 END,
      CASE WHEN (vb->>'bonus_type') = 'flat' THEN (vb->>'bonus_value')::NUMERIC ELSE 0 END
    INTO v_volume_bonus_rate, v_volume_bonus_flat
    FROM jsonb_array_elements(v_plan.volume_bonuses) AS vb
    WHERE (vb->>'min_volume')::NUMERIC <= p_period_volume
      AND ((vb->>'max_volume')::NUMERIC >= p_period_volume OR vb->>'max_volume' IS NULL)
    LIMIT 1;
  END IF;
  
  v_volume_bonus_rate := COALESCE(v_volume_bonus_rate, 0);
  v_volume_bonus_flat := COALESCE(v_volume_bonus_flat, 0);
  
  -- Calculate effective rate and commission
  v_effective_rate := v_base_rate + v_volume_bonus_rate;
  
  IF v_plan.plan_type = 'flat_rate' THEN
    v_commission := COALESCE(v_plan.flat_amount, 0) + v_volume_bonus_flat;
  ELSE
    v_commission := p_sale_amount * (v_effective_rate / 100) + v_volume_bonus_flat;
  END IF;
  
  RETURN QUERY SELECT 
    v_plan.id,
    v_base_rate,
    v_volume_bonus_rate,
    v_volume_bonus_flat,
    v_effective_rate,
    v_commission,
    v_bonus,
    v_commission + v_bonus;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
