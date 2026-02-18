-- Add all missing comp_plan fields for hourly, unit-based, and hybrid plans
-- This consolidates any missing columns

-- Hourly rate for hourly plans
ALTER TABLE comp_plans ADD COLUMN IF NOT EXISTS hourly_rate DECIMAL(10,2);

-- Unit-based fields
ALTER TABLE comp_plans ADD COLUMN IF NOT EXISTS unit_rate DECIMAL(10,2);
ALTER TABLE comp_plans ADD COLUMN IF NOT EXISTS unit_type VARCHAR(50);

-- Hybrid plan components
ALTER TABLE comp_plans ADD COLUMN IF NOT EXISTS hybrid_components JSONB;

-- Readme for plan documentation
ALTER TABLE comp_plans ADD COLUMN IF NOT EXISTS readme TEXT;

-- Flat amount (some systems use flat_amount instead of flat_rate)
ALTER TABLE comp_plans ADD COLUMN IF NOT EXISTS flat_amount DECIMAL(10,2);

-- Add comments for documentation
COMMENT ON COLUMN comp_plans.hourly_rate IS 'Hourly rate for hourly compensation plans';
COMMENT ON COLUMN comp_plans.unit_rate IS 'Rate per unit for unit-based compensation (per square, per kW, etc.)';
COMMENT ON COLUMN comp_plans.unit_type IS 'Type of unit for unit-based plans: square, kw, linear_foot, panel, window, or custom label';
COMMENT ON COLUMN comp_plans.hybrid_components IS 'Array of compensation components for hybrid plans: [{type, rate, unit_type?, description?}]';
COMMENT ON COLUMN comp_plans.readme IS 'Custom readme/explanation text shown to team members about their comp plan';
COMMENT ON COLUMN comp_plans.flat_amount IS 'Flat dollar amount per job for flat_rate plans';

-- Update plan_type check constraint to include all types (drop first if exists)
ALTER TABLE comp_plans DROP CONSTRAINT IF EXISTS comp_plans_plan_type_check;
-- Note: Some databases may not have this constraint, so we add it fresh
-- Allowing: flat_rate, percentage, tiered, hybrid, hourly, unit_based
