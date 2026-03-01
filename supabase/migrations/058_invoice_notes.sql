-- Add public_note and internal_note fields to job_invoices
-- public_note: Appears on customer-facing PDF (terms, payment info)
-- internal_note: Staff-only, never appears on PDF

ALTER TABLE job_invoices
ADD COLUMN IF NOT EXISTS public_note TEXT,
ADD COLUMN IF NOT EXISTS internal_note TEXT;

-- Add comments for documentation
COMMENT ON COLUMN job_invoices.public_note IS 'Customer-facing note/terms that appears on the printed invoice PDF';
COMMENT ON COLUMN job_invoices.internal_note IS 'Internal staff note - never shown on customer-facing documents';
