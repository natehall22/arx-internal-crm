-- User-specific Permission Overrides
-- Migration: 029_user_permissions.sql
-- Allows granting specific permissions to individual users beyond their role

-- Create user_permissions table for individual permission grants
CREATE TABLE user_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  granted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ, -- Optional expiration
  notes TEXT,
  UNIQUE(user_id, permission_id)
);

CREATE INDEX idx_user_permissions_user_id ON user_permissions(user_id);
CREATE INDEX idx_user_permissions_org_id ON user_permissions(org_id);
CREATE INDEX idx_user_permissions_permission_id ON user_permissions(permission_id);

-- RLS Policies
ALTER TABLE user_permissions ENABLE ROW LEVEL SECURITY;

-- Users can view their own permissions
CREATE POLICY "Users can view their own permissions"
  ON user_permissions FOR SELECT
  USING (user_id = auth.uid() OR org_id = get_user_org_id(auth.uid()));

-- Admins can manage user permissions
CREATE POLICY "Admins can manage user permissions"
  ON user_permissions FOR ALL
  USING (
    org_id = get_user_org_id(auth.uid())
    AND get_user_role(auth.uid()) IN ('admin', 'regional_manager')
  );

-- Update the user_has_permission function to check user_permissions table
CREATE OR REPLACE FUNCTION user_has_permission(user_uuid UUID, permission_name TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  user_record RECORD;
BEGIN
  -- Get user's role info
  SELECT role, custom_role_id, org_id INTO user_record
  FROM users WHERE id = user_uuid;
  
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;
  
  -- Legacy admin check - admins have all permissions
  IF user_record.role = 'admin' THEN
    RETURN TRUE;
  END IF;
  
  -- Check user-specific permission grants first (highest priority)
  IF EXISTS (
    SELECT 1 
    FROM user_permissions up
    JOIN permissions p ON p.id = up.permission_id
    WHERE up.user_id = user_uuid
    AND p.name = permission_name
    AND (up.expires_at IS NULL OR up.expires_at > NOW())
  ) THEN
    RETURN TRUE;
  END IF;
  
  -- Check custom role permissions
  IF user_record.custom_role_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 
      FROM role_permissions rp
      JOIN permissions p ON p.id = rp.permission_id
      WHERE rp.role_id = user_record.custom_role_id
      AND (p.name = permission_name OR p.name = 'admin:full')
    ) THEN
      RETURN TRUE;
    END IF;
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
      'scheduling:view', 'scheduling:manage_team'
    )
    WHEN 'sales_rep' THEN permission_name IN (
      'canvass:view', 'leads:view', 'opportunities:view', 'opportunities:edit',
      'proposals:view', 'proposals:edit', 'contracts:view', 'contracts:send',
      'projects:view', 'reports:view_own', 'teams:view', 'users:view',
      'scheduling:view'
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

-- Helper function to get all permissions for a user (for UI display)
CREATE OR REPLACE FUNCTION get_user_permissions(user_uuid UUID)
RETURNS TABLE (
  permission_name TEXT,
  display_name TEXT,
  category TEXT,
  source TEXT -- 'role', 'custom_role', 'user_grant'
) AS $$
DECLARE
  user_record RECORD;
BEGIN
  SELECT role, custom_role_id INTO user_record
  FROM users WHERE id = user_uuid;
  
  IF NOT FOUND THEN
    RETURN;
  END IF;
  
  -- Return user-specific grants
  RETURN QUERY
  SELECT p.name, p.display_name, p.category, 'user_grant'::TEXT
  FROM user_permissions up
  JOIN permissions p ON p.id = up.permission_id
  WHERE up.user_id = user_uuid
  AND (up.expires_at IS NULL OR up.expires_at > NOW());
  
  -- Return custom role permissions
  IF user_record.custom_role_id IS NOT NULL THEN
    RETURN QUERY
    SELECT p.name, p.display_name, p.category, 'custom_role'::TEXT
    FROM role_permissions rp
    JOIN permissions p ON p.id = rp.permission_id
    WHERE rp.role_id = user_record.custom_role_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON TABLE user_permissions IS 'Individual permission grants for users beyond their role permissions';
