-- ABC Supply ordering connector (Individual Business track). Additive only. Everything defaults to OFF:
-- nothing here lets an order leave the CRM until an owner flips the org switch AND the supplier switch,
-- and the SUPPLIER_API_ORDERING env switch is on. Written/read only through the app (service role).
--
--  supplier_api_settings   one row per API-connected supplier: sandbox/production, on/off, ship-to + branch
--  supplier_item_map       CRM order line -> the supplier's item number + unit (+ optional estimated price)
--  supplier_api_approvals  second-approver requests for orders at/over the org threshold
--  supplier_api_events     append-only audit log of every API action (credentials never stored)

CREATE TABLE IF NOT EXISTS supplier_api_settings (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  vendor_id      UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  provider       TEXT NOT NULL DEFAULT 'abc_supply' CHECK (provider IN ('abc_supply')),
  environment    TEXT NOT NULL DEFAULT 'sandbox' CHECK (environment IN ('sandbox', 'production')),
  ordering_enabled BOOLEAN NOT NULL DEFAULT FALSE,   -- per-supplier kill switch
  ship_to_number TEXT,                               -- ABC "Ship-To" account number orders are placed against
  branch_number  TEXT,                               -- ABC branch that fills the order
  delivery_service TEXT NOT NULL DEFAULT 'OTR' CHECK (delivery_service IN ('COM','CPU','EXP','OTR','OTG','OTW','TPC')),
  updated_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (vendor_id)
);

CREATE TABLE IF NOT EXISTS supplier_item_map (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  vendor_id      UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  line_key       TEXT NOT NULL,                      -- same key as job_material_order_overrides.item_key
  item_number    TEXT NOT NULL,                      -- the supplier's item number
  uom            TEXT NOT NULL,                      -- the supplier's unit code, e.g. BD, RL, EA
  qty_unit_word  TEXT NOT NULL,                      -- the word after the number in the CRM quantity, e.g. "bundles"
  est_unit_price_cents INTEGER CHECK (est_unit_price_cents IS NULL OR est_unit_price_cents >= 0), -- typed in by us; used ONLY for the second-approver threshold
  updated_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (vendor_id, line_key)
);
CREATE INDEX IF NOT EXISTS idx_supplier_item_map_org ON supplier_item_map(org_id);

ALTER TABLE orgs ADD COLUMN IF NOT EXISTS supplier_api_ordering_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS supplier_api_second_approval_cents INTEGER NOT NULL DEFAULT 1000000;
COMMENT ON COLUMN orgs.supplier_api_ordering_enabled IS 'Org kill switch for ordering through a supplier API. Default off.';
COMMENT ON COLUMN orgs.supplier_api_second_approval_cents IS 'API orders at/over this estimated total (cents), or with an unknown total, need a second person to approve.';

CREATE TABLE IF NOT EXISTS supplier_api_approvals (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  vendor_id        UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  job_id           UUID NOT NULL REFERENCES production_jobs(id) ON DELETE CASCADE,
  supplier_order_id UUID NOT NULL REFERENCES supplier_orders(id) ON DELETE CASCADE,
  content_hash     TEXT NOT NULL,                    -- exactly what was reviewed (lines + delivery date/address)
  estimated_total_cents INTEGER,                     -- NULL = some line has no estimated price
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','used')),
  requested_by     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requested_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_at       TIMESTAMPTZ,
  used_at          TIMESTAMPTZ,
  CHECK (decided_by IS NULL OR decided_by <> requested_by)   -- nobody approves their own order
);
CREATE INDEX IF NOT EXISTS idx_supplier_api_approvals_order ON supplier_api_approvals(supplier_order_id, content_hash);
CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_api_approvals_open
  ON supplier_api_approvals(supplier_order_id, content_hash) WHERE status IN ('pending','approved');

CREATE TABLE IF NOT EXISTS supplier_api_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  vendor_id      UUID REFERENCES vendors(id) ON DELETE SET NULL,
  job_id         UUID REFERENCES production_jobs(id) ON DELETE SET NULL,
  send_id        UUID REFERENCES supplier_order_sends(id) ON DELETE SET NULL,
  actor_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  event          TEXT NOT NULL,                      -- settings_changed | map_changed | approval_requested | approved | rejected | submit_attempt | submit_ok | submit_refused | submit_unknown | webhook
  environment    TEXT,
  detail         JSONB NOT NULL DEFAULT '{}'::jsonb, -- payloads with credentials/tokens redacted
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_supplier_api_events_job ON supplier_api_events(org_id, job_id, created_at DESC);

CREATE OR REPLACE FUNCTION supplier_api_events_append_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'supplier_api_events is append-only';
END $$;
DROP TRIGGER IF EXISTS trg_supplier_api_events_append_only ON supplier_api_events;
CREATE TRIGGER trg_supplier_api_events_append_only
  BEFORE UPDATE OR DELETE ON supplier_api_events
  FOR EACH ROW EXECUTE FUNCTION supplier_api_events_append_only();

ALTER TABLE supplier_order_sends ADD COLUMN IF NOT EXISTS supplier_order_number TEXT;   -- ABC order number once the branch accepts
ALTER TABLE supplier_order_sends ADD COLUMN IF NOT EXISTS supplier_status TEXT;         -- latest status from the supplier's webhook
ALTER TABLE supplier_order_sends ADD COLUMN IF NOT EXISTS supplier_status_at TIMESTAMPTZ;

ALTER TABLE supplier_api_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_item_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_api_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_api_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON supplier_api_settings, supplier_item_map, supplier_api_approvals, supplier_api_events FROM anon, authenticated;

-- Rollback: DROP TABLE supplier_api_events, supplier_api_approvals, supplier_item_map, supplier_api_settings;
--           DROP FUNCTION supplier_api_events_append_only();
--           ALTER TABLE orgs DROP COLUMN supplier_api_ordering_enabled, DROP COLUMN supplier_api_second_approval_cents;
--           ALTER TABLE supplier_order_sends DROP COLUMN supplier_order_number, DROP COLUMN supplier_status, DROP COLUMN supplier_status_at;
