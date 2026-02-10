-- Proposals table (simplified - no helper functions)
-- Run this in Supabase SQL Editor if proposals table doesn't exist

CREATE TABLE IF NOT EXISTS proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  opportunity_id UUID,
  project_id UUID,
  created_by UUID NOT NULL REFERENCES users(id),
  
  -- Customer info
  customer_name TEXT NOT NULL,
  customer_email TEXT,
  customer_phone TEXT,
  customer_address TEXT NOT NULL,
  
  -- Proposal details
  proposal_number TEXT NOT NULL,
  title TEXT DEFAULT 'Roofing Proposal',
  status TEXT NOT NULL DEFAULT 'draft',
  
  -- Pricing
  subtotal NUMERIC(12, 2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(12, 2) DEFAULT 0,
  discount_percent NUMERIC(5, 2) DEFAULT 0,
  tax_rate NUMERIC(5, 2) DEFAULT 0,
  tax_amount NUMERIC(12, 2) DEFAULT 0,
  total NUMERIC(12, 2) NOT NULL DEFAULT 0,
  
  -- Financing
  financing_available BOOLEAN DEFAULT false,
  financing_term_months INTEGER,
  financing_rate NUMERIC(5, 2),
  monthly_payment NUMERIC(10, 2),
  
  -- Content
  scope_of_work TEXT,
  materials_description TEXT,
  warranty_info TEXT,
  terms_conditions TEXT,
  custom_sections JSONB DEFAULT '[]',
  
  -- Presentation
  cover_image_url TEXT,
  company_logo_url TEXT,
  accent_color TEXT DEFAULT '#4f46e5',
  
  -- Tracking
  sent_at TIMESTAMPTZ,
  viewed_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  declined_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  signature_url TEXT,
  signed_at TIMESTAMPTZ,
  
  -- PDF
  pdf_url TEXT,
  pdf_generated_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Proposal line items table
CREATE TABLE IF NOT EXISTS proposal_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  proposal_id UUID NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  pricebook_item_id UUID,
  
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  unit TEXT NOT NULL,
  quantity NUMERIC(10, 2) NOT NULL DEFAULT 1,
  unit_price NUMERIC(10, 2) NOT NULL,
  line_total NUMERIC(12, 2) NOT NULL,
  
  is_adder BOOLEAN DEFAULT false,
  show_on_pdf BOOLEAN DEFAULT false,
  sort_order INTEGER DEFAULT 0,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_proposals_org ON proposals(org_id);
CREATE INDEX IF NOT EXISTS idx_proposals_opportunity ON proposals(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status);
CREATE INDEX IF NOT EXISTS idx_proposal_items_proposal ON proposal_line_items(proposal_id);

-- Enable RLS
ALTER TABLE proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposal_line_items ENABLE ROW LEVEL SECURITY;

-- Simple RLS policies
DROP POLICY IF EXISTS "Users can view proposals" ON proposals;
DROP POLICY IF EXISTS "Users can create proposals" ON proposals;
DROP POLICY IF EXISTS "Users can update proposals" ON proposals;
DROP POLICY IF EXISTS "Users can manage proposal line items" ON proposal_line_items;

CREATE POLICY "Users can view proposals"
  ON proposals FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Users can create proposals"
  ON proposals FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Users can update proposals"
  ON proposals FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Users can manage proposal line items"
  ON proposal_line_items FOR ALL
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

-- Function to generate proposal number (simple version)
CREATE OR REPLACE FUNCTION generate_proposal_number(p_org_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_count INTEGER;
  v_year TEXT;
BEGIN
  v_year := to_char(NOW(), 'YY');
  
  SELECT COUNT(*) + 1 INTO v_count
  FROM proposals
  WHERE org_id = p_org_id
    AND created_at >= date_trunc('year', NOW());
  
  RETURN 'P' || v_year || '-' || LPAD(v_count::TEXT, 4, '0');
END;
$$ LANGUAGE plpgsql;
