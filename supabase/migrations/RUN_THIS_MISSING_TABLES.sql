-- MISSING TABLES MIGRATION
-- Run this in Supabase SQL Editor to add missing tables
-- This is safe to run - it uses IF NOT EXISTS

-- ============================================
-- 0. PREREQUISITES - ENUMS
-- ============================================

DO $$ 
BEGIN
  CREATE TYPE opportunity_status AS ENUM ('open', 'in_progress', 'won', 'lost');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ 
BEGIN
  CREATE TYPE project_type AS ENUM ('roofing', 'siding', 'windows', 'gutters', 'solar', 'other');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ 
BEGIN
  CREATE TYPE lead_channel AS ENUM ('inbound', 'outbound');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ 
BEGIN
  CREATE TYPE report_type AS ENUM ('metric_card', 'bar_chart', 'line_chart', 'pie_chart', 'table', 'funnel');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ 
BEGIN
  CREATE TYPE report_data_source AS ENUM ('leads', 'opportunities', 'projects', 'appointments', 'inspection_outcomes');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ============================================
-- 1. OPPORTUNITIES TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  customer_id UUID,
  lead_id UUID,
  owner_user_id UUID,
  status opportunity_status NOT NULL DEFAULT 'open',
  project_type project_type NOT NULL DEFAULT 'roofing',
  address_text TEXT,
  lat NUMERIC(10, 8),
  lng NUMERIC(11, 8),
  roof_squares NUMERIC(10, 2),
  siding_squares NUMERIC(10, 2),
  vents_count INTEGER NOT NULL DEFAULT 0,
  layers INTEGER NOT NULL DEFAULT 1,
  total_windows INTEGER NOT NULL DEFAULT 0,
  windows_by_type JSONB,
  notes TEXT,
  design_pdf_path TEXT,
  inspection_outcome TEXT,
  estimated_value NUMERIC(12, 2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS inspection_outcome TEXT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS estimated_value NUMERIC(12, 2);

CREATE INDEX IF NOT EXISTS idx_opportunities_org_id ON opportunities(org_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_status ON opportunities(status);

-- ============================================
-- 2. REGIONS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS regions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_regions_org_id ON regions(org_id);

-- ============================================
-- 3. TEAMS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  region_id UUID,
  name TEXT NOT NULL,
  timezone TEXT DEFAULT 'America/New_York',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE teams ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'America/New_York';

CREATE INDEX IF NOT EXISTS idx_teams_org_id ON teams(org_id);

-- ============================================
-- 4. USER COLUMNS
-- ============================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS team_id UUID;
ALTER TABLE users ADD COLUMN IF NOT EXISTS region_id UUID;
ALTER TABLE users ADD COLUMN IF NOT EXISTS canvass_pin_visibility TEXT DEFAULT 'org';

-- ============================================
-- 5. USER SETTINGS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS user_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  notifications_enabled BOOLEAN NOT NULL DEFAULT true,
  email_notifications BOOLEAN NOT NULL DEFAULT true,
  push_notifications BOOLEAN NOT NULL DEFAULT true,
  notification_types JSONB DEFAULT '{}',
  google_calendar_connected BOOLEAN NOT NULL DEFAULT false,
  default_appointment_duration INTEGER DEFAULT 60,
  appointment_buffer_minutes INTEGER DEFAULT 30,
  working_hours_start TIME DEFAULT '08:00',
  working_hours_end TIME DEFAULT '18:00',
  working_days INTEGER[] DEFAULT ARRAY[1,2,3,4,5],
  ai_enabled BOOLEAN NOT NULL DEFAULT false,
  ai_suggestions_enabled BOOLEAN NOT NULL DEFAULT true,
  ai_auto_notes BOOLEAN NOT NULL DEFAULT false,
  theme TEXT DEFAULT 'light',
  dashboard_layout JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- 6. ADDER CATEGORIES TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS adder_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- 7. LEADS COLUMN
-- ============================================

ALTER TABLE leads ADD COLUMN IF NOT EXISTS channel TEXT DEFAULT 'outbound';

-- ============================================
-- 8. DASHBOARD SETTINGS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS dashboard_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  region_id UUID,
  team_id UUID,
  user_id UUID,
  settings JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- 9. SCHEDULED APPOINTMENTS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS scheduled_appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  lead_id UUID,
  opportunity_id UUID,
  closer_user_id UUID NOT NULL,
  canvasser_user_id UUID,
  google_event_id TEXT,
  appointment_type TEXT DEFAULT 'inspection',
  scheduled_for TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 60,
  status TEXT NOT NULL DEFAULT 'scheduled',
  address_text TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add columns if table already exists
ALTER TABLE scheduled_appointments ADD COLUMN IF NOT EXISTS appointment_type TEXT DEFAULT 'inspection';
ALTER TABLE scheduled_appointments ADD COLUMN IF NOT EXISTS opportunity_id UUID;

-- ============================================
-- 10. PENDING STATUS PROMPTS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS pending_status_prompts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  appointment_id UUID NOT NULL,
  closer_user_id UUID NOT NULL,
  prompt_at TIMESTAMPTZ NOT NULL,
  completed BOOLEAN NOT NULL DEFAULT false,
  dismissed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- 11. INSPECTION STATUS UPDATES TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS inspection_status_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  appointment_id UUID,
  opportunity_id UUID,
  lead_id UUID,
  closer_user_id UUID,
  setter_user_id UUID,
  outcome TEXT NOT NULL,
  notes TEXT,
  setter_feedback TEXT,
  prompted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- 12. APPOINTMENT TYPES TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS appointment_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 60,
  color TEXT DEFAULT '#3b82f6',
  description TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- 13. CUSTOM REPORTS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS custom_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  created_by UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  report_type TEXT NOT NULL DEFAULT 'bar_chart',
  data_source TEXT NOT NULL DEFAULT 'leads',
  config JSONB NOT NULL DEFAULT '{}',
  is_public BOOLEAN NOT NULL DEFAULT false,
  is_dashboard_widget BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- 14. REPORT ROLE ACCESS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS report_role_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL,
  role TEXT,
  custom_role_id UUID,
  can_view BOOLEAN NOT NULL DEFAULT true,
  can_edit BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- 15. REPORT SCHEDULES TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS report_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL,
  schedule_type TEXT NOT NULL DEFAULT 'daily',
  schedule_time TIME DEFAULT '08:00',
  schedule_day INTEGER,
  recipients JSONB DEFAULT '[]',
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- 16. CREATE INDEXES (only if columns exist)
-- ============================================

CREATE INDEX IF NOT EXISTS idx_regions_org_id ON regions(org_id);
CREATE INDEX IF NOT EXISTS idx_teams_org_id ON teams(org_id);
CREATE INDEX IF NOT EXISTS idx_adder_categories_org ON adder_categories(org_id);
CREATE INDEX IF NOT EXISTS idx_dashboard_settings_org ON dashboard_settings(org_id);
CREATE INDEX IF NOT EXISTS idx_appointment_types_org ON appointment_types(org_id);
CREATE INDEX IF NOT EXISTS idx_custom_reports_org ON custom_reports(org_id);

-- ============================================
-- 17. ENABLE RLS ON ALL TABLES
-- ============================================

ALTER TABLE opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE regions ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE adder_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE dashboard_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_status_prompts ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_status_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointment_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_role_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_schedules ENABLE ROW LEVEL SECURITY;

-- ============================================
-- 18. RLS POLICIES
-- ============================================

-- Opportunities
DROP POLICY IF EXISTS "Users can view opportunities in their org" ON opportunities;
CREATE POLICY "Users can view opportunities in their org"
  ON opportunities FOR ALL
  USING (org_id = get_user_org_id(auth.uid()));

-- Regions
DROP POLICY IF EXISTS "Users can view regions in their org" ON regions;
CREATE POLICY "Users can view regions in their org"
  ON regions FOR ALL
  USING (org_id = get_user_org_id(auth.uid()));

-- Teams
DROP POLICY IF EXISTS "Users can view teams in their org" ON teams;
CREATE POLICY "Users can view teams in their org"
  ON teams FOR ALL
  USING (org_id = get_user_org_id(auth.uid()));

-- User settings
DROP POLICY IF EXISTS "Users can manage their settings" ON user_settings;
CREATE POLICY "Users can manage their settings"
  ON user_settings FOR ALL
  USING (user_id = auth.uid());

-- Adder categories
DROP POLICY IF EXISTS "Users can view adder categories" ON adder_categories;
CREATE POLICY "Users can view adder categories"
  ON adder_categories FOR ALL
  USING (org_id = get_user_org_id(auth.uid()));

-- Dashboard settings
DROP POLICY IF EXISTS "Users can view dashboard settings" ON dashboard_settings;
CREATE POLICY "Users can view dashboard settings"
  ON dashboard_settings FOR ALL
  USING (org_id = get_user_org_id(auth.uid()));

-- Scheduled appointments
DROP POLICY IF EXISTS "Users can view appointments in their org" ON scheduled_appointments;
CREATE POLICY "Users can view appointments in their org"
  ON scheduled_appointments FOR ALL
  USING (org_id = get_user_org_id(auth.uid()));

-- Pending status prompts
DROP POLICY IF EXISTS "Users can manage their prompts" ON pending_status_prompts;
CREATE POLICY "Users can manage their prompts"
  ON pending_status_prompts FOR ALL
  USING (closer_user_id = auth.uid());

-- Inspection status updates
DROP POLICY IF EXISTS "Users can view inspection updates" ON inspection_status_updates;
CREATE POLICY "Users can view inspection updates"
  ON inspection_status_updates FOR ALL
  USING (org_id = get_user_org_id(auth.uid()));

-- Appointment types
DROP POLICY IF EXISTS "Users can view appointment types" ON appointment_types;
CREATE POLICY "Users can view appointment types"
  ON appointment_types FOR ALL
  USING (org_id = get_user_org_id(auth.uid()));

-- Custom reports
DROP POLICY IF EXISTS "Users can view reports" ON custom_reports;
CREATE POLICY "Users can view reports"
  ON custom_reports FOR ALL
  USING (org_id = get_user_org_id(auth.uid()));

-- Report role access
DROP POLICY IF EXISTS "Users can view report access" ON report_role_access;
CREATE POLICY "Users can view report access"
  ON report_role_access FOR ALL
  USING (true);

-- Report schedules
DROP POLICY IF EXISTS "Users can view report schedules" ON report_schedules;
CREATE POLICY "Users can view report schedules"
  ON report_schedules FOR ALL
  USING (true);

-- ============================================
-- 19. INSERT DEFAULT DATA
-- ============================================

-- Insert default adder categories
INSERT INTO adder_categories (org_id, name, description, sort_order)
SELECT o.id, cat.name, cat.description, cat.sort_order
FROM orgs o
CROSS JOIN (VALUES 
  ('Upgrades', 'Premium upgrades and enhancements', 1),
  ('Repairs', 'Additional repair work', 2),
  ('Materials', 'Extra materials and supplies', 3),
  ('Labor', 'Additional labor charges', 4),
  ('Other', 'Miscellaneous charges', 5)
) AS cat(name, description, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM adder_categories ac WHERE ac.org_id = o.id
);

-- Insert default appointment types
INSERT INTO appointment_types (org_id, name, duration_minutes, color, description, sort_order)
SELECT o.id, apt.name, apt.duration_minutes, apt.color, apt.description, apt.sort_order
FROM orgs o
CROSS JOIN (VALUES 
  ('Inspection', 60, '#3b82f6', 'Standard roof inspection', 1),
  ('Follow Up', 30, '#22c55e', 'Follow up visit', 2),
  ('Contract Signing', 45, '#8b5cf6', 'Contract signing appointment', 3),
  ('Final Walkthrough', 30, '#f59e0b', 'Post-installation walkthrough', 4)
) AS apt(name, duration_minutes, color, description, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM appointment_types at WHERE at.org_id = o.id
);

-- Done!
SELECT 'Migration completed successfully!' as status;
