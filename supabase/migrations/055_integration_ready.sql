-- Integration-ready schema for QuickBooks and other accounting software
-- Adds external ID fields and outbox pattern for future integrations

-- Sync status enum
DO $$ BEGIN
  CREATE TYPE sync_status AS ENUM ('pending', 'synced', 'failed', 'skipped');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Outbox event status enum
DO $$ BEGIN
  CREATE TYPE outbox_status AS ENUM ('pending', 'processing', 'completed', 'failed', 'skipped');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- ============================================
-- Add external ID fields to existing tables
-- ============================================

-- Customers: QuickBooks customer sync
ALTER TABLE customers 
ADD COLUMN IF NOT EXISTS qb_customer_id TEXT,
ADD COLUMN IF NOT EXISTS sync_status sync_status DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS synced_to_qb_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_customers_qb_customer_id ON customers(qb_customer_id) WHERE qb_customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_sync_status ON customers(sync_status) WHERE sync_status = 'pending';

-- Job Invoices: QuickBooks invoice sync
ALTER TABLE job_invoices 
ADD COLUMN IF NOT EXISTS qb_invoice_id TEXT,
ADD COLUMN IF NOT EXISTS sync_status sync_status DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS synced_to_qb_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_job_invoices_qb_invoice_id ON job_invoices(qb_invoice_id) WHERE qb_invoice_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_job_invoices_sync_status ON job_invoices(sync_status) WHERE sync_status = 'pending';

-- Job Payments: QuickBooks payment sync
ALTER TABLE job_payments 
ADD COLUMN IF NOT EXISTS qb_payment_id TEXT,
ADD COLUMN IF NOT EXISTS sync_status sync_status DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS synced_to_qb_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_job_payments_qb_payment_id ON job_payments(qb_payment_id) WHERE qb_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_job_payments_sync_status ON job_payments(sync_status) WHERE sync_status = 'pending';

-- ============================================
-- Integration Outbox Table
-- ============================================

CREATE TABLE integration_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  
  -- Integration target
  provider TEXT NOT NULL, -- 'quickbooks', 'xero', 'sage', etc.
  
  -- Event details
  event_type TEXT NOT NULL, -- 'customer.upserted', 'invoice.finalized', etc.
  entity_table TEXT NOT NULL, -- 'customers', 'job_invoices', 'job_payments'
  entity_id UUID NOT NULL,
  
  -- Idempotency key to prevent duplicate processing
  idempotency_key TEXT NOT NULL UNIQUE,
  
  -- Event payload (full entity snapshot for integration)
  payload JSONB NOT NULL DEFAULT '{}',
  
  -- Processing status
  status outbox_status NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

-- Indexes for efficient polling
CREATE INDEX idx_outbox_pending ON integration_outbox(provider, status, created_at) 
  WHERE status IN ('pending', 'failed');
CREATE INDEX idx_outbox_org_provider ON integration_outbox(org_id, provider);
CREATE INDEX idx_outbox_entity ON integration_outbox(entity_table, entity_id);

-- RLS
ALTER TABLE integration_outbox ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read outbox events for their org" ON integration_outbox
  FOR SELECT USING (org_id = get_user_org_id(auth.uid()));

CREATE POLICY "Service role can manage outbox" ON integration_outbox
  FOR ALL USING (true);

-- ============================================
-- Helper function to generate idempotency key
-- ============================================

CREATE OR REPLACE FUNCTION generate_idempotency_key(
  p_org_id UUID,
  p_entity_table TEXT,
  p_entity_id UUID,
  p_event_type TEXT,
  p_version INTEGER DEFAULT 1
) RETURNS TEXT AS $$
BEGIN
  RETURN p_org_id::TEXT || ':' || p_entity_table || ':' || p_entity_id::TEXT || ':' || p_event_type || ':v' || p_version;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================
-- Function to enqueue outbox event (upsert)
-- ============================================

CREATE OR REPLACE FUNCTION enqueue_integration_event(
  p_org_id UUID,
  p_provider TEXT,
  p_event_type TEXT,
  p_entity_table TEXT,
  p_entity_id UUID,
  p_payload JSONB,
  p_version INTEGER DEFAULT 1
) RETURNS UUID AS $$
DECLARE
  v_idempotency_key TEXT;
  v_event_id UUID;
BEGIN
  v_idempotency_key := generate_idempotency_key(p_org_id, p_entity_table, p_entity_id, p_event_type, p_version);
  
  INSERT INTO integration_outbox (
    org_id, provider, event_type, entity_table, entity_id, 
    idempotency_key, payload, status
  ) VALUES (
    p_org_id, p_provider, p_event_type, p_entity_table, p_entity_id,
    v_idempotency_key, p_payload, 'pending'
  )
  ON CONFLICT (idempotency_key) DO UPDATE SET
    payload = EXCLUDED.payload,
    updated_at = NOW(),
    -- Only reset status if it was failed (allow retry)
    status = CASE 
      WHEN integration_outbox.status = 'failed' THEN 'pending'::outbox_status
      ELSE integration_outbox.status
    END
  RETURNING id INTO v_event_id;
  
  RETURN v_event_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON TABLE integration_outbox IS 'Outbox pattern for reliable integration events to external systems like QuickBooks';
COMMENT ON COLUMN integration_outbox.idempotency_key IS 'Unique key to prevent duplicate event processing: org:table:id:event:version';
