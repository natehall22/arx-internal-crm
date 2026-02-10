-- Proposal Integrations and Roof Measurements
-- Migration: 019_proposal_integrations_measurements.sql

-- Integration provider types
CREATE TYPE integration_provider AS ENUM (
  'eagleview',
  'roofr',
  'solo',
  'aurora',
  'gaf_quickmeasure',
  'hover',
  'nearmap',
  'google_solar'
);

-- Measurement status
CREATE TYPE measurement_status AS ENUM (
  'pending',
  'processing',
  'completed',
  'failed'
);

-- Roof type enum
CREATE TYPE roof_material AS ENUM (
  'asphalt_shingle',
  'metal',
  'tile',
  'slate',
  'wood_shake',
  'flat_membrane',
  'other'
);

-- External integrations configuration
CREATE TABLE integration_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  provider integration_provider NOT NULL,
  is_enabled BOOLEAN DEFAULT false,
  
  -- API credentials (encrypted in practice)
  api_key TEXT,
  api_secret TEXT,
  client_id TEXT,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  
  -- Provider-specific settings
  settings JSONB DEFAULT '{}',
  
  -- Webhook URL for callbacks
  webhook_url TEXT,
  webhook_secret TEXT,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  UNIQUE(org_id, provider)
);

CREATE INDEX idx_integration_configs_org ON integration_configs(org_id);

-- Roof measurements table
CREATE TABLE roof_measurements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  opportunity_id UUID REFERENCES opportunities(id) ON DELETE SET NULL,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  proposal_id UUID REFERENCES proposals(id) ON DELETE SET NULL,
  created_by UUID NOT NULL REFERENCES users(id),
  
  -- Address info
  address_text TEXT NOT NULL,
  lat NUMERIC(10, 7),
  lng NUMERIC(10, 7),
  
  -- Source of measurement
  source TEXT NOT NULL DEFAULT 'manual', -- 'manual', 'eagleview', 'roofr', 'solo', 'aurora', 'in_house'
  external_report_id TEXT, -- ID from external provider
  external_report_url TEXT, -- Link to full report
  
  -- Status
  status measurement_status NOT NULL DEFAULT 'completed',
  
  -- Overall measurements
  total_area_sqft NUMERIC(10, 2),
  total_squares NUMERIC(10, 2), -- total_area / 100
  ridges_lf NUMERIC(10, 2),
  hips_lf NUMERIC(10, 2),
  valleys_lf NUMERIC(10, 2),
  eaves_lf NUMERIC(10, 2),
  rakes_lf NUMERIC(10, 2),
  flashing_lf NUMERIC(10, 2),
  step_flashing_lf NUMERIC(10, 2),
  drip_edge_lf NUMERIC(10, 2),
  
  -- Roof characteristics
  predominant_pitch TEXT, -- e.g., "6/12"
  pitch_count INTEGER, -- number of different pitches
  stories INTEGER DEFAULT 1,
  roof_material roof_material,
  roof_age_years INTEGER,
  
  -- Complexity factors
  facet_count INTEGER,
  penetration_count INTEGER, -- vents, pipes, skylights
  chimney_count INTEGER,
  skylight_count INTEGER,
  
  -- Waste factor
  suggested_waste_percent NUMERIC(5, 2) DEFAULT 10,
  
  -- Raw data from provider
  raw_data JSONB,
  
  -- Satellite/aerial image
  satellite_image_url TEXT,
  annotated_image_url TEXT,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_roof_measurements_org ON roof_measurements(org_id);
CREATE INDEX idx_roof_measurements_opportunity ON roof_measurements(opportunity_id);
CREATE INDEX idx_roof_measurements_address ON roof_measurements(address_text);

-- Roof facets (individual sections)
CREATE TABLE roof_facets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  measurement_id UUID NOT NULL REFERENCES roof_measurements(id) ON DELETE CASCADE,
  
  facet_number INTEGER NOT NULL,
  area_sqft NUMERIC(10, 2) NOT NULL,
  pitch TEXT, -- e.g., "6/12"
  pitch_degrees NUMERIC(5, 2), -- e.g., 26.57
  orientation TEXT, -- N, S, E, W, NE, etc.
  
  -- Polygon coordinates for drawing
  polygon_coords JSONB, -- Array of {lat, lng} points
  
  -- Additional details
  has_penetrations BOOLEAN DEFAULT false,
  notes TEXT,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_roof_facets_measurement ON roof_facets(measurement_id);

-- Measurement requests (for async external API calls)
CREATE TABLE measurement_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  measurement_id UUID REFERENCES roof_measurements(id) ON DELETE SET NULL,
  
  provider integration_provider NOT NULL,
  address_text TEXT NOT NULL,
  lat NUMERIC(10, 7),
  lng NUMERIC(10, 7),
  
  -- Request tracking
  external_order_id TEXT,
  status measurement_status NOT NULL DEFAULT 'pending',
  error_message TEXT,
  
  -- Callback info
  callback_received_at TIMESTAMPTZ,
  
  requested_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_measurement_requests_org ON measurement_requests(org_id);
CREATE INDEX idx_measurement_requests_status ON measurement_requests(status);

-- Triggers
CREATE TRIGGER update_integration_configs_updated_at 
  BEFORE UPDATE ON integration_configs 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_roof_measurements_updated_at 
  BEFORE UPDATE ON roof_measurements 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_measurement_requests_updated_at 
  BEFORE UPDATE ON measurement_requests 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS Policies
ALTER TABLE integration_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE roof_measurements ENABLE ROW LEVEL SECURITY;
ALTER TABLE roof_facets ENABLE ROW LEVEL SECURITY;
ALTER TABLE measurement_requests ENABLE ROW LEVEL SECURITY;

-- Integration configs: admin only
CREATE POLICY "Admins can manage integration configs"
  ON integration_configs FOR ALL
  USING (
    org_id = get_user_org_id(auth.uid())
    AND get_user_role(auth.uid()) IN ('admin', 'regional_manager')
  );

-- Roof measurements: org users can view, create
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

-- Roof facets
CREATE POLICY "Users can manage roof facets"
  ON roof_facets FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM roof_measurements rm
      WHERE rm.id = roof_facets.measurement_id
      AND rm.org_id = get_user_org_id(auth.uid())
    )
  );

-- Measurement requests
CREATE POLICY "Users can view measurement requests"
  ON measurement_requests FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

CREATE POLICY "Users can create measurement requests"
  ON measurement_requests FOR INSERT
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

-- Helper function to calculate squares from sqft
CREATE OR REPLACE FUNCTION sqft_to_squares(sqft NUMERIC)
RETURNS NUMERIC AS $$
BEGIN
  RETURN ROUND(sqft / 100, 2);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Helper function to calculate pitch in degrees
CREATE OR REPLACE FUNCTION pitch_to_degrees(rise INTEGER, run INTEGER DEFAULT 12)
RETURNS NUMERIC AS $$
BEGIN
  RETURN ROUND(DEGREES(ATAN(rise::NUMERIC / run::NUMERIC)), 2);
END;
$$ LANGUAGE plpgsql IMMUTABLE;
