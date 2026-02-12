-- Roofing Types table for different roofing materials with different pricing
CREATE TABLE IF NOT EXISTS roofing_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  -- Pricing unit: 'square' (100 sq ft), 'sqft' (per sq ft), 'lf' (linear foot)
  pricing_unit TEXT NOT NULL DEFAULT 'square',
  -- Pricing (interpreted based on pricing_unit)
  unit_price NUMERIC(10, 2) NOT NULL DEFAULT 350.00,
  material_cost NUMERIC(10, 2),
  labor_cost NUMERIC(10, 2),
  -- Profit margin percentage (0-1000%)
  profit_margin_percent NUMERIC(6, 2),
  -- Labor multipliers (some roofing types take longer)
  labor_multiplier NUMERIC(4, 2) DEFAULT 1.00,
  -- Warranty info
  default_warranty_years INTEGER DEFAULT 10,
  default_warranty_text TEXT,
  -- Display
  color TEXT DEFAULT '#4f46e5',
  icon TEXT,
  sort_order INTEGER DEFAULT 0,
  is_default BOOLEAN DEFAULT false,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_roofing_types_org ON roofing_types(org_id);
CREATE INDEX IF NOT EXISTS idx_roofing_types_active ON roofing_types(org_id, active);

-- RLS policies
ALTER TABLE roofing_types ENABLE ROW LEVEL SECURITY;

-- Users can view roofing types for their org
CREATE POLICY "Users can view roofing types for their org"
  ON roofing_types FOR SELECT
  USING (org_id = (SELECT org_id FROM users WHERE id = auth.uid()));

-- Only admins and operations can manage roofing types
CREATE POLICY "Admins can manage roofing types"
  ON roofing_types FOR ALL
  USING (
    org_id = (SELECT org_id FROM users WHERE id = auth.uid())
    AND (SELECT role FROM users WHERE id = auth.uid()) IN ('admin', 'operations')
  );

-- Insert default roofing types for existing orgs (only if table is empty for that org)
INSERT INTO roofing_types (org_id, name, description, pricing_unit, unit_price, material_cost, labor_cost, labor_multiplier, default_warranty_years, color, sort_order, is_default)
SELECT 
  id as org_id,
  'Asphalt Shingles' as name,
  '3-tab or architectural asphalt shingles - most common residential roofing' as description,
  'square' as pricing_unit,
  350.00 as unit_price,
  125.00 as material_cost,
  145.00 as labor_cost,
  1.00 as labor_multiplier,
  25 as default_warranty_years,
  '#6366f1' as color,
  1 as sort_order,
  true as is_default
FROM orgs
WHERE NOT EXISTS (SELECT 1 FROM roofing_types WHERE roofing_types.org_id = orgs.id);

-- Add more default types
INSERT INTO roofing_types (org_id, name, description, pricing_unit, unit_price, material_cost, labor_cost, labor_multiplier, default_warranty_years, color, sort_order)
SELECT 
  id as org_id,
  'Metal Roofing' as name,
  'Standing seam or metal panels - durable, long-lasting' as description,
  'square' as pricing_unit,
  850.00 as unit_price,
  450.00 as material_cost,
  280.00 as labor_cost,
  1.50 as labor_multiplier,
  50 as default_warranty_years,
  '#64748b' as color,
  2 as sort_order
FROM orgs
WHERE NOT EXISTS (SELECT 1 FROM roofing_types WHERE roofing_types.org_id = orgs.id AND name = 'Metal Roofing');

INSERT INTO roofing_types (org_id, name, description, pricing_unit, unit_price, material_cost, labor_cost, labor_multiplier, default_warranty_years, color, sort_order)
SELECT 
  id as org_id,
  'Tile Roofing' as name,
  'Clay or concrete tiles - premium aesthetic' as description,
  'square' as pricing_unit,
  750.00 as unit_price,
  350.00 as material_cost,
  300.00 as labor_cost,
  1.75 as labor_multiplier,
  50 as default_warranty_years,
  '#dc2626' as color,
  3 as sort_order
FROM orgs
WHERE NOT EXISTS (SELECT 1 FROM roofing_types WHERE roofing_types.org_id = orgs.id AND name = 'Tile Roofing');

INSERT INTO roofing_types (org_id, name, description, pricing_unit, unit_price, material_cost, labor_cost, labor_multiplier, default_warranty_years, color, sort_order)
SELECT 
  id as org_id,
  'Flat/TPO' as name,
  'TPO, EPDM, or modified bitumen - commercial and low-slope' as description,
  'sqft' as pricing_unit,
  4.50 as unit_price,
  1.80 as material_cost,
  2.00 as labor_cost,
  1.25 as labor_multiplier,
  20 as default_warranty_years,
  '#0891b2' as color,
  4 as sort_order
FROM orgs
WHERE NOT EXISTS (SELECT 1 FROM roofing_types WHERE roofing_types.org_id = orgs.id AND name = 'Flat/TPO');

INSERT INTO roofing_types (org_id, name, description, pricing_unit, unit_price, material_cost, labor_cost, labor_multiplier, default_warranty_years, color, sort_order)
SELECT 
  id as org_id,
  'Wood Shake' as name,
  'Cedar shakes or shingles - natural aesthetic' as description,
  'square' as pricing_unit,
  650.00 as unit_price,
  300.00 as material_cost,
  250.00 as labor_cost,
  1.40 as labor_multiplier,
  30 as default_warranty_years,
  '#a16207' as color,
  5 as sort_order
FROM orgs
WHERE NOT EXISTS (SELECT 1 FROM roofing_types WHERE roofing_types.org_id = orgs.id AND name = 'Wood Shake');

INSERT INTO roofing_types (org_id, name, description, pricing_unit, unit_price, material_cost, labor_cost, labor_multiplier, default_warranty_years, color, sort_order)
SELECT 
  id as org_id,
  'Slate' as name,
  'Natural or synthetic slate - premium, long-lasting' as description,
  'square' as pricing_unit,
  1200.00 as unit_price,
  650.00 as material_cost,
  400.00 as labor_cost,
  2.00 as labor_multiplier,
  75 as default_warranty_years,
  '#1e293b' as color,
  6 as sort_order
FROM orgs
WHERE NOT EXISTS (SELECT 1 FROM roofing_types WHERE roofing_types.org_id = orgs.id AND name = 'Slate');

-- Gutters example - priced per linear foot
INSERT INTO roofing_types (org_id, name, description, pricing_unit, unit_price, material_cost, labor_cost, default_warranty_years, color, sort_order)
SELECT 
  id as org_id,
  'Gutters (5" Seamless)' as name,
  'Standard 5-inch seamless aluminum gutters' as description,
  'lf' as pricing_unit,
  12.00 as unit_price,
  4.00 as material_cost,
  6.00 as labor_cost,
  10 as default_warranty_years,
  '#059669' as color,
  7 as sort_order
FROM orgs
WHERE NOT EXISTS (SELECT 1 FROM roofing_types WHERE roofing_types.org_id = orgs.id AND name = 'Gutters (5" Seamless)');

-- Add roofing_type_id to proposals table if it exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'proposals') THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'proposals' AND column_name = 'roofing_type_id') THEN
      ALTER TABLE proposals ADD COLUMN roofing_type_id UUID REFERENCES roofing_types(id);
    END IF;
  END IF;
END $$;

-- Add profit_margin_percent column if it doesn't exist (for existing tables)
ALTER TABLE roofing_types ADD COLUMN IF NOT EXISTS profit_margin_percent NUMERIC(6, 2);

-- Update trigger for updated_at
CREATE OR REPLACE FUNCTION update_roofing_types_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS roofing_types_updated_at ON roofing_types;
CREATE TRIGGER roofing_types_updated_at
  BEFORE UPDATE ON roofing_types
  FOR EACH ROW
  EXECUTE FUNCTION update_roofing_types_updated_at();
