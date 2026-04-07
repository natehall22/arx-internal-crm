-- Migration 099: Insurance job tracking fields on production_jobs
-- Enables two-track forecasting: retail vs insurance with stage-based probability weighting

-- Job source: retail (cash) vs insurance (claim-based)
ALTER TABLE production_jobs ADD COLUMN IF NOT EXISTS job_source TEXT NOT NULL DEFAULT 'retail'
  CHECK (job_source IN ('retail', 'insurance'));

-- Insurance claim progression stages
ALTER TABLE production_jobs ADD COLUMN IF NOT EXISTS insurance_stage TEXT
  CHECK (insurance_stage IN (
    'contingency_signed',
    'claim_filed',
    'claim_approved',
    'acv_received',
    'job_complete',
    'depreciation_filed',
    'depreciation_received',
    'supplements_filed',
    'fully_collected'
  ));

-- Insurance payment amounts (null = unknown/not applicable)
ALTER TABLE production_jobs ADD COLUMN IF NOT EXISTS acv_amount DECIMAL(12,2);
ALTER TABLE production_jobs ADD COLUMN IF NOT EXISTS depreciation_amount DECIMAL(12,2);
ALTER TABLE production_jobs ADD COLUMN IF NOT EXISTS supplement_amount DECIMAL(12,2);

-- Insurance company claim reference
ALTER TABLE production_jobs ADD COLUMN IF NOT EXISTS claim_number TEXT;

-- Insurance company name
ALTER TABLE production_jobs ADD COLUMN IF NOT EXISTS insurance_company TEXT;

COMMENT ON COLUMN production_jobs.job_source IS 'retail = cash/direct sale; insurance = insurance claim job';
COMMENT ON COLUMN production_jobs.insurance_stage IS 'Current stage in the insurance claim lifecycle';
COMMENT ON COLUMN production_jobs.acv_amount IS 'Actual Cash Value — first insurance payment';
COMMENT ON COLUMN production_jobs.depreciation_amount IS 'Recoverable depreciation — second payment after job completion';
COMMENT ON COLUMN production_jobs.supplement_amount IS 'Approved supplements — additional payment for extra work found';
