-- Org-level rate for the inspection commission line (the published ladder pays 1.5%
-- of the job commission base to whoever personally inspected the roof).
--
-- Defaults to 0 = OFF on purpose. Payroll is live and in daily use; a non-zero
-- default would silently start paying an inspection line on the next period lock
-- for every job that has an inspection appointment. Set this to 1.50 deliberately
-- when the comp plan goes into effect.
--
-- Per-job overrides still win: an explicit deal_commission_roles row with
-- role='inspector' takes precedence over this rate for that job.

ALTER TABLE orgs
  ADD COLUMN IF NOT EXISTS inspection_commission_rate NUMERIC(5, 2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN orgs.inspection_commission_rate IS
  'Percent of a job''s commission base paid to the rep who inspected it, applied '
  'when no explicit deal_commission_roles inspector row exists for that job. '
  '0 disables the derived inspection line entirely. Counts inside the sales '
  'commission pool cap.';

SELECT pg_notify('pgrst', 'reload schema');
