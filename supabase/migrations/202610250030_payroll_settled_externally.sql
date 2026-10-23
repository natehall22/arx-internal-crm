-- Jobs paid outside the CRM before the payroll cutover: never paid again by the CRM, never flagged by Needs you.
-- Additive/nullable. Still counted in sales and profit reports (only payroll + Needs you look at this).
ALTER TABLE production_jobs ADD COLUMN IF NOT EXISTS payroll_settled_externally_at TIMESTAMPTZ;
ALTER TABLE production_jobs ADD COLUMN IF NOT EXISTS settled_externally_reason TEXT;
CREATE INDEX IF NOT EXISTS idx_production_jobs_settled_externally ON production_jobs(org_id) WHERE payroll_settled_externally_at IS NOT NULL;
COMMENT ON COLUMN production_jobs.payroll_settled_externally_at IS 'Set when this job''s commission was settled outside the CRM (before cutover). Excluded from payroll eligibility and Needs you; still counted in sales/profit reports. Clear it to bring the job back into CRM payroll.';
-- Rollback: ALTER TABLE production_jobs DROP COLUMN payroll_settled_externally_at, DROP COLUMN settled_externally_reason;
