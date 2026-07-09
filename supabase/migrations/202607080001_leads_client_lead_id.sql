-- Canvass offline-sync idempotency: client-generated UUID per queued knock.
-- Nullable/additive only — existing rows and old clients keep client_lead_id NULL.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS client_lead_id TEXT;

COMMENT ON COLUMN leads.client_lead_id IS
  'Client-generated UUID from canvass offline queue; dedupes retries within 24h per org/owner.';

CREATE INDEX IF NOT EXISTS idx_leads_client_lead_id_lookup
  ON leads (org_id, owner_user_id, client_lead_id)
  WHERE client_lead_id IS NOT NULL;
