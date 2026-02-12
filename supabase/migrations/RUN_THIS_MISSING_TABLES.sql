-- MISSING TABLES MIGRATION
-- Run this in Supabase SQL Editor to add missing tables
-- This is safe to run - it uses IF NOT EXISTS

-- ============================================
-- 1. TEAMS AND REGIONS
-- ============================================

-- Create regions table
CREATE TABLE IF NOT EXISTS regions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_regions_org_id ON regions(org_id);

-- Create teams table
CREATE TABLE IF NOT EXISTS teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  region_id UUID REFERENCES regions(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  timezone TEXT DEFAULT 'America/New_York',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add timezone column if table already exists
ALTER TABLE teams ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'America/New_York';

CREATE INDEX IF NOT EXISTS idx_teams_org_id ON teams(org_id);
CREATE INDEX IF NOT EXISTS idx_teams_region_id ON teams(region_id);

-- Add team_id and region_id to users if not exists
ALTER TABLE users ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES teams(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS region_id UUID REFERENCES regions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_users_team_id ON users(team_id);
CREATE INDEX IF NOT EXISTS idx_users_region_id ON users(region_id);

-- ============================================
-- 2. USER SETTINGS
-- ============================================

CREATE TABLE IF NOT EXISTS user_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  
  -- Notification preferences
  notifications_enabled BOOLEAN NOT NULL DEFAULT true,
  email_notifications BOOLEAN NOT NULL DEFAULT true,
  push_notifications BOOLEAN NOT NULL DEFAULT true,
  notification_types JSONB DEFAULT '{"inspection_outcome": true, "appointment_reminder": true, "commission_update": true, "team_updates": true}',
  
  -- Calendar preferences
  google_calendar_connected BOOLEAN NOT NULL DEFAULT false,
  default_appointment_duration INTEGER DEFAULT 60,
  appointment_buffer_minutes INTEGER DEFAULT 30,
  working_hours_start TIME DEFAULT '08:00',
  working_hours_end TIME DEFAULT '18:00',
  working_days INTEGER[] DEFAULT ARRAY[1,2,3,4,5],
  
  -- AI preferences
  ai_enabled BOOLEAN NOT NULL DEFAULT false,
  ai_suggestions_enabled BOOLEAN NOT NULL DEFAULT true,
  ai_auto_notes BOOLEAN NOT NULL DEFAULT false,
  
  -- Display preferences
  theme TEXT DEFAULT 'light',
  dashboard_layout JSONB,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_settings_user ON user_settings(user_id);

-- ============================================
-- 3. ADDERS / PRICEBOOK ENHANCEMENTS
-- ============================================

-- Add adder columns to pricebook_items if not exists
ALTER TABLE pricebook_items ADD COLUMN IF NOT EXISTS is_adder BOOLEAN DEFAULT false;
ALTER TABLE pricebook_items ADD COLUMN IF NOT EXISTS adder_category TEXT;
ALTER TABLE pricebook_items ADD COLUMN IF NOT EXISTS price_type TEXT DEFAULT 'fixed';
ALTER TABLE pricebook_items ADD COLUMN IF NOT EXISTS is_commissionable BOOLEAN DEFAULT true;

-- Adder categories table
CREATE TABLE IF NOT EXISTS adder_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_adder_categories_org ON adder_categories(org_id);

-- ============================================
-- 4. CANVASS PIN VISIBILITY
-- ============================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS canvass_pin_visibility TEXT DEFAULT 'org';

-- ============================================
-- 5. LEAD CHANNEL ENUM AND COLUMN
-- ============================================

-- Create lead_channel enum if not exists
DO $$ 
BEGIN
  CREATE TYPE lead_channel AS ENUM ('inbound', 'outbound');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Add channel column to leads if not exists
ALTER TABLE leads ADD COLUMN IF NOT EXISTS channel lead_channel DEFAULT 'outbound';

-- ============================================
-- 6. DASHBOARD SETTINGS
-- ============================================

CREATE TABLE IF NOT EXISTS dashboard_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  region_id UUID REFERENCES regions(id) ON DELETE CASCADE,
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  settings JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dashboard_settings_org ON dashboard_settings(org_id);
CREATE INDEX IF NOT EXISTS idx_dashboard_settings_region ON dashboard_settings(region_id);
CREATE INDEX IF NOT EXISTS idx_dashboard_settings_team ON dashboard_settings(team_id);
CREATE INDEX IF NOT EXISTS idx_dashboard_settings_user ON dashboard_settings(user_id);

-- Add unique constraint if not exists
DO $$ 
BEGIN
  ALTER TABLE dashboard_settings ADD CONSTRAINT dashboard_settings_scope_unique 
    UNIQUE(org_id, region_id, team_id, user_id);
EXCEPTION
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_object THEN NULL;
END $$;

-- ============================================
-- 7. SCHEDULED APPOINTMENTS
-- ============================================

CREATE TABLE IF NOT EXISTS scheduled_appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  opportunity_id UUID REFERENCES opportunities(id) ON DELETE SET NULL,
  closer_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  canvasser_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
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

ALTER TABLE scheduled_appointments ADD COLUMN IF NOT EXISTS appointment_type TEXT DEFAULT 'inspection';

CREATE INDEX IF NOT EXISTS idx_scheduled_appointments_closer ON scheduled_appointments(closer_user_id, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_scheduled_appointments_lead ON scheduled_appointments(lead_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_appointments_opportunity ON scheduled_appointments(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_appointments_org ON scheduled_appointments(org_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_appointments_status ON scheduled_appointments(status, scheduled_for);

-- ============================================
-- 8. PENDING STATUS PROMPTS (for feedback)
-- ============================================

CREATE TABLE IF NOT EXISTS pending_status_prompts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  appointment_id UUID NOT NULL REFERENCES scheduled_appointments(id) ON DELETE CASCADE,
  closer_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prompt_at TIMESTAMPTZ NOT NULL,
  completed BOOLEAN NOT NULL DEFAULT false,
  dismissed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pending_prompts_closer ON pending_status_prompts(closer_user_id, completed, dismissed);
CREATE INDEX IF NOT EXISTS idx_pending_prompts_appointment ON pending_status_prompts(appointment_id);

-- ============================================
-- 9. INSPECTION STATUS UPDATES
-- ============================================

CREATE TABLE IF NOT EXISTS inspection_status_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  appointment_id UUID REFERENCES scheduled_appointments(id) ON DELETE SET NULL,
  opportunity_id UUID REFERENCES opportunities(id) ON DELETE SET NULL,
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  closer_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  setter_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  outcome TEXT NOT NULL,
  notes TEXT,
  setter_feedback TEXT,
  prompted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inspection_updates_appointment ON inspection_status_updates(appointment_id);
CREATE INDEX IF NOT EXISTS idx_inspection_updates_opportunity ON inspection_status_updates(opportunity_id);

-- ============================================
-- 10. APPOINTMENT TYPES
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

CREATE INDEX IF NOT EXISTS idx_appointment_types_org ON appointment_types(org_id);

-- Insert default appointment types for each org
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

-- ============================================
-- 11. CUSTOM REPORTS
-- ============================================

-- Create report_type enum if not exists
DO $$ 
BEGIN
  CREATE TYPE report_type AS ENUM ('metric_card', 'bar_chart', 'line_chart', 'pie_chart', 'table', 'funnel');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Create report_data_source enum if not exists
DO $$ 
BEGIN
  CREATE TYPE report_data_source AS ENUM ('leads', 'opportunities', 'projects', 'appointments', 'inspection_outcomes');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS custom_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  report_type report_type NOT NULL DEFAULT 'bar_chart',
  data_source report_data_source NOT NULL DEFAULT 'leads',
  config JSONB NOT NULL DEFAULT '{}',
  is_public BOOLEAN NOT NULL DEFAULT false,
  is_dashboard_widget BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_custom_reports_org ON custom_reports(org_id);
CREATE INDEX IF NOT EXISTS idx_custom_reports_creator ON custom_reports(created_by);
CREATE INDEX IF NOT EXISTS idx_custom_reports_dashboard ON custom_reports(org_id) WHERE is_dashboard_widget = true;

-- Report role access
CREATE TABLE IF NOT EXISTS report_role_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES custom_reports(id) ON DELETE CASCADE,
  role TEXT,
  custom_role_id UUID,
  can_view BOOLEAN NOT NULL DEFAULT true,
  can_edit BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_report_role_access_report ON report_role_access(report_id);

-- Report schedules
CREATE TABLE IF NOT EXISTS report_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES custom_reports(id) ON DELETE CASCADE,
  schedule_type TEXT NOT NULL DEFAULT 'daily',
  schedule_time TIME DEFAULT '08:00',
  schedule_day INTEGER,
  recipients JSONB DEFAULT '[]',
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_report_schedules_report ON report_schedules(report_id);

-- ============================================
-- 12. INSERT DEFAULT ADDER CATEGORIES
-- ============================================

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

-- ============================================
-- 13. RLS POLICIES
-- ============================================

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

-- Regions
DROP POLICY IF EXISTS "Users can view regions in their org" ON regions;
CREATE POLICY "Users can view regions in their org"
  ON regions FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Admins can manage regions" ON regions;
CREATE POLICY "Admins can manage regions"
  ON regions FOR ALL
  USING (org_id = get_user_org_id(auth.uid()));

-- Teams
DROP POLICY IF EXISTS "Users can view teams in their org" ON teams;
CREATE POLICY "Users can view teams in their org"
  ON teams FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Admins can manage teams" ON teams;
CREATE POLICY "Admins can manage teams"
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
  ON adder_categories FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

-- Dashboard settings
DROP POLICY IF EXISTS "Users can view dashboard settings in their org" ON dashboard_settings;
CREATE POLICY "Users can view dashboard settings in their org"
  ON dashboard_settings FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Admins and managers can manage dashboard settings" ON dashboard_settings;
CREATE POLICY "Admins and managers can manage dashboard settings"
  ON dashboard_settings FOR ALL
  USING (org_id = get_user_org_id(auth.uid()));

-- Scheduled appointments
DROP POLICY IF EXISTS "Users can view appointments in their org" ON scheduled_appointments;
CREATE POLICY "Users can view appointments in their org"
  ON scheduled_appointments FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Users can manage appointments in their org" ON scheduled_appointments;
CREATE POLICY "Users can manage appointments in their org"
  ON scheduled_appointments FOR ALL
  USING (org_id = get_user_org_id(auth.uid()));

-- Pending status prompts
DROP POLICY IF EXISTS "Users can manage their prompts" ON pending_status_prompts;
CREATE POLICY "Users can manage their prompts"
  ON pending_status_prompts FOR ALL
  USING (closer_user_id = auth.uid());

-- Inspection status updates
DROP POLICY IF EXISTS "Users can view inspection updates in their org" ON inspection_status_updates;
CREATE POLICY "Users can view inspection updates in their org"
  ON inspection_status_updates FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Users can create inspection updates" ON inspection_status_updates;
CREATE POLICY "Users can create inspection updates"
  ON inspection_status_updates FOR INSERT
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

-- Appointment types
DROP POLICY IF EXISTS "Users can view appointment types in their org" ON appointment_types;
CREATE POLICY "Users can view appointment types in their org"
  ON appointment_types FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Admins can manage appointment types" ON appointment_types;
CREATE POLICY "Admins can manage appointment types"
  ON appointment_types FOR ALL
  USING (org_id = get_user_org_id(auth.uid()));

-- Custom reports
DROP POLICY IF EXISTS "Users can view reports in their org" ON custom_reports;
CREATE POLICY "Users can view reports in their org"
  ON custom_reports FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Users can manage their own reports" ON custom_reports;
CREATE POLICY "Users can manage their own reports"
  ON custom_reports FOR ALL
  USING (
    org_id = get_user_org_id(auth.uid()) 
    AND (created_by = auth.uid() OR is_public = true)
  );

-- Report role access
DROP POLICY IF EXISTS "Users can view report access" ON report_role_access;
CREATE POLICY "Users can view report access"
  ON report_role_access FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM custom_reports cr 
      WHERE cr.id = report_role_access.report_id 
      AND cr.org_id = get_user_org_id(auth.uid())
    )
  );

DROP POLICY IF EXISTS "Report owners can manage access" ON report_role_access;
CREATE POLICY "Report owners can manage access"
  ON report_role_access FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM custom_reports cr 
      WHERE cr.id = report_role_access.report_id 
      AND cr.created_by = auth.uid()
    )
  );

-- Report schedules
DROP POLICY IF EXISTS "Users can view report schedules" ON report_schedules;
CREATE POLICY "Users can view report schedules"
  ON report_schedules FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM custom_reports cr 
      WHERE cr.id = report_schedules.report_id 
      AND cr.org_id = get_user_org_id(auth.uid())
    )
  );

DROP POLICY IF EXISTS "Report owners can manage schedules" ON report_schedules;
CREATE POLICY "Report owners can manage schedules"
  ON report_schedules FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM custom_reports cr 
      WHERE cr.id = report_schedules.report_id 
      AND cr.created_by = auth.uid()
    )
  );

-- Done!
SELECT 'Migration completed successfully!' as status;
