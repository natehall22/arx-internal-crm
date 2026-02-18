-- Add unit-based and hybrid compensation fields to comp_plans
ALTER TABLE comp_plans ADD COLUMN IF NOT EXISTS unit_rate DECIMAL(10,2);
ALTER TABLE comp_plans ADD COLUMN IF NOT EXISTS unit_type VARCHAR(50);
ALTER TABLE comp_plans ADD COLUMN IF NOT EXISTS hybrid_components JSONB;

-- Add comments for documentation
COMMENT ON COLUMN comp_plans.unit_rate IS 'Rate per unit for unit-based compensation (per square, per kW, etc.)';
COMMENT ON COLUMN comp_plans.unit_type IS 'Type of unit for unit-based plans: square, kw, linear_foot, panel, window, or custom label';
COMMENT ON COLUMN comp_plans.hybrid_components IS 'Array of compensation components for hybrid plans: [{type, rate, unit_type?, description?}]';

-- Update plan_type check constraint to include new types
ALTER TABLE comp_plans DROP CONSTRAINT IF EXISTS comp_plans_plan_type_check;
ALTER TABLE comp_plans ADD CONSTRAINT comp_plans_plan_type_check 
  CHECK (plan_type IN ('flat_rate', 'percentage', 'tiered', 'hybrid', 'hourly', 'unit_based'));
