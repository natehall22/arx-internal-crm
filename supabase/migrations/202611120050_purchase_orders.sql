-- Migration: 202611120050_purchase_orders.sql
-- Purpose: purchase orders for ANY vendor or subcontractor, any trade, any company.
--
-- ONE purchase-order system. ARX's roofing materials order (supplier_orders, kind 'materials') stays exactly as it is;
-- a general PO is another `kind` on the same table, with the same send log, PO numbers, status and double-send guard.
-- Additive only (live system): new nullable columns, new tables, a relaxed NOT NULL on job_id (a PO may belong to a
-- service visit that has no job), enum values that only general POs use.
--
--  1. vendors  = the ONE directory of who a company buys from: type supplier | sub | both, phone, contact, trades.
--  2. supplier_orders gains kind / work_order_id / draft fields / acknowledgement fields.
--  3. purchase_order_lines   = what is on a general PO (qty, unit cost, cost type, price book item).
--  4. purchase_order_bills   = a vendor bill recorded against a PO; its cost lands in job_cost_lines through the
--     one writer (lib/job-cost-ledger.ts addJobCostLine). One cost line per bill (unique index) = no doubling.
--  5. save_supplier() carries the new vendor fields (same atomic save + change log).
-- Nothing here sends mail. A PO leaves the CRM only from POST /api/ops/purchase-orders/[id]/send.

BEGIN;

-- ============================================================
-- 1. Vendor directory
-- ============================================================
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS vendor_type TEXT NOT NULL DEFAULT 'supplier';
DO $$ BEGIN
  ALTER TABLE vendors ADD CONSTRAINT vendors_vendor_type_check CHECK (vendor_type IN ('supplier', 'sub', 'both'));
EXCEPTION WHEN duplicate_object THEN null; END $$;
-- Trades this vendor covers (NOT exclusive, unlike default_for_trades which is "the company's default supplier").
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS trades TEXT[];
-- A sub vendor can point at the existing sub_contractors row (crews, scheduling) so one person is not typed twice.
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS sub_contractor_id UUID REFERENCES sub_contractors(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_vendors_sub_contractor ON vendors(sub_contractor_id) WHERE sub_contractor_id IS NOT NULL;
-- At most one directory entry per sub.
CREATE UNIQUE INDEX IF NOT EXISTS uq_vendors_sub_contractor ON vendors(org_id, sub_contractor_id) WHERE sub_contractor_id IS NOT NULL AND deleted_at IS NULL;

-- ============================================================
-- 2. supplier_orders = the purchase order (kind 'materials' = today's roofing order, 'general' = any vendor)
-- ============================================================
DO $$ BEGIN
  ALTER TYPE supplier_order_status ADD VALUE IF NOT EXISTS 'acknowledged';
  ALTER TYPE supplier_order_status ADD VALUE IF NOT EXISTS 'partially_received';
  ALTER TYPE supplier_order_status ADD VALUE IF NOT EXISTS 'received';
  ALTER TYPE supplier_order_status ADD VALUE IF NOT EXISTS 'billed';
END $$;

ALTER TABLE supplier_orders ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'materials';
DO $$ BEGIN
  ALTER TABLE supplier_orders ADD CONSTRAINT supplier_orders_kind_check CHECK (kind IN ('materials', 'general'));
EXCEPTION WHEN duplicate_object THEN null; END $$;
ALTER TABLE supplier_orders ADD COLUMN IF NOT EXISTS work_order_id UUID REFERENCES work_orders(id) ON DELETE SET NULL;
ALTER TABLE supplier_orders ADD COLUMN IF NOT EXISTS title TEXT;
-- What the person typed on the draft (a sent PO's sent values live in last_*; the send log holds each version).
ALTER TABLE supplier_orders ADD COLUMN IF NOT EXISTS draft_date DATE;
ALTER TABLE supplier_orders ADD COLUMN IF NOT EXISTS draft_date_kind TEXT NOT NULL DEFAULT 'delivery';
DO $$ BEGIN
  ALTER TABLE supplier_orders ADD CONSTRAINT supplier_orders_date_kind_check CHECK (draft_date_kind IN ('delivery', 'start'));
EXCEPTION WHEN duplicate_object THEN null; END $$;
ALTER TABLE supplier_orders ADD COLUMN IF NOT EXISTS draft_address TEXT;
ALTER TABLE supplier_orders ADD COLUMN IF NOT EXISTS draft_note TEXT;
ALTER TABLE supplier_orders ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL;
-- Vendor confirmation link (optional): only the SHA-256 of the token is stored.
ALTER TABLE supplier_orders ADD COLUMN IF NOT EXISTS ack_token_hash TEXT;
ALTER TABLE supplier_orders ADD COLUMN IF NOT EXISTS ack_token_expires_at TIMESTAMPTZ;
ALTER TABLE supplier_orders ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ;
ALTER TABLE supplier_orders ADD COLUMN IF NOT EXISTS acknowledged_note TEXT;
ALTER TABLE supplier_orders ADD COLUMN IF NOT EXISTS acknowledged_by TEXT;   -- 'vendor_link' | 'staff'
ALTER TABLE supplier_orders ADD COLUMN IF NOT EXISTS billed_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_orders_ack_token ON supplier_orders(ack_token_hash) WHERE ack_token_hash IS NOT NULL;

-- A PO may belong to a service visit that has no job; a general PO has no job letter when it has no job.
ALTER TABLE supplier_orders ALTER COLUMN job_id DROP NOT NULL;
ALTER TABLE supplier_orders ALTER COLUMN po_letter DROP NOT NULL;
ALTER TABLE supplier_order_sends ALTER COLUMN job_id DROP NOT NULL;
ALTER TABLE supplier_order_send_lines ALTER COLUMN job_id DROP NOT NULL;
ALTER TABLE supplier_order_send_lines ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(12, 2);

-- One PO per vendor per job (per visit for a visit PO), per kind: roofing materials at ABC and a general PO to ABC
-- on the same job can both exist. Cancelled POs keep their number, so they still hold the slot (revise, don't recreate).
ALTER TABLE supplier_orders DROP CONSTRAINT IF EXISTS supplier_orders_job_id_vendor_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_orders_job_vendor_kind
  ON supplier_orders (job_id, vendor_id, kind, COALESCE(work_order_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE job_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_orders_visit_vendor
  ON supplier_orders (work_order_id, vendor_id) WHERE job_id IS NULL AND work_order_id IS NOT NULL;
-- A PO belongs to a job or a visit (a materials PO always to a job).
DO $$ BEGIN
  ALTER TABLE supplier_orders ADD CONSTRAINT supplier_orders_belongs_check
    CHECK (job_id IS NOT NULL OR work_order_id IS NOT NULL) NOT VALID;
EXCEPTION WHEN duplicate_object THEN null; END $$;
CREATE INDEX IF NOT EXISTS idx_supplier_orders_work_order ON supplier_orders(work_order_id) WHERE work_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_supplier_orders_org_kind ON supplier_orders(org_id, kind, status);

-- ============================================================
-- 3. Lines on a general PO
-- ============================================================
CREATE TABLE IF NOT EXISTS purchase_order_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  supplier_order_id UUID NOT NULL REFERENCES supplier_orders(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL,
  quantity NUMERIC(12, 3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit TEXT,
  unit_cost NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  -- job cost type (material, labor, subcontractor, permit, misc, other) = the bucket a bill lands in
  cost_type TEXT NOT NULL DEFAULT 'material' CHECK (cost_type IN ('material', 'labor', 'permit', 'subcontractor', 'misc', 'other')),
  cost_code TEXT,
  pricebook_item_id UUID,
  received_quantity NUMERIC(12, 3) NOT NULL DEFAULT 0 CHECK (received_quantity >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_po_lines_order ON purchase_order_lines(supplier_order_id, position);
CREATE INDEX IF NOT EXISTS idx_po_lines_org ON purchase_order_lines(org_id);

-- ============================================================
-- 4. Vendor bills recorded against a PO
-- ============================================================
CREATE TABLE IF NOT EXISTS purchase_order_bills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  supplier_order_id UUID NOT NULL REFERENCES supplier_orders(id) ON DELETE CASCADE,
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,
  job_id UUID REFERENCES production_jobs(id) ON DELETE SET NULL,
  bill_number TEXT,
  bill_date DATE,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  is_credit BOOLEAN NOT NULL DEFAULT false,
  cost_type TEXT NOT NULL DEFAULT 'material' CHECK (cost_type IN ('material', 'labor', 'permit', 'subcontractor', 'misc', 'other')),
  notes TEXT,
  -- the job_cost_lines row this bill produced (null for a PO on a visit without a job: there is no job budget to land on)
  cost_line_id UUID REFERENCES job_cost_lines(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'void')),
  voided_at TIMESTAMPTZ,
  voided_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_po_bills_order ON purchase_order_bills(supplier_order_id, created_at);
CREATE INDEX IF NOT EXISTS idx_po_bills_org ON purchase_order_bills(org_id);
-- The same vendor invoice number cannot be recorded twice on one PO.
CREATE UNIQUE INDEX IF NOT EXISTS uq_po_bills_number
  ON purchase_order_bills(supplier_order_id, lower(bill_number)) WHERE bill_number IS NOT NULL AND status = 'active';

-- The cost ledger knows which bill a line came from: one cost line per bill, so a retry can never double a cost.
ALTER TABLE job_cost_lines ADD COLUMN IF NOT EXISTS purchase_order_bill_id UUID REFERENCES purchase_order_bills(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_job_cost_lines_po_bill ON job_cost_lines(purchase_order_bill_id) WHERE purchase_order_bill_id IS NOT NULL;
DO $$ BEGIN
  ALTER TYPE job_cost_line_source ADD VALUE IF NOT EXISTS 'vendor_bill';
END $$;

-- ============================================================
-- RLS: reads for the company; every write goes through the service client in API routes.
-- ============================================================
ALTER TABLE purchase_order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_bills ENABLE ROW LEVEL SECURITY;
-- Money columns: no policy at all = service role only (field roles must never read unit costs or bills).

-- ============================================================
-- 5. save_supplier(): the vendor directory fields join the one atomic save + change log
-- ============================================================
CREATE OR REPLACE FUNCTION public.save_supplier(
  p_org uuid, p_actor uuid, p_id uuid, p_expected_updated_at timestamptz, p_input jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old vendors;
  v_name text := btrim(COALESCE(p_input->>'name', ''));
  v_new jsonb;
  v_oldj jsonb;
  v_changes jsonb := '[]'::jsonb;
  v_action text;
  v_id uuid;
  v_updated timestamptz;
  v_type text;
  f record;
BEGIN
  IF v_name = '' THEN RAISE EXCEPTION 'supplier_name_required'; END IF;

  IF p_id IS NOT NULL THEN
    SELECT * INTO v_old FROM vendors WHERE id = p_id AND org_id = p_org AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'supplier_not_found'; END IF;
    IF p_expected_updated_at IS NULL OR v_old.updated_at <> p_expected_updated_at THEN
      RAISE EXCEPTION 'supplier_stale';
    END IF;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('supplier:' || p_org::text));

  IF EXISTS (SELECT 1 FROM vendors WHERE org_id = p_org AND deleted_at IS NULL AND lower(name) = lower(v_name) AND (p_id IS NULL OR id <> p_id)) THEN
    RAISE EXCEPTION 'supplier_name_taken';
  END IF;

  -- A key the caller did not send keeps today's value (an older client or the API ordering screens never lose a field).
  v_type := CASE
    WHEN p_input->>'vendor_type' IN ('supplier', 'sub', 'both') THEN p_input->>'vendor_type'
    ELSE COALESCE(v_old.vendor_type, 'supplier') END;

  v_new := jsonb_build_object(
    'name', v_name,
    'active', CASE WHEN p_input->>'active' IN ('true','false') THEN (p_input->>'active')::boolean ELSE true END,
    'order_email', to_jsonb(NULLIF(btrim(COALESCE(p_input->>'order_email', '')), '')),
    'order_cc_emails', CASE WHEN jsonb_typeof(p_input->'order_cc_emails') = 'array' THEN p_input->'order_cc_emails' ELSE '[]'::jsonb END,
    'account_number', to_jsonb(NULLIF(btrim(COALESCE(p_input->>'account_number', '')), '')),
    'default_branch', to_jsonb(NULLIF(btrim(COALESCE(p_input->>'default_branch', '')), '')),
    'default_delivery_notes', to_jsonb(NULLIF(btrim(COALESCE(p_input->>'default_delivery_notes', '')), '')),
    'default_for_trades', CASE WHEN jsonb_typeof(p_input->'default_for_trades') = 'array' THEN p_input->'default_for_trades' ELSE '[]'::jsonb END,
    'connection_type', CASE WHEN p_input->>'connection_type' = 'api' THEN 'api' ELSE 'email' END,
    'vendor_type', to_jsonb(v_type),
    'phone', CASE WHEN p_input ? 'phone' THEN to_jsonb(NULLIF(btrim(COALESCE(p_input->>'phone', '')), '')) ELSE to_jsonb(v_old.phone) END,
    'contact_name', CASE WHEN p_input ? 'contact_name' THEN to_jsonb(NULLIF(btrim(COALESCE(p_input->>'contact_name', '')), '')) ELSE to_jsonb(v_old.contact_name) END,
    'trades', CASE WHEN jsonb_typeof(p_input->'trades') = 'array' THEN p_input->'trades' ELSE to_jsonb(COALESCE(v_old.trades, '{}'::text[])) END
  );

  IF v_old.id IS NOT NULL THEN
    v_oldj := jsonb_build_object(
      'name', v_old.name, 'active', v_old.active, 'order_email', to_jsonb(v_old.order_email),
      'order_cc_emails', to_jsonb(COALESCE(v_old.order_cc_emails, '{}'::text[])),
      'account_number', to_jsonb(v_old.account_number), 'default_branch', to_jsonb(v_old.default_branch),
      'default_delivery_notes', to_jsonb(v_old.default_delivery_notes),
      'default_for_trades', to_jsonb(COALESCE(v_old.default_for_trades, '{}'::text[])),
      'connection_type', to_jsonb(COALESCE(v_old.connection_type::text, 'email')),
      'vendor_type', to_jsonb(COALESCE(v_old.vendor_type, 'supplier')),
      'phone', to_jsonb(v_old.phone), 'contact_name', to_jsonb(v_old.contact_name),
      'trades', to_jsonb(COALESCE(v_old.trades, '{}'::text[]))
    );
  END IF;

  FOR f IN SELECT * FROM (VALUES
      ('name', 'Name'), ('active', 'Active'), ('vendor_type', 'Type'), ('order_email', 'Order email'), ('order_cc_emails', 'CC emails'),
      ('phone', 'Phone'), ('contact_name', 'Contact'), ('trades', 'Trades'),
      ('account_number', 'Account number'), ('default_branch', 'Branch'), ('default_delivery_notes', 'Delivery notes'),
      ('default_for_trades', 'Default for trades'), ('connection_type', 'How orders are sent')
    ) AS t(k, label)
  LOOP
    IF v_oldj IS NULL THEN
      IF f.k IN ('name', 'active') OR COALESCE(v_new->f.k, 'null'::jsonb) NOT IN ('null'::jsonb, '[]'::jsonb)
         AND NOT (f.k = 'vendor_type' AND v_new->>f.k = 'supplier') THEN
        v_changes := v_changes || jsonb_build_array(jsonb_build_object('field', f.k, 'label', f.label, 'old', NULL, 'new', v_new->f.k));
      END IF;
    ELSIF COALESCE(v_oldj->f.k, 'null'::jsonb) IS DISTINCT FROM COALESCE(v_new->f.k, 'null'::jsonb) THEN
      v_changes := v_changes || jsonb_build_array(jsonb_build_object('field', f.k, 'label', f.label, 'old', v_oldj->f.k, 'new', v_new->f.k));
    END IF;
  END LOOP;

  IF v_old.id IS NOT NULL AND jsonb_array_length(v_changes) = 0 THEN
    RETURN jsonb_build_object('id', v_old.id, 'updated_at', v_old.updated_at, 'changes', '[]'::jsonb, 'unchanged', true);
  END IF;

  IF v_old.id IS NULL THEN
    INSERT INTO vendors (org_id, name, active, order_email, order_cc_emails, account_number, default_branch,
                         default_delivery_notes, default_for_trades, connection_type, vendor_type, phone, contact_name, trades,
                         sub_contractor_id, created_by)
    VALUES (p_org, v_name, (v_new->>'active')::boolean, v_new->>'order_email',
            COALESCE(ARRAY(SELECT jsonb_array_elements_text(v_new->'order_cc_emails')), '{}'),
            v_new->>'account_number', v_new->>'default_branch', v_new->>'default_delivery_notes',
            COALESCE(ARRAY(SELECT jsonb_array_elements_text(v_new->'default_for_trades')), '{}'),
            (v_new->>'connection_type')::supplier_connection_type, v_type, v_new->>'phone', v_new->>'contact_name',
            COALESCE(ARRAY(SELECT jsonb_array_elements_text(v_new->'trades')), '{}'),
            -- only a sub of THIS company can be linked
            (SELECT s.id FROM sub_contractors s WHERE s.id = NULLIF(p_input->>'sub_contractor_id', '')::uuid AND s.org_id = p_org),
            p_actor)
    RETURNING id, updated_at INTO v_id, v_updated;
    v_action := 'created';
  ELSE
    UPDATE vendors SET
      name = v_name, active = (v_new->>'active')::boolean, order_email = v_new->>'order_email',
      order_cc_emails = COALESCE(ARRAY(SELECT jsonb_array_elements_text(v_new->'order_cc_emails')), '{}'),
      account_number = v_new->>'account_number', default_branch = v_new->>'default_branch',
      default_delivery_notes = v_new->>'default_delivery_notes',
      default_for_trades = COALESCE(ARRAY(SELECT jsonb_array_elements_text(v_new->'default_for_trades')), '{}'),
      connection_type = (v_new->>'connection_type')::supplier_connection_type,
      vendor_type = v_type, phone = v_new->>'phone', contact_name = v_new->>'contact_name',
      trades = COALESCE(ARRAY(SELECT jsonb_array_elements_text(v_new->'trades')), '{}'),
      updated_at = now()
    WHERE id = v_old.id
    RETURNING id, updated_at INTO v_id, v_updated;
    v_action := CASE
      WHEN v_old.active AND NOT (v_new->>'active')::boolean THEN 'deactivated'
      WHEN NOT v_old.active AND (v_new->>'active')::boolean THEN 'reactivated'
      ELSE 'updated' END;
  END IF;

  INSERT INTO supplier_audit_log (org_id, vendor_id, action, changed_by, changes)
  VALUES (p_org, v_id, v_action, p_actor, v_changes);

  RETURN jsonb_build_object('id', v_id, 'updated_at', v_updated, 'changes', v_changes, 'unchanged', false, 'action', v_action);
END;
$$;

REVOKE ALL ON FUNCTION public.save_supplier(uuid, uuid, uuid, timestamptz, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_supplier(uuid, uuid, uuid, timestamptz, jsonb) TO service_role;

COMMIT;

-- Rollback (nothing else reads these; general POs are the only rows that use them):
--   DROP TABLE IF EXISTS purchase_order_bills; DROP TABLE IF EXISTS purchase_order_lines;
--   ALTER TABLE job_cost_lines DROP COLUMN IF EXISTS purchase_order_bill_id;
--   (enum values cannot be dropped; restore save_supplier from 202610220030)
