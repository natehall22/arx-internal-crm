-- Migration: 067_change_orders.sql
-- Purpose: Change Order system for projects

-- ============================================
-- PART 1: Create job_change_orders table
-- ============================================

CREATE TABLE IF NOT EXISTS job_change_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  job_id UUID REFERENCES production_jobs(id) ON DELETE SET NULL,
  
  -- Change order identification
  co_number TEXT NOT NULL, -- CO-001, CO-002, etc.
  
  -- Financial details
  original_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  updated_total NUMERIC(12, 2) NOT NULL DEFAULT 0,
  updated_remaining NUMERIC(12, 2) NOT NULL DEFAULT 0,
  
  -- Description
  description TEXT NOT NULL,
  
  -- Customer signature
  customer_print_name TEXT NOT NULL,
  customer_signature_data TEXT NOT NULL,
  
  -- Rep signature
  rep_name TEXT NOT NULL,
  rep_signature_data TEXT NOT NULL,
  
  -- Signing metadata
  signed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- PDF storage (same bucket as Installation Agreement)
  pdf_url TEXT,
  pdf_storage_path TEXT,
  
  -- Original contract reference
  original_contract_id UUID REFERENCES order_form_contracts(id) ON DELETE SET NULL,
  original_contract_date DATE,
  
  -- Payment method from original contract (for display purposes)
  payment_method TEXT,
  
  -- Audit
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- PART 2: Indexes
-- ============================================

CREATE INDEX IF NOT EXISTS idx_job_change_orders_org_id ON job_change_orders(org_id);
CREATE INDEX IF NOT EXISTS idx_job_change_orders_project_id ON job_change_orders(project_id);
CREATE INDEX IF NOT EXISTS idx_job_change_orders_job_id ON job_change_orders(job_id);
CREATE INDEX IF NOT EXISTS idx_job_change_orders_created_at ON job_change_orders(created_at DESC);

-- Unique constraint: CO number per project
CREATE UNIQUE INDEX IF NOT EXISTS idx_job_change_orders_unique_co 
  ON job_change_orders(project_id, co_number);

-- ============================================
-- PART 3: RLS Policies
-- ============================================

ALTER TABLE job_change_orders ENABLE ROW LEVEL SECURITY;

-- Users can read change orders in their org
DROP POLICY IF EXISTS "Users can read change orders" ON job_change_orders;
CREATE POLICY "Users can read change orders"
  ON job_change_orders FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

-- Users can insert change orders in their org
DROP POLICY IF EXISTS "Users can insert change orders" ON job_change_orders;
CREATE POLICY "Users can insert change orders"
  ON job_change_orders FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

-- Users can update change orders in their org
DROP POLICY IF EXISTS "Users can update change orders" ON job_change_orders;
CREATE POLICY "Users can update change orders"
  ON job_change_orders FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

-- ============================================
-- PART 4: Updated_at trigger
-- ============================================

CREATE OR REPLACE FUNCTION update_job_change_orders_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_job_change_orders_updated_at ON job_change_orders;
CREATE TRIGGER trigger_job_change_orders_updated_at
  BEFORE UPDATE ON job_change_orders
  FOR EACH ROW
  EXECUTE FUNCTION update_job_change_orders_updated_at();

-- ============================================
-- PART 5: Function to get next CO number
-- ============================================

CREATE OR REPLACE FUNCTION get_next_co_number(p_project_id UUID)
RETURNS TEXT AS $$
DECLARE
  next_num INTEGER;
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(co_number FROM 4) AS INTEGER)), 0) + 1
  INTO next_num
  FROM job_change_orders
  WHERE project_id = p_project_id;
  
  RETURN 'CO-' || LPAD(next_num::TEXT, 3, '0');
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- PART 6: Add change_order to job_file_type enum if not exists
-- ============================================

DO $$
BEGIN
  -- Check if 'change_order' already exists in the enum
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum 
    WHERE enumlabel = 'change_order' 
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'job_file_type')
  ) THEN
    -- Add change_order to the enum if it doesn't exist
    ALTER TYPE job_file_type ADD VALUE IF NOT EXISTS 'change_order';
  END IF;
EXCEPTION
  WHEN others THEN
    -- Enum might not exist or value already exists, ignore
    NULL;
END $$;

-- ============================================
-- PART 7: Comments
-- ============================================

COMMENT ON TABLE job_change_orders IS 'Change orders that modify the original Installation Agreement';
COMMENT ON COLUMN job_change_orders.co_number IS 'Sequential change order number per project (CO-001, CO-002, etc.)';
COMMENT ON COLUMN job_change_orders.original_amount IS 'Original contract amount before this change order';
COMMENT ON COLUMN job_change_orders.updated_total IS 'New total project cost after this change order';
COMMENT ON COLUMN job_change_orders.updated_remaining IS 'Remaining balance after this change order';
