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
-- 4b. LEAD CHANNEL ENUM AND COLUMN
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
-- 5. DASHBOARD SETTINGS
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

-- Add unique constraint if not exists (ignore error if already exists)
DO $$ 
BEGIN
  ALTER TABLE dashboard_settings ADD CONSTRAINT dashboard_settings_scope_unique 
    UNIQUE(org_id, region_id, team_id, user_id);
EXCEPTION
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_object THEN NULL;
END $$;

-- ============================================
-- 6. RLS POLICIES (safe to run multiple times)
-- ============================================

ALTER TABLE regions ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE adder_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE dashboard_settings ENABLE ROW LEVEL SECURITY;

-- Drop and recreate policies (safe way)
DROP POLICY IF EXISTS "Users can view regions in their org" ON regions;
CREATE POLICY "Users can view regions in their org"
  ON regions FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Users can view teams in their org" ON teams;
CREATE POLICY "Users can view teams in their org"
  ON teams FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Users can manage their settings" ON user_settings;
CREATE POLICY "Users can manage their settings"
  ON user_settings FOR ALL
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can view adder categories" ON adder_categories;
CREATE POLICY "Users can view adder categories"
  ON adder_categories FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Users can view dashboard settings in their org" ON dashboard_settings;
CREATE POLICY "Users can view dashboard settings in their org"
  ON dashboard_settings FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Admins and managers can manage dashboard settings" ON dashboard_settings;
CREATE POLICY "Admins and managers can manage dashboard settings"
  ON dashboard_settings FOR ALL
  USING (org_id = get_user_org_id(auth.uid()));

-- ============================================
-- 7. INSERT DEFAULT ADDER CATEGORIES
-- ============================================

-- Only insert if table is empty for this org
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

-- Done!
SELECT 'Migration completed successfully!' as status;
