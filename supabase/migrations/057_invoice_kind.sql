-- Add invoice_kind to support deposit, final, and standard invoices
ALTER TABLE job_invoices 
ADD COLUMN IF NOT EXISTS invoice_kind TEXT DEFAULT 'standard';

-- Add check constraint for valid invoice kinds
DO $$ BEGIN
  ALTER TABLE job_invoices 
  ADD CONSTRAINT job_invoices_kind_check 
  CHECK (invoice_kind IN ('deposit', 'final', 'standard'));
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Create index for querying active invoices by kind
CREATE INDEX IF NOT EXISTS idx_job_invoices_job_kind 
ON job_invoices(job_id, invoice_kind) 
WHERE status != 'void';

-- Comment for documentation
COMMENT ON COLUMN job_invoices.invoice_kind IS 'Type of invoice: deposit (50% upfront), final (remaining balance), standard (full contract)';
