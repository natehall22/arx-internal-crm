-- Roof measurements table (simplified)
-- Run this in Supabase SQL Editor if tables don't exist

-- Check if table exists first, create if not
CREATE TABLE IF NOT EXISTS roof_measurements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  opportunity_id UUID,
  project_id UUID,
  proposal_id UUID,
  created_by UUID NOT NULL REFERENCES users(id),
  
  -- Address info
  address_text TEXT NOT NULL,
  lat NUMERIC(10, 7),
  lng NUMERIC(10, 7),
  
  -- Source of measurement
  source TEXT NOT NULL DEFAULT 'manual',
  external_report_id TEXT,
  external_report_url TEXT,
  
  -- Status
  status TEXT NOT NULL DEFAULT 'completed',
  
  -- Overall measurements
  total_area_sqft NUMERIC(10, 2),
  total_squares NUMERIC(10, 2),
  ridges_lf NUMERIC(10, 2),
  hips_lf NUMERIC(10, 2),
  valleys_lf NUMERIC(10, 2),
  eaves_lf NUMERIC(10, 2),
  rakes_lf NUMERIC(10, 2),
  flashing_lf NUMERIC(10, 2),
  step_flashing_lf NUMERIC(10, 2),
  drip_edge_lf NUMERIC(10, 2),
  
  -- Roof characteristics
  predominant_pitch TEXT,
  pitch_count INTEGER,
  stories INTEGER DEFAULT 1,
  roof_material TEXT,
  roof_age_years INTEGER,
  
  -- Complexity factors
  facet_count INTEGER,
  penetration_count INTEGER,
  chimney_count INTEGER,
  skylight_count INTEGER,
  
  -- Waste factor
  suggested_waste_percent NUMERIC(5, 2) DEFAULT 10,
  
  -- Raw data
  raw_data JSONB,
  
  -- Images
  satellite_image_url TEXT,
  annotated_image_url TEXT,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Roof facets table
CREATE TABLE IF NOT EXISTS roof_facets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  measurement_id UUID NOT NULL REFERENCES roof_measurements(id) ON DELETE CASCADE,
  
  facet_number INTEGER NOT NULL,
  area_sqft NUMERIC(10, 2) NOT NULL,
  pitch TEXT,
  pitch_degrees NUMERIC(5, 2),
  orientation TEXT,
  
  -- Polygon coordinates
  polygon_coords JSONB,
  
  has_penetrations BOOLEAN DEFAULT false,
  notes TEXT,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_roof_measurements_org ON roof_measurements(org_id);
CREATE INDEX IF NOT EXISTS idx_roof_measurements_opportunity ON roof_measurements(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_roof_facets_measurement ON roof_facets(measurement_id);

-- Enable RLS
ALTER TABLE roof_measurements ENABLE ROW LEVEL SECURITY;
ALTER TABLE roof_facets ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (to avoid errors)
DROP POLICY IF EXISTS "Users can view roof measurements" ON roof_measurements;
DROP POLICY IF EXISTS "Users can create roof measurements" ON roof_measurements;
DROP POLICY IF EXISTS "Users can update their measurements" ON roof_measurements;
DROP POLICY IF EXISTS "Users can manage roof facets" ON roof_facets;

-- RLS Policies for roof_measurements
CREATE POLICY "Users can view roof measurements"
  ON roof_measurements FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

CREATE POLICY "Users can create roof measurements"
  ON roof_measurements FOR INSERT
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

CREATE POLICY "Users can update their measurements"
  ON roof_measurements FOR UPDATE
  USING (
    org_id = get_user_org_id(auth.uid())
    AND (
      created_by = auth.uid()
      OR get_user_role(auth.uid()) IN ('admin', 'regional_manager', 'sales_manager')
    )
  );

-- RLS Policies for roof_facets
CREATE POLICY "Users can manage roof facets"
  ON roof_facets FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM roof_measurements rm
      WHERE rm.id = roof_facets.measurement_id
      AND rm.org_id = get_user_org_id(auth.uid())
    )
  );
