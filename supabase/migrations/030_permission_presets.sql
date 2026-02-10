-- Permission Presets (Batch Permissions)
-- Migration: 030_permission_presets.sql
-- Allows admins to create reusable permission templates

-- Create permission_presets table
CREATE TABLE permission_presets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  base_role TEXT NOT NULL DEFAULT 'sales_rep', -- The legacy role to assign
  icon TEXT, -- Optional icon identifier
  color TEXT DEFAULT 'gray', -- For UI display
  is_system BOOLEAN NOT NULL DEFAULT false, -- System presets can't be deleted
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE(org_id, name)
);

CREATE INDEX idx_permission_presets_org_id ON permission_presets(org_id);

-- Create preset_permissions junction table
CREATE TABLE preset_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  preset_id UUID NOT NULL REFERENCES permission_presets(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(preset_id, permission_id)
);

CREATE INDEX idx_preset_permissions_preset_id ON preset_permissions(preset_id);

-- Trigger for updated_at
CREATE TRIGGER update_permission_presets_updated_at 
  BEFORE UPDATE ON permission_presets 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS Policies
ALTER TABLE permission_presets ENABLE ROW LEVEL SECURITY;
ALTER TABLE preset_permissions ENABLE ROW LEVEL SECURITY;

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

-- Function to create default presets for an organization
CREATE OR REPLACE FUNCTION create_default_permission_presets(p_org_id UUID, p_created_by UUID DEFAULT NULL)
RETURNS void AS $$
DECLARE
  v_preset_id UUID;
  v_perm_id UUID;
BEGIN
  -- Setter / Canvasser preset
  INSERT INTO permission_presets (org_id, name, description, base_role, color, is_system, sort_order, created_by)
  VALUES (p_org_id, 'Setter / Canvasser', 'Door-to-door canvassing, lead creation, basic scheduling', 'canvasser', 'green', true, 1, p_created_by)
  RETURNING id INTO v_preset_id;
  
  INSERT INTO preset_permissions (preset_id, permission_id)
  SELECT v_preset_id, id FROM permissions WHERE name IN (
    'canvass:view', 'canvass:create', 'canvass:edit',
    'leads:view', 'leads:create', 'leads:edit',
    'scheduling:view',
    'reports:view_own',
    'teams:view',
    'users:view'
  );

  -- Sales Representative preset
  INSERT INTO permission_presets (org_id, name, description, base_role, color, is_system, sort_order, created_by)
  VALUES (p_org_id, 'Sales Representative', 'Full sales cycle - leads, opportunities, proposals, contracts', 'sales_rep', 'blue', true, 2, p_created_by)
  RETURNING id INTO v_preset_id;
  
  INSERT INTO preset_permissions (preset_id, permission_id)
  SELECT v_preset_id, id FROM permissions WHERE name IN (
    'canvass:view',
    'leads:view', 'leads:create', 'leads:edit',
    'opportunities:view', 'opportunities:edit',
    'proposals:view', 'proposals:create', 'proposals:edit', 'proposals:send',
    'contracts:view', 'contracts:create', 'contracts:send',
    'projects:view',
    'scheduling:view', 'scheduling:create', 'scheduling:edit',
    'reports:view_own',
    'teams:view',
    'users:view'
  );

  -- Sales Manager preset
  INSERT INTO permission_presets (org_id, name, description, base_role, color, is_system, sort_order, created_by)
  VALUES (p_org_id, 'Sales Manager', 'Team management, reporting, full sales access', 'sales_manager', 'purple', true, 3, p_created_by)
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

  -- Regional Manager preset
  INSERT INTO permission_presets (org_id, name, description, base_role, color, is_system, sort_order, created_by)
  VALUES (p_org_id, 'Regional Manager', 'Regional oversight, all team management, admin access', 'regional_manager', 'indigo', true, 4, p_created_by)
  RETURNING id INTO v_preset_id;
  
  INSERT INTO preset_permissions (preset_id, permission_id)
  SELECT v_preset_id, id FROM permissions WHERE name IN (
    'canvass:view', 'canvass:create', 'canvass:edit', 'canvass:delete', 'canvass:import', 'canvass:export',
    'leads:view', 'leads:create', 'leads:edit', 'leads:delete', 'leads:assign',
    'opportunities:view', 'opportunities:edit', 'opportunities:delete',
    'proposals:view', 'proposals:create', 'proposals:edit', 'proposals:send',
    'contracts:view', 'contracts:create', 'contracts:send',
    'projects:view', 'projects:edit', 'projects:complete',
    'teams:view', 'teams:create', 'teams:edit', 'teams:delete', 'teams:manage_members',
    'regions:view', 'regions:edit',
    'users:view', 'users:edit', 'users:manage_team', 'users:manage_region',
    'scheduling:view', 'scheduling:create', 'scheduling:edit', 'scheduling:manage_team', 'scheduling:manage_region',
    'reports:view_own', 'reports:view_team', 'reports:view_region', 'reports:export',
    'pricebook:view', 'pricebook:edit',
    'admin:access'
  );

  -- Operations preset
  INSERT INTO permission_presets (org_id, name, description, base_role, color, is_system, sort_order, created_by)
  VALUES (p_org_id, 'Operations', 'Project management, scheduling, reporting - no sales', 'operations', 'orange', true, 5, p_created_by)
  RETURNING id INTO v_preset_id;
  
  INSERT INTO preset_permissions (preset_id, permission_id)
  SELECT v_preset_id, id FROM permissions WHERE name IN (
    'leads:view',
    'opportunities:view',
    'proposals:view',
    'contracts:view',
    'projects:view', 'projects:edit', 'projects:complete',
    'teams:view',
    'users:view',
    'scheduling:view', 'scheduling:create', 'scheduling:edit', 'scheduling:manage_queue',
    'reports:view_own', 'reports:view_all', 'reports:export',
    'pricebook:view'
  );

  -- Administrator preset
  INSERT INTO permission_presets (org_id, name, description, base_role, color, is_system, sort_order, created_by)
  VALUES (p_org_id, 'Administrator', 'Full system access - all permissions', 'admin', 'red', true, 6, p_created_by)
  RETURNING id INTO v_preset_id;
  
  INSERT INTO preset_permissions (preset_id, permission_id)
  SELECT v_preset_id, id FROM permissions WHERE name = 'admin:full';

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON TABLE permission_presets IS 'Reusable permission templates for quick user setup';
COMMENT ON TABLE preset_permissions IS 'Junction table linking presets to their permissions';
COMMENT ON FUNCTION create_default_permission_presets IS 'Creates default permission presets for a new organization';
