-- Expanded RBAC with Teams and Regions
-- Migration: 013_rbac_teams_regions.sql

-- Create new expanded user_role enum
-- We need to create a new type and migrate because PostgreSQL doesn't support adding values in transactions easily
ALTER TYPE user_role RENAME TO user_role_old;

CREATE TYPE user_role AS ENUM (
  'admin',
  'regional_manager',
  'sales_manager', 
  'sales_rep',
  'canvasser',
  'operations'
);

-- Update users table to use new enum (with default mapping)
ALTER TABLE users 
  ALTER COLUMN role DROP DEFAULT;

ALTER TABLE users 
  ALTER COLUMN role TYPE user_role 
  USING (
    CASE role::text
      WHEN 'admin' THEN 'admin'::user_role
      WHEN 'manager' THEN 'sales_manager'::user_role
      WHEN 'rep' THEN 'sales_rep'::user_role
      ELSE 'sales_rep'::user_role
    END
  );

ALTER TABLE users 
  ALTER COLUMN role SET DEFAULT 'sales_rep';

DROP TYPE user_role_old;

-- Create regions table
CREATE TABLE regions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_regions_org_id ON regions(org_id);

-- Create teams table
CREATE TABLE teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  region_id UUID REFERENCES regions(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_teams_org_id ON teams(org_id);
CREATE INDEX idx_teams_region_id ON teams(region_id);

-- Add team_id and region_id to users
ALTER TABLE users 
  ADD COLUMN team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  ADD COLUMN region_id UUID REFERENCES regions(id) ON DELETE SET NULL;

CREATE INDEX idx_users_team_id ON users(team_id);
CREATE INDEX idx_users_region_id ON users(region_id);

-- Create team_closer_queue for round-robin scheduling
CREATE TABLE team_closer_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  priority INTEGER NOT NULL DEFAULT 0, -- Lower = higher priority (based on close rate)
  buffer_minutes INTEGER NOT NULL DEFAULT 60, -- Buffer time between appointments
  active BOOLEAN NOT NULL DEFAULT true,
  last_assigned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(team_id, user_id)
);

CREATE INDEX idx_team_closer_queue_team_id ON team_closer_queue(team_id);
CREATE INDEX idx_team_closer_queue_user_id ON team_closer_queue(user_id);
CREATE INDEX idx_team_closer_queue_priority ON team_closer_queue(team_id, priority) WHERE active = true;

-- Create user_google_tokens for calendar integration
CREATE TABLE user_google_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_type TEXT NOT NULL DEFAULT 'Bearer',
  expires_at TIMESTAMPTZ NOT NULL,
  scope TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id)
);

CREATE INDEX idx_user_google_tokens_user_id ON user_google_tokens(user_id);

-- Create scheduled_appointments for tracking calendar events
CREATE TABLE scheduled_appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  opportunity_id UUID REFERENCES opportunities(id) ON DELETE SET NULL,
  closer_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  canvasser_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  google_event_id TEXT,
  scheduled_for TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 60,
  status TEXT NOT NULL DEFAULT 'scheduled', -- scheduled, completed, cancelled, no_show
  address_text TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_scheduled_appointments_closer ON scheduled_appointments(closer_user_id, scheduled_for);
CREATE INDEX idx_scheduled_appointments_lead ON scheduled_appointments(lead_id);
CREATE INDEX idx_scheduled_appointments_opportunity ON scheduled_appointments(opportunity_id);

-- Apply updated_at triggers
CREATE TRIGGER update_regions_updated_at BEFORE UPDATE ON regions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_teams_updated_at BEFORE UPDATE ON teams FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_team_closer_queue_updated_at BEFORE UPDATE ON team_closer_queue FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_user_google_tokens_updated_at BEFORE UPDATE ON user_google_tokens FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_scheduled_appointments_updated_at BEFORE UPDATE ON scheduled_appointments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS Policies for regions
ALTER TABLE regions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view regions in their org"
  ON regions FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

CREATE POLICY "Admins and regional managers can manage regions"
  ON regions FOR ALL
  USING (
    org_id = get_user_org_id(auth.uid()) 
    AND EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() 
      AND role IN ('admin', 'regional_manager')
    )
  );

-- RLS Policies for teams
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view teams in their org"
  ON teams FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

CREATE POLICY "Admins and managers can manage teams"
  ON teams FOR ALL
  USING (
    org_id = get_user_org_id(auth.uid()) 
    AND EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() 
      AND role IN ('admin', 'regional_manager', 'sales_manager')
    )
  );

-- RLS Policies for team_closer_queue
ALTER TABLE team_closer_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view closer queue in their org"
  ON team_closer_queue FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

CREATE POLICY "Managers can manage closer queue"
  ON team_closer_queue FOR ALL
  USING (
    org_id = get_user_org_id(auth.uid()) 
    AND EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() 
      AND role IN ('admin', 'regional_manager', 'sales_manager')
    )
  );

-- RLS Policies for user_google_tokens
ALTER TABLE user_google_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own tokens"
  ON user_google_tokens FOR ALL
  USING (user_id = auth.uid());

-- RLS Policies for scheduled_appointments
ALTER TABLE scheduled_appointments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view appointments in their org"
  ON scheduled_appointments FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

CREATE POLICY "Users can create appointments"
  ON scheduled_appointments FOR INSERT
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

CREATE POLICY "Managers and assigned users can update appointments"
  ON scheduled_appointments FOR UPDATE
  USING (
    org_id = get_user_org_id(auth.uid()) 
    AND (
      closer_user_id = auth.uid()
      OR canvasser_user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM users 
        WHERE id = auth.uid() 
        AND role IN ('admin', 'regional_manager', 'sales_manager', 'operations')
      )
    )
  );

-- Helper function to check user role
CREATE OR REPLACE FUNCTION get_user_role(user_uuid UUID)
RETURNS user_role AS $$
  SELECT role FROM users WHERE id = user_uuid;
$$ LANGUAGE sql SECURITY DEFINER;

-- Helper function to check if user can edit opportunities
CREATE OR REPLACE FUNCTION can_edit_opportunities(user_uuid UUID)
RETURNS BOOLEAN AS $$
  SELECT role IN ('admin', 'regional_manager', 'sales_manager', 'sales_rep', 'operations') 
  FROM users WHERE id = user_uuid;
$$ LANGUAGE sql SECURITY DEFINER;

-- Helper function to check if user can edit projects
CREATE OR REPLACE FUNCTION can_edit_projects(user_uuid UUID)
RETURNS BOOLEAN AS $$
  SELECT role IN ('admin', 'regional_manager', 'sales_manager', 'operations') 
  FROM users WHERE id = user_uuid;
$$ LANGUAGE sql SECURITY DEFINER;

-- Helper function to check if user can manage teams
CREATE OR REPLACE FUNCTION can_manage_teams(user_uuid UUID)
RETURNS BOOLEAN AS $$
  SELECT role IN ('admin', 'regional_manager', 'sales_manager') 
  FROM users WHERE id = user_uuid;
$$ LANGUAGE sql SECURITY DEFINER;

-- Helper function to check if user can manage regions
CREATE OR REPLACE FUNCTION can_manage_regions(user_uuid UUID)
RETURNS BOOLEAN AS $$
  SELECT role IN ('admin', 'regional_manager') 
  FROM users WHERE id = user_uuid;
$$ LANGUAGE sql SECURITY DEFINER;
