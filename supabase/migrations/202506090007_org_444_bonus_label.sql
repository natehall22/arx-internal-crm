-- Add org-configurable 444 program week bonus label (display string).
-- Can be any reward description: "$400", "ARX hoodie", "team dinner", etc.
-- Also make bonus amount nullable (NULL = non-monetary; 0 payroll line written).
ALTER TABLE orgs
  ADD COLUMN IF NOT EXISTS program_444_week_bonus_label TEXT NOT NULL DEFAULT '$400';

ALTER TABLE orgs
  ALTER COLUMN program_444_week_bonus_amount DROP NOT NULL;
