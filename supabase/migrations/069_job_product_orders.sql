-- Migration: 069_job_product_orders.sql
-- Purpose: Product/material orders tracking for jobs

-- Create status enum
DO $$ BEGIN
  CREATE TYPE job_product_order_status AS ENUM ('ordered', 'received', 'paid', 'returned');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Create table
CREATE TABLE IF NOT EXISTS job_product_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES production_jobs(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  supplier TEXT,
  amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  status job_product_order_status NOT NULL DEFAULT 'ordered',
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_job_product_orders_org_id ON job_product_orders(org_id);
CREATE INDEX IF NOT EXISTS idx_job_product_orders_job_id ON job_product_orders(job_id);
CREATE INDEX IF NOT EXISTS idx_job_product_orders_status ON job_product_orders(status);

-- Enable RLS
ALTER TABLE job_product_orders ENABLE ROW LEVEL SECURITY;

-- RLS Policies: All authenticated users can select, insert, update
-- Only admin can delete

-- Select: users in same org
CREATE POLICY "Users can view product orders"
  ON job_product_orders FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM production_jobs pj
      WHERE pj.id = job_product_orders.job_id
      AND pj.org_id = (SELECT u.org_id FROM users u WHERE u.id = auth.uid())
    )
  );

-- Insert: users in same org
CREATE POLICY "Users can create product orders"
  ON job_product_orders FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM production_jobs pj
      WHERE pj.id = job_id
      AND pj.org_id = org_id
      AND pj.org_id = (SELECT u.org_id FROM users u WHERE u.id = auth.uid())
    )
  );

-- Update: users in same org
CREATE POLICY "Users can update product orders"
  ON job_product_orders FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM production_jobs pj
      WHERE pj.id = job_product_orders.job_id
      AND pj.org_id = (SELECT u.org_id FROM users u WHERE u.id = auth.uid())
    )
  );

-- Delete: admin only
CREATE POLICY "Admins can delete product orders"
  ON job_product_orders FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM users u 
      WHERE u.id = auth.uid() 
      AND u.org_id = job_product_orders.org_id
      AND u.role = 'admin'
    )
  );

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_job_product_orders_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_job_product_orders_updated_at ON job_product_orders;
CREATE TRIGGER trigger_job_product_orders_updated_at
  BEFORE UPDATE ON job_product_orders
  FOR EACH ROW
  EXECUTE FUNCTION update_job_product_orders_updated_at();

-- Comments
COMMENT ON TABLE job_product_orders IS 'Material and product orders for production jobs';
COMMENT ON COLUMN job_product_orders.status IS 'Order status: ordered, received, paid, returned';
