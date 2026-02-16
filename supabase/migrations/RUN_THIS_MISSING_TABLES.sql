-- MISSING TABLES MIGRATION
-- Run this in Supabase SQL Editor to add missing tables
-- This is safe to run - it uses IF NOT EXISTS

-- ============================================
-- 0. PREREQUISITES - ENUMS
-- ============================================

-- Add 'percent' to unit enum if it doesn't exist
DO $$
BEGIN
  ALTER TYPE unit ADD VALUE IF NOT EXISTS 'percent';
EXCEPTION
  WHEN others THEN NULL;
END $$;

-- Add new user roles if they don't exist
DO $$
BEGIN
  ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'owner';
EXCEPTION WHEN others THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'regional_setter_manager';
EXCEPTION WHEN others THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'setter_manager';
EXCEPTION WHEN others THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'setter';
EXCEPTION WHEN others THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'custom';
EXCEPTION WHEN others THEN NULL;
END $$;

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
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS setter_user_id UUID;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS inspection_outcome_at TIMESTAMPTZ;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS inspection_notes TEXT;

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
  appointment_id UUID NOT NULL REFERENCES scheduled_appointments(id) ON DELETE CASCADE,
  closer_user_id UUID NOT NULL,
  prompt_at TIMESTAMPTZ NOT NULL,
  completed BOOLEAN NOT NULL DEFAULT false,
  dismissed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add foreign key if table already exists without it
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'pending_status_prompts_appointment_id_fkey'
    AND table_name = 'pending_status_prompts'
  ) THEN
    ALTER TABLE pending_status_prompts 
    ADD CONSTRAINT pending_status_prompts_appointment_id_fkey 
    FOREIGN KEY (appointment_id) REFERENCES scheduled_appointments(id) ON DELETE CASCADE;
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

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
CREATE INDEX IF NOT EXISTS idx_pending_prompts_closer ON pending_status_prompts(closer_user_id, completed, dismissed);
CREATE INDEX IF NOT EXISTS idx_pending_prompts_prompt_at ON pending_status_prompts(prompt_at);

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

-- Pending status prompts (closers see their own, admins see all in org)
DROP POLICY IF EXISTS "Users can manage their prompts" ON pending_status_prompts;
CREATE POLICY "Users can manage their prompts"
  ON pending_status_prompts FOR ALL
  USING (
    closer_user_id = auth.uid() 
    OR (
      org_id = get_user_org_id(auth.uid())
      AND EXISTS (
        SELECT 1 FROM users 
        WHERE users.id = auth.uid() 
        AND users.role = 'admin'
      )
    )
  );

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

-- ============================================
-- 15. PRICEBOOK_ITEMS COLUMNS
-- ============================================

-- Add missing columns to pricebook_items for adder functionality
ALTER TABLE pricebook_items ADD COLUMN IF NOT EXISTS cost_price NUMERIC(10, 2);
ALTER TABLE pricebook_items ADD COLUMN IF NOT EXISTS price_type TEXT DEFAULT 'fixed';
ALTER TABLE pricebook_items ADD COLUMN IF NOT EXISTS is_commissionable BOOLEAN DEFAULT true;
ALTER TABLE pricebook_items ADD COLUMN IF NOT EXISTS commission_percent NUMERIC(5, 2);
ALTER TABLE pricebook_items ADD COLUMN IF NOT EXISTS commission_cap NUMERIC(10, 2);
ALTER TABLE pricebook_items ADD COLUMN IF NOT EXISTS material_cost NUMERIC(10, 2);
ALTER TABLE pricebook_items ADD COLUMN IF NOT EXISTS labor_cost NUMERIC(10, 2);
ALTER TABLE pricebook_items ADD COLUMN IF NOT EXISTS profit_margin_percent NUMERIC(6, 2);
ALTER TABLE pricebook_items ADD COLUMN IF NOT EXISTS visibility TEXT DEFAULT 'sales_reps';
ALTER TABLE pricebook_items ADD COLUMN IF NOT EXISTS show_to_customer BOOLEAN DEFAULT false;
ALTER TABLE pricebook_items ADD COLUMN IF NOT EXISTS is_adder BOOLEAN DEFAULT false;
ALTER TABLE pricebook_items ADD COLUMN IF NOT EXISTS adder_category TEXT;

-- ============================================
-- 20. PROPOSAL_LINE_ITEMS COLUMNS
-- ============================================

-- Add show_to_customer column to proposal_line_items for customer visibility
ALTER TABLE proposal_line_items ADD COLUMN IF NOT EXISTS show_to_customer BOOLEAN DEFAULT false;

-- ============================================
-- 21. USERS - SHOW IN REPORTS TOGGLE
-- ============================================

-- Add show_in_reports column to users for controlling visibility in reports/leaderboards
-- Defaults to true so existing users appear in reports
ALTER TABLE users ADD COLUMN IF NOT EXISTS show_in_reports BOOLEAN DEFAULT true;

-- ============================================
-- 21b. USERS - HIERARCHY COLUMNS
-- ============================================

-- Add manager_user_id for direct manager assignment
ALTER TABLE users ADD COLUMN IF NOT EXISTS manager_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

-- Add region_id if not exists (for regional assignment)
ALTER TABLE users ADD COLUMN IF NOT EXISTS region_id UUID REFERENCES regions(id) ON DELETE SET NULL;

-- Create index for manager lookups
CREATE INDEX IF NOT EXISTS idx_users_manager ON users(manager_user_id);
CREATE INDEX IF NOT EXISTS idx_users_region ON users(region_id);

-- ============================================
-- 22. COMP PLANS (COMMISSION PLANS)
-- ============================================

-- Create comp_plan_type enum
DO $$ 
BEGIN
  CREATE TYPE comp_plan_type AS ENUM ('flat_rate', 'percentage', 'tiered', 'hybrid');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Create commission_status enum
DO $$ 
BEGIN
  CREATE TYPE commission_status AS ENUM ('pending', 'approved', 'paid', 'disputed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Comp Plans table - defines commission structures
CREATE TABLE IF NOT EXISTS comp_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  plan_type comp_plan_type NOT NULL DEFAULT 'percentage',
  is_active BOOLEAN DEFAULT true,
  is_default BOOLEAN DEFAULT false,
  flat_amount DECIMAL(10,2),
  base_percentage DECIMAL(5,2),
  tiers JSONB, -- Array of {min, max, rate} objects for tiered plans
  bonuses JSONB, -- Array of {type, target, bonus} objects
  volume_bonuses JSONB, -- Array of {min_volume, max_volume, bonus_type, bonus_value} for sliding scale
  applicable_roles TEXT[] DEFAULT '{}',
  is_manager_plan BOOLEAN DEFAULT false, -- Whether this is a manager compensation plan
  personal_sales_enabled BOOLEAN DEFAULT true, -- Manager can earn from their own sales
  team_override_enabled BOOLEAN DEFAULT false, -- Manager earns override from team sales
  team_overrides JSONB, -- Array of {min_team_volume, max_team_volume, override_type, override_value}
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add missing columns if table already exists
ALTER TABLE comp_plans ADD COLUMN IF NOT EXISTS volume_bonuses JSONB;
ALTER TABLE comp_plans ADD COLUMN IF NOT EXISTS is_manager_plan BOOLEAN DEFAULT false;
ALTER TABLE comp_plans ADD COLUMN IF NOT EXISTS personal_sales_enabled BOOLEAN DEFAULT true;
ALTER TABLE comp_plans ADD COLUMN IF NOT EXISTS team_override_enabled BOOLEAN DEFAULT false;
ALTER TABLE comp_plans ADD COLUMN IF NOT EXISTS team_overrides JSONB;

-- User Comp Plans - assigns plans to users with effective dates
CREATE TABLE IF NOT EXISTS user_comp_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  comp_plan_id UUID NOT NULL REFERENCES comp_plans(id) ON DELETE CASCADE,
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to DATE,
  override_percentage DECIMAL(5,2), -- Optional override of base percentage
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, comp_plan_id, effective_from)
);

-- Commissions table - tracks actual commission records
CREATE TABLE IF NOT EXISTS commissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  opportunity_id UUID REFERENCES opportunities(id) ON DELETE SET NULL,
  comp_plan_id UUID REFERENCES comp_plans(id) ON DELETE SET NULL,
  sale_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  commission_rate DECIMAL(5,2) NOT NULL DEFAULT 0,
  commission_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  bonus_amount DECIMAL(12,2) DEFAULT 0,
  total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  status commission_status DEFAULT 'pending',
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  commission_period TEXT, -- e.g., '2024-01' for January 2024
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for comp_plans
CREATE INDEX IF NOT EXISTS idx_comp_plans_org ON comp_plans(org_id);
CREATE INDEX IF NOT EXISTS idx_comp_plans_active ON comp_plans(org_id, is_active);

-- Indexes for user_comp_plans
CREATE INDEX IF NOT EXISTS idx_user_comp_plans_org ON user_comp_plans(org_id);
CREATE INDEX IF NOT EXISTS idx_user_comp_plans_user ON user_comp_plans(user_id);
CREATE INDEX IF NOT EXISTS idx_user_comp_plans_effective ON user_comp_plans(user_id, effective_from, effective_to);

-- Indexes for commissions
CREATE INDEX IF NOT EXISTS idx_commissions_org ON commissions(org_id);
CREATE INDEX IF NOT EXISTS idx_commissions_user ON commissions(user_id);
CREATE INDEX IF NOT EXISTS idx_commissions_status ON commissions(org_id, status);
CREATE INDEX IF NOT EXISTS idx_commissions_period ON commissions(org_id, commission_period);

-- RLS Policies for comp_plans
ALTER TABLE comp_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view comp plans in their org" ON comp_plans;
CREATE POLICY "Users can view comp plans in their org" ON comp_plans
  FOR SELECT USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Admins can manage comp plans" ON comp_plans;
CREATE POLICY "Admins can manage comp plans" ON comp_plans
  FOR ALL USING (
    org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin')
  );

-- RLS Policies for user_comp_plans
ALTER TABLE user_comp_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own comp plan assignments" ON user_comp_plans;
CREATE POLICY "Users can view their own comp plan assignments" ON user_comp_plans
  FOR SELECT USING (
    user_id = auth.uid() OR 
    org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role IN ('admin', 'regional_manager', 'sales_manager'))
  );

DROP POLICY IF EXISTS "Admins can manage user comp plans" ON user_comp_plans;
CREATE POLICY "Admins can manage user comp plans" ON user_comp_plans
  FOR ALL USING (
    org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin')
  );

-- RLS Policies for commissions
ALTER TABLE commissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own commissions" ON commissions;
CREATE POLICY "Users can view their own commissions" ON commissions
  FOR SELECT USING (
    user_id = auth.uid() OR 
    org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role IN ('admin', 'regional_manager', 'sales_manager'))
  );

DROP POLICY IF EXISTS "Admins can manage commissions" ON commissions;
CREATE POLICY "Admins can manage commissions" ON commissions
  FOR ALL USING (
    org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin')
  );

-- Done!
SELECT 'Migration completed successfully!' as status;
