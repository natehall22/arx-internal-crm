-- Capture retail vs insurance before the job exists so sales conversion is not survivor-biased.

ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS job_source TEXT NOT NULL DEFAULT 'retail'
  CHECK (job_source IN ('retail', 'insurance'));

ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS insurance_stage TEXT
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

CREATE INDEX IF NOT EXISTS idx_opportunities_job_source ON opportunities(org_id, job_source, status);
CREATE INDEX IF NOT EXISTS idx_opportunities_insurance_stage ON opportunities(org_id, insurance_stage)
  WHERE job_source = 'insurance';

COMMENT ON COLUMN opportunities.job_source IS 'retail vs insurance captured before production job exists';
COMMENT ON COLUMN opportunities.insurance_stage IS 'Insurance claim lifecycle stage while still in sales pipeline';

UPDATE opportunities
SET job_source = 'insurance',
    insurance_stage = COALESCE(insurance_stage, 'contingency_signed')
WHERE lower(replace(COALESCE(inspection_outcome, ''), '-', '_')) = 'insurance_follow_up';

UPDATE opportunities o
SET job_source = 'insurance',
    insurance_stage = COALESCE(o.insurance_stage, pj.insurance_stage, 'contingency_signed')
FROM projects p
JOIN production_jobs pj ON pj.project_id = p.id
WHERE p.opportunity_id = o.id
  AND pj.job_source = 'insurance';
