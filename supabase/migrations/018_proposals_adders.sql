-- Proposals, Adders, and Pricing Visibility System
-- Migration: 018_proposals_adders.sql

-- Pricing visibility levels
CREATE TYPE pricing_visibility AS ENUM (
  'admin_only',      -- Only admins can see
  'managers',        -- Admins and managers
  'sales_reps',      -- All sales roles
  'all'              -- Everyone
);

-- Proposal status
CREATE TYPE proposal_status AS ENUM (
  'draft',
  'sent',
  'viewed',
  'accepted',
  'declined',
  'expired'
);

-- Add visibility to pricebook items
ALTER TABLE pricebook_items ADD COLUMN IF NOT EXISTS visibility pricing_visibility DEFAULT 'sales_reps';
ALTER TABLE pricebook_items ADD COLUMN IF NOT EXISTS show_to_customer BOOLEAN DEFAULT false;
ALTER TABLE pricebook_items ADD COLUMN IF NOT EXISTS is_adder BOOLEAN DEFAULT false;
ALTER TABLE pricebook_items ADD COLUMN IF NOT EXISTS adder_category TEXT;

-- Adder categories for organizing adders
CREATE TABLE adder_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER DEFAULT 0,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_adder_categories_org ON adder_categories(org_id);

-- Proposals table
CREATE TABLE proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  opportunity_id UUID REFERENCES opportunities(id) ON DELETE SET NULL,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  created_by UUID NOT NULL REFERENCES users(id),
  
  -- Customer info (snapshot at time of proposal)
  customer_name TEXT NOT NULL,
  customer_email TEXT,
  customer_phone TEXT,
  customer_address TEXT NOT NULL,
  
  -- Proposal details
  proposal_number TEXT NOT NULL,
  title TEXT DEFAULT 'Roofing Proposal',
  status proposal_status NOT NULL DEFAULT 'draft',
  
  -- Pricing
  subtotal NUMERIC(12, 2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(12, 2) DEFAULT 0,
  discount_percent NUMERIC(5, 2) DEFAULT 0,
  tax_rate NUMERIC(5, 2) DEFAULT 0,
  tax_amount NUMERIC(12, 2) DEFAULT 0,
  total NUMERIC(12, 2) NOT NULL DEFAULT 0,
  
  -- Financing options
  financing_available BOOLEAN DEFAULT false,
  financing_term_months INTEGER,
  financing_rate NUMERIC(5, 2),
  monthly_payment NUMERIC(10, 2),
  
  -- Content sections (JSON for flexibility)
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

CREATE INDEX idx_proposals_org ON proposals(org_id);
CREATE INDEX idx_proposals_opportunity ON proposals(opportunity_id);
CREATE INDEX idx_proposals_status ON proposals(status);
CREATE INDEX idx_proposals_created_by ON proposals(created_by);

-- Proposal line items
CREATE TABLE proposal_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  proposal_id UUID NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  pricebook_item_id UUID REFERENCES pricebook_items(id) ON DELETE SET NULL,
  
  -- Item details (snapshot)
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  unit TEXT NOT NULL,
  quantity NUMERIC(10, 2) NOT NULL DEFAULT 1,
  unit_price NUMERIC(10, 2) NOT NULL,
  line_total NUMERIC(12, 2) NOT NULL,
  
  -- Display options
  is_adder BOOLEAN DEFAULT false,
  show_on_pdf BOOLEAN DEFAULT false, -- Only total shows, not line items
  sort_order INTEGER DEFAULT 0,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_proposal_items_proposal ON proposal_line_items(proposal_id);

-- Proposal templates (admin customizable)
CREATE TABLE proposal_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_default BOOLEAN DEFAULT false,
  
  -- Template styling
  accent_color TEXT DEFAULT '#4f46e5',
  secondary_color TEXT DEFAULT '#6366f1',
  font_family TEXT DEFAULT 'Inter',
  
  -- Header/Footer
  header_html TEXT,
  footer_html TEXT,
  cover_page_enabled BOOLEAN DEFAULT true,
  cover_image_url TEXT,
  
  -- Sections to include
  show_scope_of_work BOOLEAN DEFAULT true,
  show_materials BOOLEAN DEFAULT true,
  show_warranty BOOLEAN DEFAULT true,
  show_terms BOOLEAN DEFAULT true,
  show_financing BOOLEAN DEFAULT true,
  show_company_info BOOLEAN DEFAULT true,
  show_rep_info BOOLEAN DEFAULT true,
  
  -- Default content
  default_scope_of_work TEXT,
  default_warranty_info TEXT,
  default_terms_conditions TEXT,
  
  -- Custom CSS
  custom_css TEXT,
  
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_proposal_templates_org ON proposal_templates(org_id);

-- Proposal photos/attachments
CREATE TABLE proposal_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  proposal_id UUID NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  caption TEXT,
  photo_type TEXT DEFAULT 'inspection', -- inspection, damage, before, after
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_proposal_photos_proposal ON proposal_photos(proposal_id);

-- Triggers
CREATE TRIGGER update_proposals_updated_at 
  BEFORE UPDATE ON proposals 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_proposal_templates_updated_at 
  BEFORE UPDATE ON proposal_templates 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS Policies
ALTER TABLE adder_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposal_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposal_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposal_photos ENABLE ROW LEVEL SECURITY;

-- Adder categories: all can view, admins manage
CREATE POLICY "Users can view adder categories"
  ON adder_categories FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

CREATE POLICY "Admins can manage adder categories"
  ON adder_categories FOR ALL
  USING (
    org_id = get_user_org_id(auth.uid())
    AND get_user_role(auth.uid()) IN ('admin', 'regional_manager')
  );

-- Proposals: users see their own or if manager
CREATE POLICY "Users can view proposals"
  ON proposals FOR SELECT
  USING (
    org_id = get_user_org_id(auth.uid())
    AND (
      created_by = auth.uid()
      OR get_user_role(auth.uid()) IN ('admin', 'regional_manager', 'sales_manager')
    )
  );

CREATE POLICY "Users can create proposals"
  ON proposals FOR INSERT
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

CREATE POLICY "Users can update their proposals"
  ON proposals FOR UPDATE
  USING (
    org_id = get_user_org_id(auth.uid())
    AND (
      created_by = auth.uid()
      OR get_user_role(auth.uid()) IN ('admin', 'regional_manager', 'sales_manager')
    )
  );

-- Proposal line items
CREATE POLICY "Users can manage proposal line items"
  ON proposal_line_items FOR ALL
  USING (org_id = get_user_org_id(auth.uid()));

-- Proposal templates: all view, admins manage
CREATE POLICY "Users can view proposal templates"
  ON proposal_templates FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

CREATE POLICY "Admins can manage proposal templates"
  ON proposal_templates FOR ALL
  USING (
    org_id = get_user_org_id(auth.uid())
    AND get_user_role(auth.uid()) IN ('admin', 'regional_manager')
  );

-- Proposal photos
CREATE POLICY "Users can manage proposal photos"
  ON proposal_photos FOR ALL
  USING (org_id = get_user_org_id(auth.uid()));

-- Function to generate proposal number
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

-- Function to check if user can view pricing item
CREATE OR REPLACE FUNCTION can_view_pricing_item(p_item_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_visibility pricing_visibility;
  v_role TEXT;
BEGIN
  SELECT visibility INTO v_visibility
  FROM pricebook_items
  WHERE id = p_item_id;
  
  IF v_visibility IS NULL THEN
    RETURN true;
  END IF;
  
  v_role := get_user_role(auth.uid());
  
  CASE v_visibility
    WHEN 'admin_only' THEN
      RETURN v_role IN ('admin');
    WHEN 'managers' THEN
      RETURN v_role IN ('admin', 'regional_manager', 'sales_manager', 'manager');
    WHEN 'sales_reps' THEN
      RETURN v_role IN ('admin', 'regional_manager', 'sales_manager', 'manager', 'sales_rep', 'rep');
    WHEN 'all' THEN
      RETURN true;
    ELSE
      RETURN true;
  END CASE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Insert default adder categories
-- (Will be inserted per-org when needed)
