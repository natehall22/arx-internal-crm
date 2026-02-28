-- Allow closing jobs with remaining balance (soft safeguard)

ALTER TABLE production_jobs 
ADD COLUMN IF NOT EXISTS allow_close_with_balance BOOLEAN DEFAULT FALSE;

ALTER TABLE production_jobs 
ADD COLUMN IF NOT EXISTS close_balance_reason TEXT;
