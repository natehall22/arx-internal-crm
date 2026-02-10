-- Contract email + audit trail
ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS signed_location_text TEXT,
  ADD COLUMN IF NOT EXISTS audit_pdf_path TEXT,
  ADD COLUMN IF NOT EXISTS sent_to_email TEXT,
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS contract_payload JSONB;
