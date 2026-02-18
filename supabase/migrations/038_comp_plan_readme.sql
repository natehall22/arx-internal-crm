-- Add readme column to comp_plans for custom plan explanations
ALTER TABLE comp_plans ADD COLUMN IF NOT EXISTS readme TEXT;

COMMENT ON COLUMN comp_plans.readme IS 'Custom readme/explanation text shown to team members about their comp plan';
