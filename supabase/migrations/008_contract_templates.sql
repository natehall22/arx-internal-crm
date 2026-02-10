-- Contract templates
CREATE TABLE IF NOT EXISTS contract_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contract_templates_org_id ON contract_templates(org_id);

ALTER TABLE contract_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read contract templates in their org"
  ON contract_templates FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

CREATE POLICY "Managers can insert contract templates in their org"
  ON contract_templates FOR INSERT
  WITH CHECK (org_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

CREATE POLICY "Managers can update contract templates in their org"
  ON contract_templates FOR UPDATE
  USING (org_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));
