-- Supplier change log: who changed which supplier field, when, old -> new. Additive.
-- Suppliers decide where a job's address and materials list are emailed, so every change is recorded.
-- Written by the owner-only suppliers API (service role); no direct API access.

CREATE TABLE IF NOT EXISTS supplier_audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  vendor_id   uuid NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  action      text NOT NULL CHECK (action IN ('created', 'updated', 'deactivated', 'reactivated')),
  changed_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  changed_at  timestamptz NOT NULL DEFAULT now(),
  changes     jsonb NOT NULL DEFAULT '[]'::jsonb   -- [{ "field": "order_email", "label": "Order email", "old": ..., "new": ... }]
);
CREATE INDEX IF NOT EXISTS idx_supplier_audit_log_vendor ON supplier_audit_log (vendor_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_audit_log_org ON supplier_audit_log (org_id, changed_at DESC);
ALTER TABLE supplier_audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON supplier_audit_log FROM anon, authenticated;
COMMENT ON TABLE supplier_audit_log IS 'Change log for vendors/suppliers (order email, CC, account, default trades, active, connection). Service-role only.';

-- Rollback: DROP TABLE IF EXISTS supplier_audit_log;
