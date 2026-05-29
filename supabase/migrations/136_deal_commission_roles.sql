-- Explicit per-deal commission role assignments (setter, closer, managers, custom).

CREATE TABLE IF NOT EXISTS deal_commission_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES production_jobs(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (
    role IN ('setter', 'closer', 'field_manager', 'senior_manager', 'custom')
  ),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  override_amount NUMERIC(14, 2),
  override_percent NUMERIC(5, 2),
  premier_pricing_amount NUMERIC(14, 2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (job_id, role, user_id)
);

CREATE INDEX IF NOT EXISTS idx_deal_commission_roles_job ON deal_commission_roles(job_id);
CREATE INDEX IF NOT EXISTS idx_deal_commission_roles_user ON deal_commission_roles(org_id, user_id);

COMMENT ON TABLE deal_commission_roles IS 'Per-job commission participants beyond legacy sales_rep/setter/owner; backfilled from collectParticipants() at period lock when missing.';

CREATE TRIGGER update_deal_commission_roles_updated_at
  BEFORE UPDATE ON deal_commission_roles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE deal_commission_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deal_commission_roles_org_select" ON deal_commission_roles
  FOR SELECT USING (org_id = get_user_org_id(auth.uid()));
