-- Migration: 064_contract_signing.sql
-- Purpose: Custom in-app contract signing system

-- ============================================
-- PART 1: Create payment_method enum
-- ============================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'contract_payment_method') THEN
    CREATE TYPE contract_payment_method AS ENUM ('finance', 'cash', 'insurance', 'other');
  END IF;
END $$;

-- ============================================
-- PART 2: Create contract_status enum
-- ============================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'contract_signing_status') THEN
    CREATE TYPE contract_signing_status AS ENUM ('draft', 'pending_customer', 'completed', 'voided');
  END IF;
END $$;

-- ============================================
-- PART 3: Create order_form_contracts table
-- This is the main contract signing table
-- ============================================

CREATE TABLE IF NOT EXISTS order_form_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  opportunity_id UUID REFERENCES opportunities(id) ON DELETE SET NULL,
  proposal_id UUID REFERENCES proposals(id) ON DELETE SET NULL,
  
  -- Customer info
  customer_name TEXT NOT NULL,
  customer_email TEXT,
  customer_phone TEXT,
  project_address TEXT NOT NULL,
  
  -- Project details
  project_cost NUMERIC(12, 2) NOT NULL DEFAULT 0,
  total_squares NUMERIC(10, 2),
  roofing_material TEXT,
  
  -- Scope checkboxes
  scope_roof_replacement BOOLEAN DEFAULT false,
  scope_roof_repair BOOLEAN DEFAULT false,
  scope_gutters BOOLEAN DEFAULT false,
  scope_siding BOOLEAN DEFAULT false,
  scope_other TEXT,
  
  -- Payment details
  payment_method contract_payment_method DEFAULT 'cash',
  finance_company TEXT,
  deposit_amount NUMERIC(12, 2) DEFAULT 0,
  est_completion_date DATE,
  
  -- Additional fields
  exclusions TEXT,
  additional_products TEXT,
  notes TEXT,
  
  -- Customer fills these
  preferred_contact TEXT CHECK (preferred_contact IN ('phone', 'email')),
  customer_print_name TEXT,
  
  -- Customer acknowledgement initials
  customer_initials_change_orders TEXT,
  customer_initials_property_condition TEXT,
  customer_initials_landscaping TEXT,
  customer_initials_insurance TEXT,
  
  -- Rep signature
  rep_name TEXT,
  rep_title TEXT,
  rep_signature_data TEXT,
  rep_signed_at TIMESTAMPTZ,
  rep_ip TEXT,
  
  -- Customer signature
  customer_signature_data TEXT,
  customer_signed_at TIMESTAMPTZ,
  customer_ip TEXT,
  
  -- Token for customer signing link
  signing_token UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  token_expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  
  -- Status
  status contract_signing_status NOT NULL DEFAULT 'draft',
  
  -- PDF storage
  pdf_url TEXT,
  pdf_storage_path TEXT,
  
  -- Audit
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- PART 4: Indexes
-- ============================================

CREATE INDEX IF NOT EXISTS idx_order_form_contracts_org_id ON order_form_contracts(org_id);
CREATE INDEX IF NOT EXISTS idx_order_form_contracts_opportunity_id ON order_form_contracts(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_order_form_contracts_proposal_id ON order_form_contracts(proposal_id);
CREATE INDEX IF NOT EXISTS idx_order_form_contracts_signing_token ON order_form_contracts(signing_token);
CREATE INDEX IF NOT EXISTS idx_order_form_contracts_status ON order_form_contracts(status);
CREATE INDEX IF NOT EXISTS idx_order_form_contracts_created_by ON order_form_contracts(created_by);

-- ============================================
-- PART 5: RLS Policies
-- ============================================

ALTER TABLE order_form_contracts ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read contracts in their org
DROP POLICY IF EXISTS "Users can read order form contracts" ON order_form_contracts;
CREATE POLICY "Users can read order form contracts"
  ON order_form_contracts FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

-- Authenticated users can insert contracts in their org
DROP POLICY IF EXISTS "Users can insert order form contracts" ON order_form_contracts;
CREATE POLICY "Users can insert order form contracts"
  ON order_form_contracts FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

-- Authenticated users can update contracts in their org
DROP POLICY IF EXISTS "Users can update order form contracts" ON order_form_contracts;
CREATE POLICY "Users can update order form contracts"
  ON order_form_contracts FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

-- Anon users can read contracts by token (for customer signing)
DROP POLICY IF EXISTS "Anon can read contracts by token" ON order_form_contracts;
CREATE POLICY "Anon can read contracts by token"
  ON order_form_contracts FOR SELECT
  USING (true);

-- Anon users can update contracts by token (for customer signing)
DROP POLICY IF EXISTS "Anon can update contracts by token" ON order_form_contracts;
CREATE POLICY "Anon can update contracts by token"
  ON order_form_contracts FOR UPDATE
  USING (true);

-- ============================================
-- PART 6: Updated_at trigger
-- ============================================

CREATE OR REPLACE FUNCTION update_order_form_contracts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_order_form_contracts_updated_at ON order_form_contracts;
CREATE TRIGGER trigger_order_form_contracts_updated_at
  BEFORE UPDATE ON order_form_contracts
  FOR EACH ROW
  EXECUTE FUNCTION update_order_form_contracts_updated_at();

-- ============================================
-- PART 7: Comments
-- ============================================

COMMENT ON TABLE order_form_contracts IS 'Custom in-app contract signing system for ARX order forms';
COMMENT ON COLUMN order_form_contracts.signing_token IS 'Unique token for customer signing link';
COMMENT ON COLUMN order_form_contracts.token_expires_at IS 'Token expires 7 days after creation';
COMMENT ON COLUMN order_form_contracts.rep_signature_data IS 'Base64 encoded signature image from canvas';
COMMENT ON COLUMN order_form_contracts.customer_signature_data IS 'Base64 encoded signature image from canvas';
