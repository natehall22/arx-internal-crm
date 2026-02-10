-- Custom Roles and Permissions System
-- Migration: 014_custom_roles_permissions.sql
-- Allows creating new roles dynamically with configurable permissions

-- Create custom_roles table to store role definitions
CREATE TABLE custom_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT,
  hierarchy_level INTEGER NOT NULL DEFAULT 0, -- Higher = more authority
  is_system_role BOOLEAN NOT NULL DEFAULT false, -- System roles can't be deleted
  parent_role_id UUID REFERENCES custom_roles(id) ON DELETE SET NULL, -- For role inheritance
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, name)
);

CREATE INDEX idx_custom_roles_org_id ON custom_roles(org_id);
CREATE INDEX idx_custom_roles_hierarchy ON custom_roles(org_id, hierarchy_level DESC);

-- Create permissions table to define all available permissions
CREATE TABLE permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE, -- e.g., 'canvass:view', 'leads:edit'
  display_name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL, -- e.g., 'Canvassing', 'Leads', 'Reports'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create role_permissions junction table
CREATE TABLE role_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id UUID NOT NULL REFERENCES custom_roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(role_id, permission_id)
);

CREATE INDEX idx_role_permissions_role_id ON role_permissions(role_id);
CREATE INDEX idx_role_permissions_permission_id ON role_permissions(permission_id);

-- Add custom_role_id to users table (nullable, for migration)
ALTER TABLE users ADD COLUMN custom_role_id UUID REFERENCES custom_roles(id) ON DELETE SET NULL;
CREATE INDEX idx_users_custom_role_id ON users(custom_role_id);

-- Triggers for updated_at
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

-- Admin
('admin:access', 'Access Admin Panel', 'Enter admin settings area', 'Admin'),
('admin:roles', 'Manage Roles', 'Create and edit roles', 'Admin'),
('admin:permissions', 'Manage Permissions', 'Assign permissions to roles', 'Admin'),
('admin:settings', 'Manage Settings', 'Configure system settings', 'Admin'),
('admin:full', 'Full Admin Access', 'Complete administrative control', 'Admin');

-- RLS Policies for custom_roles
ALTER TABLE custom_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view roles in their org"
  ON custom_roles FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

CREATE POLICY "Admins can manage roles"
  ON custom_roles FOR ALL
  USING (
    org_id = get_user_org_id(auth.uid()) 
    AND EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() 
      AND (
        role = 'admin' 
        OR custom_role_id IN (
          SELECT cr.id FROM custom_roles cr
          JOIN role_permissions rp ON rp.role_id = cr.id
          JOIN permissions p ON p.id = rp.permission_id
          WHERE p.name = 'admin:roles'
        )
      )
    )
  );

-- RLS Policies for permissions (read-only for all authenticated users)
ALTER TABLE permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view permissions"
  ON permissions FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- RLS Policies for role_permissions
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view role permissions in their org"
  ON role_permissions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM custom_roles cr
      WHERE cr.id = role_permissions.role_id
      AND cr.org_id = get_user_org_id(auth.uid())
    )
  );

CREATE POLICY "Admins can manage role permissions"
  ON role_permissions FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM custom_roles cr
      WHERE cr.id = role_permissions.role_id
      AND cr.org_id = get_user_org_id(auth.uid())
    )
    AND EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() 
      AND (
        role = 'admin' 
        OR custom_role_id IN (
          SELECT cr2.id FROM custom_roles cr2
          JOIN role_permissions rp ON rp.role_id = cr2.id
          JOIN permissions p ON p.id = rp.permission_id
          WHERE p.name = 'admin:permissions'
        )
      )
    )
  );

-- Helper function to check if user has a specific permission (dynamic)
CREATE OR REPLACE FUNCTION user_has_permission(user_uuid UUID, permission_name TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  user_record RECORD;
BEGIN
  -- Get user's role info
  SELECT role, custom_role_id INTO user_record
  FROM users WHERE id = user_uuid;
  
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;
  
  -- Legacy admin check
  IF user_record.role = 'admin' THEN
    RETURN TRUE;
  END IF;
  
  -- Check custom role permissions
  IF user_record.custom_role_id IS NOT NULL THEN
    RETURN EXISTS (
      SELECT 1 
      FROM role_permissions rp
      JOIN permissions p ON p.id = rp.permission_id
      WHERE rp.role_id = user_record.custom_role_id
      AND (p.name = permission_name OR p.name = 'admin:full')
    );
  END IF;
  
  -- Fallback to legacy role-based check
  RETURN CASE user_record.role
    WHEN 'regional_manager' THEN permission_name IN (
      'canvass:view', 'leads:view', 'opportunities:view', 'opportunities:edit',
      'proposals:view', 'proposals:edit', 'contracts:view', 'contracts:send',
      'projects:view', 'projects:edit', 'reports:view_own', 'reports:view_team',
      'reports:view_region', 'reports:export', 'teams:view', 'teams:create',
      'teams:edit', 'regions:view', 'regions:create', 'regions:edit',
      'users:view', 'users:manage_team', 'users:manage_region',
      'scheduling:view', 'scheduling:manage_team', 'scheduling:manage_region',
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
      'canvass:view', 'leads:view', 'opportunities:view', 'opportunities:edit',
      'proposals:view', 'contracts:view', 'projects:view', 'projects:edit',
      'reports:view_own', 'reports:view_all', 'reports:export', 'teams:view',
      'users:view', 'scheduling:view', 'pricebook:view'
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
  
  -- Check custom role hierarchy
  IF user_record.custom_role_id IS NOT NULL THEN
    SELECT hierarchy_level INTO hierarchy
    FROM custom_roles WHERE id = user_record.custom_role_id;
    RETURN COALESCE(hierarchy, 0);
  END IF;
  
  -- Legacy role hierarchy
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

-- Function to check if user can manage another user based on hierarchy
CREATE OR REPLACE FUNCTION can_manage_user(manager_uuid UUID, target_uuid UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN get_user_hierarchy_level(manager_uuid) > get_user_hierarchy_level(target_uuid);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
