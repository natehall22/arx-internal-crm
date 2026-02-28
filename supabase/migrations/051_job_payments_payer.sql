-- Add payer and created_by columns to job_payments
-- Payments are append-only: no update policy

-- Add payer column
ALTER TABLE job_payments 
ADD COLUMN payer TEXT NOT NULL DEFAULT 'homeowner' 
CHECK (payer IN ('homeowner', 'insurance', 'financing', 'other'));

-- Add created_by column
ALTER TABLE job_payments 
ADD COLUMN created_by UUID REFERENCES users(id);

-- Remove the default after adding (so future inserts require explicit payer)
ALTER TABLE job_payments ALTER COLUMN payer DROP DEFAULT;

-- Drop any existing UPDATE policy (payments are append-only)
DROP POLICY IF EXISTS "Users can update job payments for their org" ON job_payments;
