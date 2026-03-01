-- Customer search optimization and normalized fields
-- Enables fast duplicate detection and linking

-- Add normalized search columns to customers
ALTER TABLE customers 
ADD COLUMN IF NOT EXISTS phone_normalized TEXT GENERATED ALWAYS AS (
  regexp_replace(phone, '[^0-9]', '', 'g')
) STORED,
ADD COLUMN IF NOT EXISTS email_lower TEXT GENERATED ALWAYS AS (
  lower(trim(email))
) STORED;

-- Indexes for fast customer search/dedup
CREATE INDEX IF NOT EXISTS idx_customers_phone_normalized ON customers(org_id, phone_normalized) 
  WHERE phone_normalized IS NOT NULL AND phone_normalized != '';
CREATE INDEX IF NOT EXISTS idx_customers_email_lower ON customers(org_id, email_lower) 
  WHERE email_lower IS NOT NULL AND email_lower != '';
CREATE INDEX IF NOT EXISTS idx_customers_name_search ON customers(org_id, lower(name));

-- Ensure opportunities has customer_id (should exist from 011)
ALTER TABLE opportunities 
ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_opportunities_customer_id ON opportunities(customer_id) 
  WHERE customer_id IS NOT NULL;

-- Index for finding records without customers
CREATE INDEX IF NOT EXISTS idx_opportunities_no_customer ON opportunities(org_id, created_at DESC) 
  WHERE customer_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_projects_no_customer ON projects(org_id, created_at DESC) 
  WHERE customer_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_production_jobs_no_customer ON production_jobs(org_id, created_at DESC) 
  WHERE customer_id IS NULL;
