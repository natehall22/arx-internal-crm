-- Prevent duplicate inbound leads from concurrent public-estimate unlocks (same jti).
-- Additive: partial unique index allows many NULL external_lead_id rows per org.
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_org_external_lead_id_unique
  ON leads (org_id, external_lead_id)
  WHERE external_lead_id IS NOT NULL;
