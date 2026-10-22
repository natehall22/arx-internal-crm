-- Migration: 202610210060_supplier_orders.sql
-- Purpose: let the CRM email a job's materials order to the supplier(s), safely.
--
-- Additive only (live system): new nullable columns on existing tables, three new tables.
-- Nothing here sends mail or changes a status — sends only happen from the "Send order to …"
-- button (POST /api/ops/jobs/[id]/supplier-orders/send). No trigger, cron or job ever sends.
--
-- Suppliers are per-company data on the existing `vendors` table (empty in prod as of
-- 2026-10-21). ABC Supply is just a row; no trade, supplier or material is hardcoded in code.
--
-- Reportable by design (BUILD-BRIEF 2026-10-21): org_id on every row, statuses are enums, a
-- timestamp per state change, and every fact on a sent PO (each line, qty, delivery date/address)
-- is a column — the PDF and email are copies, never the only record. No money is stored here
-- (POs carry quantities, not prices).

BEGIN;

DO $$ BEGIN
  CREATE TYPE material_source AS ENUM ('supplier', 'installer', 'customer', 'stock');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE TYPE supplier_connection_type AS ENUM ('email', 'api');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE TYPE supplier_order_status AS ENUM ('draft', 'sent', 'cancelled');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE TYPE supplier_order_send_kind AS ENUM ('order', 'revision', 'resend', 'cancellation');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE TYPE supplier_order_send_status AS ENUM ('sending', 'sent', 'failed', 'unknown');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE TYPE order_line_status AS ENUM ('ready', 'confirm', 'manual');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ============================================================
-- 1. Supplier record (reuse vendors)
-- ============================================================
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS order_email TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS order_cc_emails TEXT[];
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS account_number TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS default_branch TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS default_delivery_notes TEXT;
-- Trades this supplier is the company default for, e.g. {roofing,gutters}. One supplier may
-- cover several trades; the admin API refuses two active defaults for the same trade, and the
-- resolver treats a duplicate as "no supplier" (blocks sending) rather than guessing.
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS default_for_trades TEXT[];
-- How orders reach this supplier. NULL/email = CRM emails the PDF (today). 'api' is reserved for a
-- separate supplier API connector (e.g. ABC Supply) that plugs into lib/suppliers/send-order.ts.
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS connection_type supplier_connection_type DEFAULT 'email';

COMMENT ON COLUMN vendors.order_email IS 'Where purchase orders are emailed. Blank = this supplier cannot be emailed from the CRM.';
COMMENT ON COLUMN vendors.default_for_trades IS 'Trades this supplier is the company default for (job + line overrides win).';

-- ============================================================
-- 2. Installer-supplied materials default (sub record)
-- ============================================================
-- true = this sub buys and bills the materials for their trade (e.g. a gutter contractor).
-- NULL/false = we buy the materials.
ALTER TABLE sub_contractors ADD COLUMN IF NOT EXISTS supplies_materials BOOLEAN;

-- ============================================================
-- 3. Company default material source per trade
-- ============================================================
-- One row per (company, trade). No row = 'supplier'.
CREATE TABLE IF NOT EXISTS org_trade_material_defaults (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  trade TEXT NOT NULL,
  material_source material_source NOT NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, trade)
);

-- ============================================================
-- 4. Per-line overrides (existing table)
-- ============================================================
ALTER TABLE job_material_order_overrides ADD COLUMN IF NOT EXISTS vendor_id UUID REFERENCES vendors(id) ON DELETE SET NULL;
ALTER TABLE job_material_order_overrides ADD COLUMN IF NOT EXISTS material_source material_source;

-- ============================================================
-- 5. Per-job, per-trade override
-- ============================================================
CREATE TABLE IF NOT EXISTS job_trade_material_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES production_jobs(id) ON DELETE CASCADE,
  trade TEXT NOT NULL,
  material_source material_source,
  vendor_id UUID REFERENCES vendors(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (job_id, trade)
);
CREATE INDEX IF NOT EXISTS idx_job_trade_material_sources_org ON job_trade_material_sources(org_id);

-- ============================================================
-- 6. One purchase order per (job, supplier)
-- ============================================================
CREATE TABLE IF NOT EXISTS supplier_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES production_jobs(id) ON DELETE CASCADE,
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,
  po_letter TEXT NOT NULL,
  po_number TEXT NOT NULL,             -- e.g. 26-0141-A (revisions add -R1, -R2 on the label only)
  revision INTEGER NOT NULL DEFAULT 0,
  status supplier_order_status NOT NULL DEFAULT 'draft',
  last_lines_hash TEXT,                -- lines only: "changed since sent"
  last_content_hash TEXT,              -- lines + delivery date/address: "unchanged re-send"
  last_send_id UUID,                   -- supplier_order_sends row whose lines are the current PO
  last_delivery_date DATE,
  last_delivery_address TEXT,
  first_sent_at TIMESTAMPTZ,
  last_sent_at TIMESTAMPTZ,
  last_sent_by UUID REFERENCES users(id) ON DELETE SET NULL,
  last_sent_to TEXT,
  cancelled_at TIMESTAMPTZ,
  cancelled_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (job_id, vendor_id),
  UNIQUE (job_id, po_letter),
  UNIQUE (org_id, po_number)
);
CREATE INDEX IF NOT EXISTS idx_supplier_orders_job ON supplier_orders(job_id);

-- ============================================================
-- 7. Send log — every attempt, success or failure
-- ============================================================
CREATE TABLE IF NOT EXISTS supplier_order_sends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES production_jobs(id) ON DELETE CASCADE,
  supplier_order_id UUID NOT NULL REFERENCES supplier_orders(id) ON DELETE CASCADE,
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,
  kind supplier_order_send_kind NOT NULL,
  po_label TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  connection_type supplier_connection_type NOT NULL DEFAULT 'email',
  -- sending = in flight (one at a time per PO, see index); unknown = a send that never finished.
  status supplier_order_send_status NOT NULL DEFAULT 'sending',
  sent_by UUID REFERENCES users(id) ON DELETE SET NULL,
  to_email TEXT NOT NULL,
  cc_emails TEXT[],
  subject TEXT NOT NULL,
  note TEXT,
  delivery_date DATE,
  delivery_address TEXT,
  delivery_notes TEXT,
  line_count INTEGER,
  lines_hash TEXT,
  content_hash TEXT,
  pdf_sha256 TEXT,
  pdf_storage_path TEXT,               -- project-files bucket
  message_id TEXT,                     -- SMTP Message-ID (or the connector's order reference)
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),   -- attempt started
  sent_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_supplier_order_sends_order ON supplier_order_sends(supplier_order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_order_sends_job ON supplier_order_sends(job_id, created_at DESC);
-- Double-click / two tabs: only one in-flight send per PO.
CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_order_sends_in_flight
  ON supplier_order_sends(supplier_order_id) WHERE status = 'sending';

-- ============================================================
-- 8. The lines on each send — what the supplier was asked for, as rows
-- ============================================================
CREATE TABLE IF NOT EXISTS supplier_order_send_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  send_id UUID NOT NULL REFERENCES supplier_order_sends(id) ON DELETE CASCADE,
  supplier_order_id UUID NOT NULL REFERENCES supplier_orders(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES production_jobs(id) ON DELETE CASCADE,
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,
  line_key TEXT NOT NULL,              -- stable item key (same as job_material_order_overrides.item_key)
  trade TEXT NOT NULL,
  label TEXT NOT NULL,
  quantity_text TEXT,                  -- as printed, e.g. "20 sq · 58 bundles"
  note TEXT,
  line_status order_line_status NOT NULL,
  material_source material_source NOT NULL DEFAULT 'supplier',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (send_id, line_key)
);
CREATE INDEX IF NOT EXISTS idx_supplier_order_send_lines_order ON supplier_order_send_lines(supplier_order_id);
CREATE INDEX IF NOT EXISTS idx_supplier_order_send_lines_org ON supplier_order_send_lines(org_id);

-- ============================================================
-- 9. Where each trade's materials came from at send time (installer-change warning)
-- ============================================================
CREATE TABLE IF NOT EXISTS supplier_order_send_sourcing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  send_id UUID NOT NULL REFERENCES supplier_order_sends(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES production_jobs(id) ON DELETE CASCADE,
  trade TEXT NOT NULL,
  material_source material_source NOT NULL,
  installer_sub_id UUID REFERENCES sub_contractors(id) ON DELETE SET NULL,
  installer_name TEXT,
  installer_supplies_materials BOOLEAN,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (send_id, trade)
);
CREATE INDEX IF NOT EXISTS idx_supplier_order_send_sourcing_job ON supplier_order_send_sourcing(job_id);

-- ============================================================
-- RLS: reads for the org; writes only through the service client in API routes.
-- ============================================================
ALTER TABLE job_trade_material_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_order_sends ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_order_send_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_order_send_sourcing ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_trade_material_defaults ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org can view job trade material sources" ON job_trade_material_sources;
CREATE POLICY "Org can view job trade material sources" ON job_trade_material_sources FOR SELECT
  USING (org_id = (SELECT u.org_id FROM users u WHERE u.id = auth.uid()));

DROP POLICY IF EXISTS "Org can view supplier orders" ON supplier_orders;
CREATE POLICY "Org can view supplier orders" ON supplier_orders FOR SELECT
  USING (org_id = (SELECT u.org_id FROM users u WHERE u.id = auth.uid()));

DROP POLICY IF EXISTS "Org can view supplier order sends" ON supplier_order_sends;
CREATE POLICY "Org can view supplier order sends" ON supplier_order_sends FOR SELECT
  USING (org_id = (SELECT u.org_id FROM users u WHERE u.id = auth.uid()));

DROP POLICY IF EXISTS "Org can view supplier order send lines" ON supplier_order_send_lines;
CREATE POLICY "Org can view supplier order send lines" ON supplier_order_send_lines FOR SELECT
  USING (org_id = (SELECT u.org_id FROM users u WHERE u.id = auth.uid()));

DROP POLICY IF EXISTS "Org can view supplier order send sourcing" ON supplier_order_send_sourcing;
CREATE POLICY "Org can view supplier order send sourcing" ON supplier_order_send_sourcing FOR SELECT
  USING (org_id = (SELECT u.org_id FROM users u WHERE u.id = auth.uid()));

DROP POLICY IF EXISTS "Org can view trade material defaults" ON org_trade_material_defaults;
CREATE POLICY "Org can view trade material defaults" ON org_trade_material_defaults FOR SELECT
  USING (org_id = (SELECT u.org_id FROM users u WHERE u.id = auth.uid()));

-- vendors now carries where purchase orders are emailed. Any org user could rewrite it through
-- PostgREST under the old INSERT/UPDATE policies; nothing in the app writes vendors with a user
-- JWT (the admin route uses the service client), so writes are service-role only from here.
DROP POLICY IF EXISTS "Users can insert vendors in their org" ON vendors;
DROP POLICY IF EXISTS "Users can update vendors in their org" ON vendors;

COMMIT;

-- Rollback (only before any PO has been sent — after that the send log is the audit trail):
-- BEGIN;
-- DROP TABLE IF EXISTS supplier_order_send_sourcing;
-- DROP TABLE IF EXISTS supplier_order_send_lines;
-- DROP TABLE IF EXISTS supplier_order_sends;
-- DROP TABLE IF EXISTS supplier_orders;
-- DROP TABLE IF EXISTS job_trade_material_sources;
-- ALTER TABLE job_material_order_overrides DROP COLUMN IF EXISTS material_source, DROP COLUMN IF EXISTS vendor_id;
-- DROP TABLE IF EXISTS org_trade_material_defaults;
-- ALTER TABLE sub_contractors DROP COLUMN IF EXISTS supplies_materials;
-- ALTER TABLE vendors DROP COLUMN IF EXISTS connection_type, DROP COLUMN IF EXISTS default_for_trades, DROP COLUMN IF EXISTS default_delivery_notes,
--   DROP COLUMN IF EXISTS default_branch, DROP COLUMN IF EXISTS account_number,
--   DROP COLUMN IF EXISTS order_cc_emails, DROP COLUMN IF EXISTS order_email;
-- DROP TYPE IF EXISTS order_line_status, supplier_order_send_status, supplier_order_send_kind,
--   supplier_order_status, supplier_connection_type, material_source;
-- COMMIT;
