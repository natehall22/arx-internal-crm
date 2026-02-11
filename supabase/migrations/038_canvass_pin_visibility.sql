-- Canvass Pin Visibility Controls
-- Migration: 038_canvass_pin_visibility.sql
-- Allows admins to control what pins each rep can see in the canvassing app

-- Add canvass_pin_visibility column to users table
-- Options: 'own' (only their pins), 'team' (their team's pins), 'region' (their region's pins), 'org' (all org pins)
ALTER TABLE users 
  ADD COLUMN IF NOT EXISTS canvass_pin_visibility TEXT NOT NULL DEFAULT 'org';

-- Add constraint to ensure valid values
ALTER TABLE users 
  ADD CONSTRAINT users_canvass_pin_visibility_check 
  CHECK (canvass_pin_visibility IN ('own', 'team', 'region', 'org'));

-- Add index for efficient filtering
CREATE INDEX IF NOT EXISTS idx_users_canvass_pin_visibility ON users(canvass_pin_visibility);

-- Add comment explaining the field
COMMENT ON COLUMN users.canvass_pin_visibility IS 'Controls which pins the user can see in canvassing app: own (only their pins), team (team pins), region (region pins), org (all company pins)';

-- Helper function to get visible lead IDs for canvassing based on user's visibility setting
CREATE OR REPLACE FUNCTION get_canvass_visible_user_ids(user_uuid UUID)
RETURNS SETOF UUID AS $$
DECLARE
  user_record RECORD;
BEGIN
  -- Get user's visibility setting and assignments
  SELECT 
    u.id,
    u.org_id,
    u.team_id,
    u.region_id,
    u.canvass_pin_visibility,
    u.role
  INTO user_record
  FROM users u
  WHERE u.id = user_uuid;
  
  IF NOT FOUND THEN
    RETURN;
  END IF;
  
  -- Admins and managers always see all org pins regardless of setting
  IF user_record.role IN ('admin', 'regional_manager', 'sales_manager', 'operations') THEN
    RETURN QUERY
    SELECT id FROM users WHERE org_id = user_record.org_id;
    RETURN;
  END IF;
  
  -- Apply visibility filter based on setting
  CASE user_record.canvass_pin_visibility
    WHEN 'own' THEN
      -- Only return the user's own ID
      RETURN NEXT user_uuid;
      
    WHEN 'team' THEN
      -- Return all users in the same team
      IF user_record.team_id IS NOT NULL THEN
        RETURN QUERY
        SELECT id FROM users 
        WHERE org_id = user_record.org_id 
        AND team_id = user_record.team_id;
      ELSE
        -- No team assigned, fall back to own
        RETURN NEXT user_uuid;
      END IF;
      
    WHEN 'region' THEN
      -- Return all users in the same region
      IF user_record.region_id IS NOT NULL THEN
        RETURN QUERY
        SELECT id FROM users 
        WHERE org_id = user_record.org_id 
        AND region_id = user_record.region_id;
      ELSIF user_record.team_id IS NOT NULL THEN
        -- No region but has team, get region from team
        RETURN QUERY
        SELECT u.id FROM users u
        JOIN teams t ON u.team_id = t.id
        WHERE u.org_id = user_record.org_id 
        AND t.region_id = (
          SELECT region_id FROM teams WHERE id = user_record.team_id
        );
      ELSE
        -- No region or team, fall back to own
        RETURN NEXT user_uuid;
      END IF;
      
    WHEN 'org' THEN
      -- Return all users in the org
      RETURN QUERY
      SELECT id FROM users WHERE org_id = user_record.org_id;
      
    ELSE
      -- Default to own for safety
      RETURN NEXT user_uuid;
  END CASE;
  
  RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION get_canvass_visible_user_ids IS 'Returns user IDs whose canvass pins should be visible to the given user based on their visibility setting';
