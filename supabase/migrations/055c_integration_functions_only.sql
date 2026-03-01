-- Add only the missing functions and indexes for integration_outbox
-- Run this if 055b fails

-- Sync status enum (if not exists)
DO $$ BEGIN
  CREATE TYPE sync_status AS ENUM ('pending', 'synced', 'failed', 'skipped');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Outbox event status enum (if not exists)
DO $$ BEGIN
  CREATE TYPE outbox_status AS ENUM ('pending', 'processing', 'completed', 'failed', 'skipped');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Add external ID fields to customers (if not exist)
ALTER TABLE customers 
ADD COLUMN IF NOT EXISTS qb_customer_id TEXT,
ADD COLUMN IF NOT EXISTS sync_status sync_status DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS synced_to_qb_at TIMESTAMPTZ;

-- Add external ID fields to job_invoices (if not exist)
ALTER TABLE job_invoices 
ADD COLUMN IF NOT EXISTS qb_invoice_id TEXT,
ADD COLUMN IF NOT EXISTS sync_status sync_status DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS synced_to_qb_at TIMESTAMPTZ;

-- Add external ID fields to job_payments (if not exist)
ALTER TABLE job_payments 
ADD COLUMN IF NOT EXISTS qb_payment_id TEXT,
ADD COLUMN IF NOT EXISTS sync_status sync_status DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS synced_to_qb_at TIMESTAMPTZ;

-- Indexes (IF NOT EXISTS)
CREATE INDEX IF NOT EXISTS idx_customers_qb_customer_id ON customers(qb_customer_id) WHERE qb_customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_sync_status ON customers(sync_status) WHERE sync_status = 'pending';
CREATE INDEX IF NOT EXISTS idx_job_invoices_qb_invoice_id ON job_invoices(qb_invoice_id) WHERE qb_invoice_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_job_invoices_sync_status ON job_invoices(sync_status) WHERE sync_status = 'pending';
CREATE INDEX IF NOT EXISTS idx_job_payments_qb_payment_id ON job_payments(qb_payment_id) WHERE qb_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_job_payments_sync_status ON job_payments(sync_status) WHERE sync_status = 'pending';

-- Indexes for outbox
CREATE INDEX IF NOT EXISTS idx_outbox_pending ON integration_outbox(provider, status, created_at) 
  WHERE status IN ('pending', 'failed');
CREATE INDEX IF NOT EXISTS idx_outbox_org_provider ON integration_outbox(org_id, provider);
CREATE INDEX IF NOT EXISTS idx_outbox_entity ON integration_outbox(entity_table, entity_id);

-- RLS for outbox
ALTER TABLE integration_outbox ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read outbox events for their org" ON integration_outbox;
CREATE POLICY "Users can read outbox events for their org" ON integration_outbox
  FOR SELECT USING (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Service role can manage outbox" ON integration_outbox;
CREATE POLICY "Service role can manage outbox" ON integration_outbox
  FOR ALL USING (true);

-- Helper function to generate idempotency key
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

-- Function to enqueue outbox event (upsert)
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
    status = CASE 
      WHEN integration_outbox.status = 'failed' THEN 'pending'::outbox_status
      ELSE integration_outbox.status
    END
  RETURNING id INTO v_event_id;
  
  RETURN v_event_id;
END;
$$ LANGUAGE plpgsql;
