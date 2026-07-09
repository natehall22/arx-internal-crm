-- Enforce client_lead_id uniqueness at the DB layer as defense-in-depth against a true
-- simultaneous double-insert slipping past the app-layer dedupe check in
-- app/api/canvass/lead/route.ts (that check is query-then-insert, so it has a narrow
-- TOCTOU race window on its own). Same shape as the index it replaces, now unique.

DROP INDEX IF EXISTS idx_leads_client_lead_id_lookup;

CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_client_lead_id_unique
  ON leads (org_id, owner_user_id, client_lead_id)
  WHERE client_lead_id IS NOT NULL;
