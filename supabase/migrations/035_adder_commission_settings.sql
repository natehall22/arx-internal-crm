-- Migration: 035_adder_commission_settings.sql
-- Add commission percentage and cap settings for adders
-- This allows admins to configure how much of an adder is commissionable

-- Add commission_percent column - what percentage of the adder is commissionable
-- Example: 50 means rep gets commission on 50% of the adder value
-- NULL means flows through regular comp plan, a value means custom commission (doesn't flow through comp plan)
ALTER TABLE pricebook_items ADD COLUMN IF NOT EXISTS commission_percent NUMERIC(5, 2);

-- Add commission_cap column - maximum amount that's commissionable per instance
-- Example: 2000 means max $2000 of the adder counts toward commission
ALTER TABLE pricebook_items ADD COLUMN IF NOT EXISTS commission_cap NUMERIC(10, 2);

-- Add cost breakdown columns for profit margin calculation
ALTER TABLE pricebook_items ADD COLUMN IF NOT EXISTS material_cost NUMERIC(10, 2);
ALTER TABLE pricebook_items ADD COLUMN IF NOT EXISTS labor_cost NUMERIC(10, 2);
ALTER TABLE pricebook_items ADD COLUMN IF NOT EXISTS profit_margin_percent NUMERIC(6, 2);

-- Comments for documentation
COMMENT ON COLUMN pricebook_items.commission_percent IS 'Percentage of the adder value that is commissionable (0-100). NULL means flows through regular comp plan.';
COMMENT ON COLUMN pricebook_items.commission_cap IS 'Maximum dollar amount of this adder that counts toward commission per instance. NULL means no cap.';
COMMENT ON COLUMN pricebook_items.material_cost IS 'Material cost per unit for margin calculation';
COMMENT ON COLUMN pricebook_items.labor_cost IS 'Labor cost per unit for margin calculation';
COMMENT ON COLUMN pricebook_items.profit_margin_percent IS 'Profit markup percentage (0-1000%) added to costs to calculate selling price';

-- Example scenarios:
-- 1. Premier Pricing adder: Rep can add up to $2000 and gets 50% commission
--    is_commissionable = true, commission_percent = 50, commission_cap = 2000
--    If rep adds $3000: commissionable amount = min($3000, $2000) * 50% = $1000
--
-- 2. Standard upgrade adder: Fully commissionable, no cap
--    is_commissionable = true, commission_percent = 100, commission_cap = NULL
--    If rep adds $500: commissionable amount = $500 * 100% = $500
--
-- 3. Dumpster fee: Not commissionable at all
--    is_commissionable = false, commission_percent = NULL, commission_cap = NULL
--    Commissionable amount = $0
