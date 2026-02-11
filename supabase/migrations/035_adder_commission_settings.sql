-- Migration: 035_adder_commission_settings.sql
-- Add commission percentage and cap settings for adders
-- This allows admins to configure how much of an adder is commissionable

-- Add commission_percent column - what percentage of the adder is commissionable
-- Example: 50 means rep gets commission on 50% of the adder value
ALTER TABLE pricebook_items ADD COLUMN IF NOT EXISTS commission_percent NUMERIC(5, 2) DEFAULT 100;

-- Add commission_cap column - maximum amount that's commissionable per instance
-- Example: 2000 means max $2000 of the adder counts toward commission
ALTER TABLE pricebook_items ADD COLUMN IF NOT EXISTS commission_cap NUMERIC(10, 2);

-- Comments for documentation
COMMENT ON COLUMN pricebook_items.commission_percent IS 'Percentage of the adder value that is commissionable (0-100). Default 100% if commissionable.';
COMMENT ON COLUMN pricebook_items.commission_cap IS 'Maximum dollar amount of this adder that counts toward commission per instance. NULL means no cap.';

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
