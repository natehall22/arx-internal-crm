-- Pricing Admin Enhancements
-- Migration: 027_pricing_admin.sql

-- Add cost_price column to pricebook_items for margin tracking
ALTER TABLE pricebook_items ADD COLUMN IF NOT EXISTS cost_price NUMERIC(10, 2);

-- Add price_type column for percentage-based adders
-- 'fixed' = standard dollar amount, 'percentage' = % of total price
ALTER TABLE pricebook_items ADD COLUMN IF NOT EXISTS price_type TEXT DEFAULT 'fixed';

-- Add is_commissionable column - adders are non-commissionable by default
-- Only include in commission calculations if admin explicitly enables
ALTER TABLE pricebook_items ADD COLUMN IF NOT EXISTS is_commissionable BOOLEAN DEFAULT false;

-- Add settings JSONB to orgs for storing org-wide pricing settings
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{}';

-- Comment for documentation
COMMENT ON COLUMN pricebook_items.cost_price IS 'Cost/wholesale price for margin calculation';
COMMENT ON COLUMN pricebook_items.price_type IS 'fixed = dollar amount, percentage = % of total price';
COMMENT ON COLUMN pricebook_items.is_commissionable IS 'Whether this item counts toward commission calculations';
COMMENT ON COLUMN orgs.settings IS 'Organization settings including pricing configuration';

-- Example settings structure:
-- {
--   "pricing": {
--     "price_per_square_installed": 350.00,
--     "price_per_watt": 3.50,
--     "dump_cost_per_square": 25.00,
--     "opex_per_job": 500.00,
--     "default_tax_rate": 8.25,
--     "default_markup_percent": 35,
--     "labor_rate_per_hour": 75.00
--   },
--   "commission": {
--     "commission_period": "monthly",  -- "weekly", "bi-weekly", "monthly"
--     "week_start_day": 0,  -- 0=Sunday, 1=Monday, etc.
--     "bi_weekly_start_date": "2024-01-01"  -- Reference date for bi-weekly periods
--   }
-- }

-- Create index on pricebook_items for common queries
CREATE INDEX IF NOT EXISTS idx_pricebook_items_category_active 
  ON pricebook_items(pricebook_id, category, active);

-- Update RLS policy to allow admins to update org settings
-- (orgs table should already have appropriate policies)

-- Add commissionable_amount column to commissions table (if table exists)
-- This tracks the portion of the sale that commissions are calculated on
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'commissions') THEN
    ALTER TABLE commissions ADD COLUMN IF NOT EXISTS commissionable_amount NUMERIC(12, 2);
    COMMENT ON COLUMN commissions.commissionable_amount IS 'The portion of sale_amount that is commissionable (excludes non-commissionable adders)';
  END IF;
END $$;

-- Update the calculate_commission_with_volume function to accept commissionable amount
CREATE OR REPLACE FUNCTION calculate_commission_with_volume(
  p_user_id UUID,
  p_sale_amount NUMERIC,
  p_commissionable_amount NUMERIC DEFAULT NULL,  -- If NULL, uses p_sale_amount
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
  total_amount NUMERIC,
  commissionable_amount NUMERIC
) AS $$
DECLARE
  v_plan RECORD;
  v_base_rate NUMERIC;
  v_commission NUMERIC;
  v_volume_bonus_rate NUMERIC := 0;
  v_volume_bonus_flat NUMERIC := 0;
  v_effective_rate NUMERIC;
  v_bonus NUMERIC := 0;
  v_commissionable NUMERIC;
BEGIN
  -- Use commissionable amount if provided, otherwise use full sale amount
  v_commissionable := COALESCE(p_commissionable_amount, p_sale_amount);

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
  
  -- Calculate base rate based on plan type using COMMISSIONABLE amount
  CASE v_plan.plan_type
    WHEN 'flat_rate' THEN
      v_base_rate := 0;
      v_commission := COALESCE(v_plan.flat_amount, 0);
    WHEN 'percentage' THEN
      v_base_rate := COALESCE(v_plan.base_percentage, 0);
    WHEN 'tiered' THEN
      -- Find applicable tier based on commissionable amount
      SELECT (tier->>'rate')::NUMERIC INTO v_base_rate
      FROM jsonb_array_elements(v_plan.tiers) AS tier
      WHERE (tier->>'min')::NUMERIC <= v_commissionable
        AND ((tier->>'max')::NUMERIC >= v_commissionable OR tier->>'max' IS NULL)
      LIMIT 1;
      v_base_rate := COALESCE(v_base_rate, v_plan.base_percentage, 0);
    ELSE
      v_base_rate := COALESCE(v_plan.base_percentage, 0);
  END CASE;
  
  -- Calculate volume bonus if applicable (based on period volume)
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
  
  -- Calculate effective rate and commission on COMMISSIONABLE amount
  v_effective_rate := v_base_rate + v_volume_bonus_rate;
  
  IF v_plan.plan_type = 'flat_rate' THEN
    v_commission := COALESCE(v_plan.flat_amount, 0) + v_volume_bonus_flat;
  ELSE
    v_commission := v_commissionable * (v_effective_rate / 100) + v_volume_bonus_flat;
  END IF;
  
  RETURN QUERY SELECT 
    v_plan.id,
    v_base_rate,
    v_volume_bonus_rate,
    v_volume_bonus_flat,
    v_effective_rate,
    v_commission,
    v_bonus,
    v_commission + v_bonus,
    v_commissionable;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
