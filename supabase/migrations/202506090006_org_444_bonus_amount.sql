-- Add org-configurable 444 program week bonus amount.
-- Numeric so it can be used directly in payroll_bonus_lines.amount.
-- NOT NULL DEFAULT 400 preserves existing behaviour for all orgs.
ALTER TABLE orgs
  ADD COLUMN IF NOT EXISTS program_444_week_bonus_amount NUMERIC(10,2) NOT NULL DEFAULT 400;
