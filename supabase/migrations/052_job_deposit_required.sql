-- Add deposit_required_percent to production_jobs
-- Default 50% (0.5) deposit required before work begins

ALTER TABLE production_jobs 
ADD COLUMN IF NOT EXISTS deposit_required_percent NUMERIC(3,2) DEFAULT 0.50;

COMMENT ON COLUMN production_jobs.deposit_required_percent IS 'Percentage of sale_amount required as deposit (0.50 = 50%)';
