-- FULL Migration: Permissions, Campaigns, Lead Sources, and Presets
-- Run this in Supabase SQL Editor
-- This includes everything needed from scratch

-- ============================================
-- PART 1: Custom Roles and Permissions System
-- ============================================

-- Create custom_roles table
CREATE TABLE IF NOT EXISTS custom_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT,
  hierarchy_level INTEGER NOT NULL DEFAULT 0,
  is_system_role BOOLEAN NOT NULL DEFAULT false,
  parent_role_id UUID REFERENCES custom_roles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, name)
);

CREATE INDEX IF NOT EXISTS idx_custom_roles_org_id ON custom_roles(org_id);
CREATE INDEX IF NOT EXISTS idx_custom_roles_hierarchy ON custom_roles(org_id, hierarchy_level DESC);

-- Create permissions table
CREATE TABLE IF NOT EXISTS permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create role_permissions junction table
CREATE TABLE IF NOT EXISTS role_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id UUID NOT NULL REFERENCES custom_roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(role_id, permission_id)
);

CREATE INDEX IF NOT EXISTS idx_role_permissions_role_id ON role_permissions(role_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_permission_id ON role_permissions(permission_id);

-- Add custom_role_id to users table if not exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'custom_role_id') THEN
    ALTER TABLE users ADD COLUMN custom_role_id UUID REFERENCES custom_roles(id) ON DELETE SET NULL;
    CREATE INDEX idx_users_custom_role_id ON users(custom_role_id);
  END IF;
END $$;

-- Trigger for updated_at on custom_roles
DROP TRIGGER IF EXISTS update_custom_roles_updated_at ON custom_roles;
CREATE TRIGGER update_custom_roles_updated_at 
  BEFORE UPDATE ON custom_roles 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert all available permissions
INSERT INTO permissions (name, display_name, description, category) VALUES
-- Canvassing
('canvass:view', 'View Canvass Map', 'Access the canvassing map interface', 'Canvassing'),
('canvass:create', 'Create Canvass Pins', 'Drop new pins on the canvass map', 'Canvassing'),
('canvass:edit', 'Edit Canvass Pins', 'Modify existing canvass pins', 'Canvassing'),
('canvass:delete', 'Delete Canvass Pins', 'Remove canvass pins', 'Canvassing'),
('canvass:import', 'Import Leads CSV', 'Bulk import leads from CSV', 'Canvassing'),
('canvass:export', 'Export Leads CSV', 'Export leads to CSV', 'Canvassing'),
-- Leads
('leads:view', 'View Leads', 'Access lead records', 'Leads'),
('leads:create', 'Create Leads', 'Create new lead records', 'Leads'),
('leads:edit', 'Edit Leads', 'Modify lead information', 'Leads'),
('leads:delete', 'Delete Leads', 'Remove lead records', 'Leads'),
('leads:assign', 'Assign Leads', 'Assign leads to other users', 'Leads'),
('leads:view_inbound', 'View Inbound Leads', 'Access leads from website, ads, and other inbound sources', 'Leads'),
('leads:manage_inbound', 'Manage Inbound Leads', 'Assign and manage inbound lead queue', 'Leads'),
('leads:claim_inbound', 'Claim Inbound Leads', 'Claim leads from the inbound queue', 'Leads'),
-- Opportunities
('opportunities:view', 'View Opportunities', 'Access opportunity records', 'Opportunities'),
('opportunities:edit', 'Edit Opportunities', 'Modify opportunity information', 'Opportunities'),
('opportunities:delete', 'Delete Opportunities', 'Remove opportunity records', 'Opportunities'),
-- Proposals
('proposals:view', 'View Proposals', 'Access proposal documents', 'Proposals'),
('proposals:create', 'Create Proposals', 'Generate new proposals', 'Proposals'),
('proposals:edit', 'Edit Proposals', 'Modify proposal content', 'Proposals'),
('proposals:send', 'Send Proposals', 'Send proposals to customers', 'Proposals'),
-- Contracts
('contracts:view', 'View Contracts', 'Access contract documents', 'Contracts'),
('contracts:create', 'Create Contracts', 'Generate new contracts', 'Contracts'),
('contracts:send', 'Send Contracts', 'Send contracts for signature', 'Contracts'),
-- Projects
('projects:view', 'View Projects', 'Access project records', 'Projects'),
('projects:edit', 'Edit Projects', 'Modify project information', 'Projects'),
('projects:delete', 'Delete Projects', 'Remove project records', 'Projects'),
('projects:complete', 'Complete Projects', 'Mark projects as complete', 'Projects'),
-- Reports
('reports:view_own', 'View Own Reports', 'See personal performance metrics', 'Reports'),
('reports:view_team', 'View Team Reports', 'See team performance metrics', 'Reports'),
('reports:view_region', 'View Region Reports', 'See regional performance metrics', 'Reports'),
('reports:view_all', 'View All Reports', 'See organization-wide metrics', 'Reports'),
('reports:export', 'Export Reports', 'Download reports as Excel/CSV', 'Reports'),
('reports:create', 'Create Custom Reports', 'Build custom report templates', 'Reports'),
-- Teams
('teams:view', 'View Teams', 'See team information', 'Teams'),
('teams:create', 'Create Teams', 'Create new teams', 'Teams'),
('teams:edit', 'Edit Teams', 'Modify team settings', 'Teams'),
('teams:delete', 'Delete Teams', 'Remove teams', 'Teams'),
('teams:manage_members', 'Manage Team Members', 'Add/remove team members', 'Teams'),
-- Regions
('regions:view', 'View Regions', 'See region information', 'Regions'),
('regions:create', 'Create Regions', 'Create new regions', 'Regions'),
('regions:edit', 'Edit Regions', 'Modify region settings', 'Regions'),
('regions:delete', 'Delete Regions', 'Remove regions', 'Regions'),
-- Users
('users:view', 'View Users', 'See user profiles', 'Users'),
('users:create', 'Create Users', 'Add new user accounts', 'Users'),
('users:edit', 'Edit Users', 'Modify user information', 'Users'),
('users:edit_roles', 'Edit User Roles', 'Change user role assignments', 'Users'),
('users:deactivate', 'Deactivate Users', 'Disable user accounts', 'Users'),
('users:manage_team', 'Manage Team Users', 'Manage users in own team', 'Users'),
('users:manage_region', 'Manage Region Users', 'Manage users in own region', 'Users'),
('users:manage_all', 'Manage All Users', 'Full user management access', 'Users'),
-- Scheduling
('scheduling:view', 'View Schedule', 'See appointment calendar', 'Scheduling'),
('scheduling:create', 'Create Appointments', 'Schedule new appointments', 'Scheduling'),
('scheduling:edit', 'Edit Appointments', 'Modify appointments', 'Scheduling'),
('scheduling:manage_team', 'Manage Team Schedule', 'Configure team scheduling', 'Scheduling'),
('scheduling:manage_region', 'Manage Region Schedule', 'Configure regional scheduling', 'Scheduling'),
('scheduling:manage_queue', 'Manage Closer Queue', 'Configure round-robin queue', 'Scheduling'),
-- Pricebook
('pricebook:view', 'View Pricebook', 'Access pricing information', 'Pricebook'),
('pricebook:edit', 'Edit Pricebook', 'Modify pricing and items', 'Pricebook'),
-- Campaigns
('campaigns:view', 'View Campaigns', 'See marketing campaign data', 'Campaigns'),
('campaigns:create', 'Create Campaigns', 'Create new marketing campaigns', 'Campaigns'),
('campaigns:edit', 'Edit Campaigns', 'Modify campaign settings', 'Campaigns'),
('campaigns:delete', 'Delete Campaigns', 'Remove campaigns', 'Campaigns'),
('campaigns:view_reports', 'View Campaign Reports', 'Access campaign performance reports', 'Campaigns'),
-- Lead Sources
('lead_sources:view', 'View Lead Sources', 'See lead source configurations', 'Leads'),
('lead_sources:manage', 'Manage Lead Sources', 'Configure webhook endpoints and field mappings', 'Leads'),
-- Admin
('admin:access', 'Access Admin Panel', 'Enter admin settings area', 'Admin'),
('admin:roles', 'Manage Roles', 'Create and edit roles', 'Admin'),
('admin:permissions', 'Manage Permissions', 'Assign permissions to roles', 'Admin'),
('admin:settings', 'Manage Settings', 'Configure system settings', 'Admin'),
('admin:full', 'Full Admin Access', 'Complete administrative control', 'Admin')
ON CONFLICT (name) DO NOTHING;

-- RLS Policies for custom_roles
ALTER TABLE custom_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view roles in their org" ON custom_roles;
CREATE POLICY "Users can view roles in their org"
  ON custom_roles FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Admins can manage roles" ON custom_roles;
CREATE POLICY "Admins can manage roles"
  ON custom_roles FOR ALL
  USING (
    org_id = get_user_org_id(auth.uid()) 
    AND get_user_role(auth.uid()) IN ('admin', 'regional_manager')
  );

-- RLS Policies for permissions
ALTER TABLE permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view permissions" ON permissions;
CREATE POLICY "Authenticated users can view permissions"
  ON permissions FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- RLS Policies for role_permissions
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view role permissions in their org" ON role_permissions;
CREATE POLICY "Users can view role permissions in their org"
  ON role_permissions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM custom_roles cr
      WHERE cr.id = role_permissions.role_id
      AND cr.org_id = get_user_org_id(auth.uid())
    )
  );

DROP POLICY IF EXISTS "Admins can manage role permissions" ON role_permissions;
CREATE POLICY "Admins can manage role permissions"
  ON role_permissions FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM custom_roles cr
      WHERE cr.id = role_permissions.role_id
      AND cr.org_id = get_user_org_id(auth.uid())
    )
    AND get_user_role(auth.uid()) IN ('admin', 'regional_manager')
  );

-- Helper function to check if user has a specific permission
CREATE OR REPLACE FUNCTION user_has_permission(user_uuid UUID, permission_name TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  user_record RECORD;
BEGIN
  SELECT role, custom_role_id INTO user_record
  FROM users WHERE id = user_uuid;
  
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;
  
  IF user_record.role = 'admin' THEN
    RETURN TRUE;
  END IF;
  
  -- Check user-specific permissions first
  IF EXISTS (
    SELECT 1 FROM user_permissions up
    JOIN permissions p ON p.id = up.permission_id
    WHERE up.user_id = user_uuid
    AND p.name = permission_name
    AND (up.expires_at IS NULL OR up.expires_at > NOW())
  ) THEN
    RETURN TRUE;
  END IF;
  
  IF user_record.custom_role_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM role_permissions rp
      JOIN permissions p ON p.id = rp.permission_id
      WHERE rp.role_id = user_record.custom_role_id
      AND (p.name = permission_name OR p.name = 'admin:full')
    ) THEN
      RETURN TRUE;
    END IF;
  END IF;
  
  RETURN CASE user_record.role
    WHEN 'regional_manager' THEN permission_name IN (
      'canvass:view', 'leads:view', 'leads:view_inbound', 'leads:manage_inbound',
      'opportunities:view', 'opportunities:edit',
      'proposals:view', 'proposals:edit', 'contracts:view', 'contracts:send',
      'projects:view', 'projects:edit', 'reports:view_own', 'reports:view_team',
      'reports:view_region', 'reports:export', 'teams:view', 'teams:create',
      'teams:edit', 'regions:view', 'regions:create', 'regions:edit',
      'users:view', 'users:manage_team', 'users:manage_region',
      'scheduling:view', 'scheduling:manage_team', 'scheduling:manage_region',
      'campaigns:view', 'campaigns:edit', 'campaigns:view_reports',
      'pricebook:view', 'admin:access'
    )
    WHEN 'sales_manager' THEN permission_name IN (
      'canvass:view', 'leads:view', 'opportunities:view', 'opportunities:edit',
      'proposals:view', 'proposals:edit', 'contracts:view', 'contracts:send',
      'projects:view', 'reports:view_own', 'reports:view_team', 'reports:export',
      'teams:view', 'teams:create', 'teams:edit', 'users:view', 'users:manage_team',
      'scheduling:view', 'scheduling:manage_team', 'pricebook:view'
    )
    WHEN 'sales_rep' THEN permission_name IN (
      'canvass:view', 'leads:view', 'opportunities:view', 'opportunities:edit',
      'proposals:view', 'proposals:edit', 'contracts:view', 'contracts:send',
      'projects:view', 'reports:view_own', 'teams:view', 'users:view',
      'scheduling:view', 'pricebook:view'
    )
    WHEN 'canvasser' THEN permission_name IN (
      'canvass:view', 'canvass:create', 'canvass:edit', 'leads:view',
      'leads:create', 'leads:edit', 'opportunities:view', 'reports:view_own',
      'teams:view', 'users:view', 'scheduling:view'
    )
    WHEN 'operations' THEN permission_name IN (
      'canvass:view', 'leads:view', 'leads:view_inbound', 'leads:manage_inbound',
      'opportunities:view', 'opportunities:edit',
      'proposals:view', 'contracts:view', 'projects:view', 'projects:edit',
      'reports:view_own', 'reports:view_all', 'reports:export', 'teams:view',
      'users:view', 'scheduling:view', 'campaigns:view', 'campaigns:view_reports',
      'pricebook:view'
    )
    ELSE FALSE
  END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Helper function to get user's hierarchy level
CREATE OR REPLACE FUNCTION get_user_hierarchy_level(user_uuid UUID)
RETURNS INTEGER AS $$
DECLARE
  user_record RECORD;
  hierarchy INTEGER;
BEGIN
  SELECT role, custom_role_id INTO user_record
  FROM users WHERE id = user_uuid;
  
  IF NOT FOUND THEN
    RETURN 0;
  END IF;
  
  IF user_record.custom_role_id IS NOT NULL THEN
    SELECT hierarchy_level INTO hierarchy
    FROM custom_roles WHERE id = user_record.custom_role_id;
    RETURN COALESCE(hierarchy, 0);
  END IF;
  
  RETURN CASE user_record.role
    WHEN 'admin' THEN 100
    WHEN 'regional_manager' THEN 80
    WHEN 'sales_manager' THEN 60
    WHEN 'operations' THEN 50
    WHEN 'sales_rep' THEN 40
    WHEN 'canvasser' THEN 20
    ELSE 0
  END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- PART 2: User Permissions Table
-- ============================================

CREATE TABLE IF NOT EXISTS user_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  granted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  notes TEXT,
  UNIQUE(user_id, permission_id)
);

CREATE INDEX IF NOT EXISTS idx_user_permissions_user_id ON user_permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_permissions_org_id ON user_permissions(org_id);

ALTER TABLE user_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own permissions" ON user_permissions;
CREATE POLICY "Users can view their own permissions"
  ON user_permissions FOR SELECT
  USING (user_id = auth.uid() OR org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Admins can manage user permissions" ON user_permissions;
CREATE POLICY "Admins can manage user permissions"
  ON user_permissions FOR ALL
  USING (
    org_id = get_user_org_id(auth.uid())
    AND get_user_role(auth.uid()) IN ('admin', 'regional_manager')
  );

-- ============================================
-- PART 3: Permission Presets
-- ============================================

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

CREATE TABLE IF NOT EXISTS preset_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  preset_id UUID NOT NULL REFERENCES permission_presets(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(preset_id, permission_id)
);

CREATE INDEX IF NOT EXISTS idx_preset_permissions_preset_id ON preset_permissions(preset_id);

DROP TRIGGER IF EXISTS update_permission_presets_updated_at ON permission_presets;
CREATE TRIGGER update_permission_presets_updated_at 
  BEFORE UPDATE ON permission_presets 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE permission_presets ENABLE ROW LEVEL SECURITY;
ALTER TABLE preset_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view permission presets in their org" ON permission_presets;
CREATE POLICY "Users can view permission presets in their org"
  ON permission_presets FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Admins can manage permission presets" ON permission_presets;
CREATE POLICY "Admins can manage permission presets"
  ON permission_presets FOR ALL
  USING (
    org_id = get_user_org_id(auth.uid())
    AND get_user_role(auth.uid()) IN ('admin', 'regional_manager')
  );

DROP POLICY IF EXISTS "Users can view preset permissions in their org" ON preset_permissions;
CREATE POLICY "Users can view preset permissions in their org"
  ON preset_permissions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM permission_presets pp
      WHERE pp.id = preset_permissions.preset_id
      AND pp.org_id = get_user_org_id(auth.uid())
    )
  );

DROP POLICY IF EXISTS "Admins can manage preset permissions" ON preset_permissions;
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
-- PART 4: Campaigns and Lead Sources
-- ============================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lead_source_type') THEN
    CREATE TYPE lead_source_type AS ENUM (
      'website', 'google_ads', 'facebook', 'instagram', 'tiktok', 'youtube',
      'bing_ads', 'referral', 'canvass', 'door_knock', 'phone_call',
      'walk_in', 'home_show', 'partner', 'other'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lead_channel') THEN
    CREATE TYPE lead_channel AS ENUM ('inbound', 'outbound');
  END IF;
END $$;

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
CREATE INDEX IF NOT EXISTS idx_campaigns_is_active ON campaigns(is_active);

CREATE TABLE IF NOT EXISTS lead_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  source_type lead_source_type NOT NULL,
  webhook_token TEXT NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  webhook_enabled BOOLEAN NOT NULL DEFAULT true,
  default_campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  field_mapping JSONB DEFAULT '{"name": "name", "email": "email", "phone": "phone", "address": "address", "message": "notes"}'::jsonb,
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

-- Add columns to leads table
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

-- RLS for campaigns
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbound_lead_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view campaigns in their org" ON campaigns;
CREATE POLICY "Users can view campaigns in their org"
  ON campaigns FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Admins can manage campaigns" ON campaigns;
CREATE POLICY "Admins can manage campaigns"
  ON campaigns FOR ALL
  USING (
    org_id = get_user_org_id(auth.uid())
    AND get_user_role(auth.uid()) IN ('admin', 'regional_manager')
  );

DROP POLICY IF EXISTS "Admins can view lead sources" ON lead_sources;
CREATE POLICY "Admins can view lead sources"
  ON lead_sources FOR SELECT
  USING (
    org_id = get_user_org_id(auth.uid())
    AND get_user_role(auth.uid()) IN ('admin', 'regional_manager')
  );

DROP POLICY IF EXISTS "Admins can manage lead sources" ON lead_sources;
CREATE POLICY "Admins can manage lead sources"
  ON lead_sources FOR ALL
  USING (
    org_id = get_user_org_id(auth.uid())
    AND get_user_role(auth.uid()) IN ('admin', 'regional_manager')
  );

DROP POLICY IF EXISTS "Users can view inbound queue" ON inbound_lead_queue;
CREATE POLICY "Users can view inbound queue"
  ON inbound_lead_queue FOR SELECT
  USING (
    org_id = get_user_org_id(auth.uid())
    AND (
      get_user_role(auth.uid()) IN ('admin', 'regional_manager', 'operations')
      OR assigned_to = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Admins can manage inbound queue" ON inbound_lead_queue;
CREATE POLICY "Admins can manage inbound queue"
  ON inbound_lead_queue FOR ALL
  USING (
    org_id = get_user_org_id(auth.uid())
    AND get_user_role(auth.uid()) IN ('admin', 'regional_manager')
  );

-- ============================================
-- PART 5: Initialize Default Presets
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

SELECT 'Migration complete!' as status;
