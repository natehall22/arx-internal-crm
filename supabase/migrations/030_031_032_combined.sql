-- Combined Migration: Permission Presets, Campaigns, Lead Sources, and Default Presets
-- Run this single file in Supabase SQL Editor

-- ============================================
-- PART 1: Permission Presets Tables (from 030)
-- ============================================

-- Create permission_presets table
CREATE TABLE IF NOT EXISTS permission_presets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  base_role TEXT NOT NULL DEFAULT 'sales_rep',
  icon TEXT,
  color TEXT DEFAULT 'gray',
  is_system BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE(org_id, name)
);

CREATE INDEX IF NOT EXISTS idx_permission_presets_org_id ON permission_presets(org_id);

-- Create preset_permissions junction table
CREATE TABLE IF NOT EXISTS preset_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  preset_id UUID NOT NULL REFERENCES permission_presets(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(preset_id, permission_id)
);

CREATE INDEX IF NOT EXISTS idx_preset_permissions_preset_id ON preset_permissions(preset_id);

-- Trigger for updated_at
DROP TRIGGER IF EXISTS update_permission_presets_updated_at ON permission_presets;
CREATE TRIGGER update_permission_presets_updated_at 
  BEFORE UPDATE ON permission_presets 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS Policies
ALTER TABLE permission_presets ENABLE ROW LEVEL SECURITY;
ALTER TABLE preset_permissions ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view permission presets in their org" ON permission_presets;
DROP POLICY IF EXISTS "Admins can manage permission presets" ON permission_presets;
DROP POLICY IF EXISTS "Users can view preset permissions in their org" ON preset_permissions;
DROP POLICY IF EXISTS "Admins can manage preset permissions" ON preset_permissions;

-- Users can view presets in their org
CREATE POLICY "Users can view permission presets in their org"
  ON permission_presets FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

-- Admins can manage presets
CREATE POLICY "Admins can manage permission presets"
  ON permission_presets FOR ALL
  USING (
    org_id = get_user_org_id(auth.uid())
    AND get_user_role(auth.uid()) IN ('admin', 'regional_manager')
  );

-- Users can view preset permissions in their org
CREATE POLICY "Users can view preset permissions in their org"
  ON preset_permissions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM permission_presets pp
      WHERE pp.id = preset_permissions.preset_id
      AND pp.org_id = get_user_org_id(auth.uid())
    )
  );

-- Admins can manage preset permissions
CREATE POLICY "Admins can manage preset permissions"
  ON preset_permissions FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM permission_presets pp
      WHERE pp.id = preset_permissions.preset_id
      AND pp.org_id = get_user_org_id(auth.uid())
    )
    AND get_user_role(auth.uid()) IN ('admin', 'regional_manager')
  );

-- ============================================
-- PART 2: Campaigns and Lead Sources (from 031)
-- ============================================

-- Lead source types enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lead_source_type') THEN
    CREATE TYPE lead_source_type AS ENUM (
      'website',
      'google_ads',
      'facebook',
      'instagram',
      'tiktok',
      'youtube',
      'bing_ads',
      'referral',
      'canvass',
      'door_knock',
      'phone_call',
      'walk_in',
      'home_show',
      'partner',
      'other'
    );
  END IF;
END $$;

-- Lead channel enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lead_channel') THEN
    CREATE TYPE lead_channel AS ENUM (
      'inbound',
      'outbound'
    );
  END IF;
END $$;

-- Marketing campaigns table
CREATE TABLE IF NOT EXISTS campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  source_type lead_source_type NOT NULL DEFAULT 'other',
  channel lead_channel NOT NULL DEFAULT 'inbound',
  budget NUMERIC(12, 2),
  spent NUMERIC(12, 2) DEFAULT 0,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_term TEXT,
  utm_content TEXT,
  google_campaign_id TEXT,
  facebook_campaign_id TEXT,
  external_id TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  start_date DATE,
  end_date DATE,
  total_leads INTEGER NOT NULL DEFAULT 0,
  total_appointments INTEGER NOT NULL DEFAULT 0,
  total_sales INTEGER NOT NULL DEFAULT 0,
  total_revenue NUMERIC(12, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE(org_id, name)
);

CREATE INDEX IF NOT EXISTS idx_campaigns_org_id ON campaigns(org_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_source_type ON campaigns(source_type);
CREATE INDEX IF NOT EXISTS idx_campaigns_channel ON campaigns(channel);
CREATE INDEX IF NOT EXISTS idx_campaigns_is_active ON campaigns(is_active);

-- Lead sources configuration table
CREATE TABLE IF NOT EXISTS lead_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  source_type lead_source_type NOT NULL,
  webhook_token TEXT NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  webhook_enabled BOOLEAN NOT NULL DEFAULT true,
  default_campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  field_mapping JSONB DEFAULT '{
    "name": "name",
    "email": "email",
    "phone": "phone",
    "address": "address",
    "message": "notes"
  }'::jsonb,
  auto_assign_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  auto_assign_team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  round_robin_enabled BOOLEAN NOT NULL DEFAULT false,
  notify_on_new_lead BOOLEAN NOT NULL DEFAULT true,
  notification_emails TEXT[],
  is_active BOOLEAN NOT NULL DEFAULT true,
  total_leads_received INTEGER NOT NULL DEFAULT 0,
  last_lead_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, name)
);

CREATE INDEX IF NOT EXISTS idx_lead_sources_org_id ON lead_sources(org_id);
CREATE INDEX IF NOT EXISTS idx_lead_sources_webhook_token ON lead_sources(webhook_token);

-- Add campaign and source tracking to leads table
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lead_source_id UUID REFERENCES lead_sources(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_type lead_source_type,
  ADD COLUMN IF NOT EXISTS channel lead_channel DEFAULT 'outbound',
  ADD COLUMN IF NOT EXISTS utm_source TEXT,
  ADD COLUMN IF NOT EXISTS utm_medium TEXT,
  ADD COLUMN IF NOT EXISTS utm_campaign TEXT,
  ADD COLUMN IF NOT EXISTS utm_term TEXT,
  ADD COLUMN IF NOT EXISTS utm_content TEXT,
  ADD COLUMN IF NOT EXISTS external_lead_id TEXT,
  ADD COLUMN IF NOT EXISTS landing_page TEXT,
  ADD COLUMN IF NOT EXISTS referrer_url TEXT,
  ADD COLUMN IF NOT EXISTS ip_address INET,
  ADD COLUMN IF NOT EXISTS user_agent TEXT,
  ADD COLUMN IF NOT EXISTS raw_payload JSONB;

CREATE INDEX IF NOT EXISTS idx_leads_campaign_id ON leads(campaign_id);
CREATE INDEX IF NOT EXISTS idx_leads_lead_source_id ON leads(lead_source_id);
CREATE INDEX IF NOT EXISTS idx_leads_channel ON leads(channel);

-- Inbound lead queue
CREATE TABLE IF NOT EXISTS inbound_lead_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  lead_source_id UUID REFERENCES lead_sources(id) ON DELETE SET NULL,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'assigned', 'claimed', 'expired')),
  priority INTEGER NOT NULL DEFAULT 0,
  assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ,
  claimed_at TIMESTAMPTZ,
  sla_deadline TIMESTAMPTZ,
  first_contact_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(lead_id)
);

CREATE INDEX IF NOT EXISTS idx_inbound_lead_queue_org_id ON inbound_lead_queue(org_id);
CREATE INDEX IF NOT EXISTS idx_inbound_lead_queue_status ON inbound_lead_queue(status);

-- Add new permissions for inbound leads and campaigns
INSERT INTO permissions (name, display_name, description, category) VALUES
  ('leads:view_inbound', 'View Inbound Leads', 'Access leads from website, ads, and other inbound sources', 'Leads'),
  ('leads:manage_inbound', 'Manage Inbound Leads', 'Assign and manage inbound lead queue', 'Leads'),
  ('leads:claim_inbound', 'Claim Inbound Leads', 'Claim leads from the inbound queue', 'Leads'),
  ('campaigns:view', 'View Campaigns', 'See marketing campaign data', 'Campaigns'),
  ('campaigns:create', 'Create Campaigns', 'Create new marketing campaigns', 'Campaigns'),
  ('campaigns:edit', 'Edit Campaigns', 'Modify campaign settings', 'Campaigns'),
  ('campaigns:delete', 'Delete Campaigns', 'Remove campaigns', 'Campaigns'),
  ('campaigns:view_reports', 'View Campaign Reports', 'Access campaign performance reports', 'Campaigns'),
  ('lead_sources:view', 'View Lead Sources', 'See lead source configurations', 'Leads'),
  ('lead_sources:manage', 'Manage Lead Sources', 'Configure webhook endpoints and field mappings', 'Leads')
ON CONFLICT (name) DO NOTHING;

-- Triggers
DROP TRIGGER IF EXISTS update_campaigns_updated_at ON campaigns;
CREATE TRIGGER update_campaigns_updated_at 
  BEFORE UPDATE ON campaigns 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_lead_sources_updated_at ON lead_sources;
CREATE TRIGGER update_lead_sources_updated_at 
  BEFORE UPDATE ON lead_sources 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_inbound_lead_queue_updated_at ON inbound_lead_queue;
CREATE TRIGGER update_inbound_lead_queue_updated_at 
  BEFORE UPDATE ON inbound_lead_queue 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS Policies for campaigns
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbound_lead_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view campaigns in their org" ON campaigns;
DROP POLICY IF EXISTS "Admins can manage campaigns" ON campaigns;
DROP POLICY IF EXISTS "Admins can view lead sources" ON lead_sources;
DROP POLICY IF EXISTS "Admins can manage lead sources" ON lead_sources;
DROP POLICY IF EXISTS "Users can view inbound queue based on permissions" ON inbound_lead_queue;
DROP POLICY IF EXISTS "Users can update their assigned leads" ON inbound_lead_queue;
DROP POLICY IF EXISTS "Admins can manage inbound queue" ON inbound_lead_queue;

CREATE POLICY "Users can view campaigns in their org"
  ON campaigns FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

CREATE POLICY "Admins can manage campaigns"
  ON campaigns FOR ALL
  USING (
    org_id = get_user_org_id(auth.uid())
    AND get_user_role(auth.uid()) IN ('admin', 'regional_manager')
  );

CREATE POLICY "Admins can view lead sources"
  ON lead_sources FOR SELECT
  USING (
    org_id = get_user_org_id(auth.uid())
    AND get_user_role(auth.uid()) IN ('admin', 'regional_manager')
  );

CREATE POLICY "Admins can manage lead sources"
  ON lead_sources FOR ALL
  USING (
    org_id = get_user_org_id(auth.uid())
    AND get_user_role(auth.uid()) IN ('admin', 'regional_manager')
  );

CREATE POLICY "Users can view inbound queue based on permissions"
  ON inbound_lead_queue FOR SELECT
  USING (
    org_id = get_user_org_id(auth.uid())
    AND (
      get_user_role(auth.uid()) IN ('admin', 'regional_manager', 'operations')
      OR assigned_to = auth.uid()
    )
  );

CREATE POLICY "Admins can manage inbound queue"
  ON inbound_lead_queue FOR ALL
  USING (
    org_id = get_user_org_id(auth.uid())
    AND get_user_role(auth.uid()) IN ('admin', 'regional_manager')
  );

-- ============================================
-- PART 3: Initialize Default Presets (from 032)
-- ============================================

DO $$
DECLARE
  v_org RECORD;
  v_preset_id UUID;
  v_existing_count INTEGER;
BEGIN
  FOR v_org IN SELECT id, name FROM orgs LOOP
    SELECT COUNT(*) INTO v_existing_count 
    FROM permission_presets 
    WHERE org_id = v_org.id;
    
    IF v_existing_count > 0 THEN
      RAISE NOTICE 'Org % already has presets, skipping', v_org.name;
      CONTINUE;
    END IF;
    
    RAISE NOTICE 'Creating presets for org: %', v_org.name;

    -- 1. Setter / Canvasser
    INSERT INTO permission_presets (org_id, name, description, base_role, color, is_system, sort_order)
    VALUES (v_org.id, 'Setter / Canvasser', 'Door-to-door canvassing, lead creation, basic scheduling', 'canvasser', 'green', true, 1)
    RETURNING id INTO v_preset_id;
    
    INSERT INTO preset_permissions (preset_id, permission_id)
    SELECT v_preset_id, id FROM permissions WHERE name IN (
      'canvass:view', 'canvass:create', 'canvass:edit',
      'leads:view', 'leads:create', 'leads:edit',
      'scheduling:view', 'reports:view_own', 'teams:view', 'users:view'
    );

    -- 2. Sales Representative
    INSERT INTO permission_presets (org_id, name, description, base_role, color, is_system, sort_order)
    VALUES (v_org.id, 'Sales Representative', 'Full sales cycle - leads, opportunities, proposals, contracts', 'sales_rep', 'blue', true, 2)
    RETURNING id INTO v_preset_id;
    
    INSERT INTO preset_permissions (preset_id, permission_id)
    SELECT v_preset_id, id FROM permissions WHERE name IN (
      'canvass:view', 'leads:view', 'leads:create', 'leads:edit',
      'opportunities:view', 'opportunities:edit',
      'proposals:view', 'proposals:create', 'proposals:edit', 'proposals:send',
      'contracts:view', 'contracts:create', 'contracts:send',
      'projects:view', 'scheduling:view', 'scheduling:create', 'scheduling:edit',
      'reports:view_own', 'teams:view', 'users:view'
    );

    -- 3. Sales Manager
    INSERT INTO permission_presets (org_id, name, description, base_role, color, is_system, sort_order)
    VALUES (v_org.id, 'Sales Manager', 'Team management, reporting, full sales access', 'sales_manager', 'purple', true, 3)
    RETURNING id INTO v_preset_id;
    
    INSERT INTO preset_permissions (preset_id, permission_id)
    SELECT v_preset_id, id FROM permissions WHERE name IN (
      'canvass:view', 'canvass:create', 'canvass:edit', 'canvass:import', 'canvass:export',
      'leads:view', 'leads:create', 'leads:edit', 'leads:assign',
      'opportunities:view', 'opportunities:edit',
      'proposals:view', 'proposals:create', 'proposals:edit', 'proposals:send',
      'contracts:view', 'contracts:create', 'contracts:send',
      'projects:view', 'projects:edit',
      'teams:view', 'teams:edit', 'teams:manage_members',
      'users:view', 'users:manage_team',
      'scheduling:view', 'scheduling:create', 'scheduling:edit', 'scheduling:manage_team',
      'reports:view_own', 'reports:view_team', 'reports:export',
      'pricebook:view'
    );

    -- 4. Regional Manager
    INSERT INTO permission_presets (org_id, name, description, base_role, color, is_system, sort_order)
    VALUES (v_org.id, 'Regional Manager', 'Regional oversight, all team management, admin access', 'regional_manager', 'indigo', true, 4)
    RETURNING id INTO v_preset_id;
    
    INSERT INTO preset_permissions (preset_id, permission_id)
    SELECT v_preset_id, id FROM permissions WHERE name IN (
      'canvass:view', 'canvass:create', 'canvass:edit', 'canvass:delete', 'canvass:import', 'canvass:export',
      'leads:view', 'leads:create', 'leads:edit', 'leads:delete', 'leads:assign',
      'leads:view_inbound', 'leads:manage_inbound',
      'opportunities:view', 'opportunities:edit', 'opportunities:delete',
      'proposals:view', 'proposals:create', 'proposals:edit', 'proposals:send',
      'contracts:view', 'contracts:create', 'contracts:send',
      'projects:view', 'projects:edit', 'projects:complete',
      'teams:view', 'teams:create', 'teams:edit', 'teams:delete', 'teams:manage_members',
      'regions:view', 'regions:edit',
      'users:view', 'users:edit', 'users:manage_team', 'users:manage_region',
      'scheduling:view', 'scheduling:create', 'scheduling:edit', 'scheduling:manage_team', 'scheduling:manage_region',
      'reports:view_own', 'reports:view_team', 'reports:view_region', 'reports:export',
      'campaigns:view', 'campaigns:edit', 'campaigns:view_reports',
      'pricebook:view', 'pricebook:edit', 'admin:access'
    );

    -- 5. Operations
    INSERT INTO permission_presets (org_id, name, description, base_role, color, is_system, sort_order)
    VALUES (v_org.id, 'Operations', 'Project management, scheduling, reporting - no sales', 'operations', 'orange', true, 5)
    RETURNING id INTO v_preset_id;
    
    INSERT INTO preset_permissions (preset_id, permission_id)
    SELECT v_preset_id, id FROM permissions WHERE name IN (
      'leads:view', 'leads:view_inbound', 'leads:manage_inbound',
      'opportunities:view', 'proposals:view', 'contracts:view',
      'projects:view', 'projects:edit', 'projects:complete',
      'teams:view', 'users:view',
      'scheduling:view', 'scheduling:create', 'scheduling:edit', 'scheduling:manage_queue',
      'reports:view_own', 'reports:view_all', 'reports:export',
      'campaigns:view', 'campaigns:view_reports', 'pricebook:view'
    );

    -- 6. Inside Sales
    INSERT INTO permission_presets (org_id, name, description, base_role, color, is_system, sort_order)
    VALUES (v_org.id, 'Inside Sales', 'Handle inbound leads, phone sales, appointment setting', 'sales_rep', 'teal', true, 6)
    RETURNING id INTO v_preset_id;
    
    INSERT INTO preset_permissions (preset_id, permission_id)
    SELECT v_preset_id, id FROM permissions WHERE name IN (
      'leads:view', 'leads:create', 'leads:edit',
      'leads:view_inbound', 'leads:claim_inbound',
      'opportunities:view', 'opportunities:edit',
      'proposals:view', 'proposals:create', 'proposals:edit', 'proposals:send',
      'contracts:view', 'projects:view',
      'scheduling:view', 'scheduling:create', 'scheduling:edit',
      'reports:view_own', 'campaigns:view', 'teams:view', 'users:view'
    );

    -- 7. Administrator
    INSERT INTO permission_presets (org_id, name, description, base_role, color, is_system, sort_order)
    VALUES (v_org.id, 'Administrator', 'Full system access - all permissions', 'admin', 'red', true, 7)
    RETURNING id INTO v_preset_id;
    
    INSERT INTO preset_permissions (preset_id, permission_id)
    SELECT v_preset_id, id FROM permissions WHERE name = 'admin:full';

    RAISE NOTICE 'Created 7 presets for org: %', v_org.name;
  END LOOP;
  
  RAISE NOTICE 'Done!';
END $$;
