-- Contract signatures (rep + customer)
CREATE TABLE IF NOT EXISTS contract_signatures (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('rep', 'customer')),
  signed_name TEXT,
  signed_title TEXT,
  signed_email TEXT,
  signature_type TEXT,
  signature_data TEXT,
  signed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  signed_ip TEXT,
  signed_user_agent TEXT,
  signed_location_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contract_signatures_contract_id ON contract_signatures(contract_id);
CREATE INDEX IF NOT EXISTS idx_contract_signatures_org_id ON contract_signatures(org_id);
CREATE INDEX IF NOT EXISTS idx_contract_signatures_role ON contract_signatures(role);

ALTER TABLE contract_signatures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read contract signatures in their org"
  ON contract_signatures FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

CREATE POLICY "Users can insert contract signatures in their org"
  ON contract_signatures FOR INSERT
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

CREATE POLICY "Users can update contract signatures in their org"
  ON contract_signatures FOR UPDATE
  USING (org_id = get_user_org_id(auth.uid()));

ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS rep_signed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS customer_signed_at TIMESTAMPTZ;
