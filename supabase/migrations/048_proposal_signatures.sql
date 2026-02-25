-- Add signature fields to proposals table
ALTER TABLE proposals
  ADD COLUMN IF NOT EXISTS customer_signature_type TEXT,
  ADD COLUMN IF NOT EXISTS customer_signature_data TEXT,
  ADD COLUMN IF NOT EXISTS customer_signature_typed TEXT,
  ADD COLUMN IF NOT EXISTS customer_signed_name TEXT,
  ADD COLUMN IF NOT EXISTS customer_signed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rep_signature_type TEXT,
  ADD COLUMN IF NOT EXISTS rep_signature_data TEXT,
  ADD COLUMN IF NOT EXISTS rep_signature_typed TEXT,
  ADD COLUMN IF NOT EXISTS rep_signed_name TEXT,
  ADD COLUMN IF NOT EXISTS rep_signed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS declined_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS declined_reason TEXT;

-- Create index for signed proposals
CREATE INDEX IF NOT EXISTS idx_proposals_customer_signed ON proposals(customer_signed_at) WHERE customer_signed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_proposals_rep_signed ON proposals(rep_signed_at) WHERE rep_signed_at IS NOT NULL;
