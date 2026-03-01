-- Add PDF storage path to invoices
ALTER TABLE job_invoices 
ADD COLUMN IF NOT EXISTS pdf_path TEXT;

COMMENT ON COLUMN job_invoices.pdf_path IS 'Storage path for generated invoice PDF';
