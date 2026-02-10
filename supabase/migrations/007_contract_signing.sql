-- Contract signing
CREATE TABLE IF NOT EXISTS contracts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  contract_pdf_path TEXT NOT NULL,
  token UUID NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'sent',
  signed_at TIMESTAMPTZ,
  signed_name TEXT,
  signed_email TEXT,
  signed_ip TEXT,
  signed_user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contracts_org_id ON contracts(org_id);
CREATE INDEX IF NOT EXISTS idx_contracts_job_id ON contracts(job_id);

ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read contracts in their org"
  ON contracts FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

CREATE POLICY "Users can insert contracts in their org"
  ON contracts FOR INSERT
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

CREATE POLICY "Users can update contracts in their org"
  ON contracts FOR UPDATE
  USING (org_id = get_user_org_id(auth.uid()));
