-- Fix RLS policy for regions to include legacy 'manager' role
-- Migration: 026_fix_regions_rls_policy.sql

-- Drop the existing policy
DROP POLICY IF EXISTS "Admins and regional managers can manage regions" ON regions;

-- Create updated policy that includes sales_manager (which is what 'manager' maps to)
CREATE POLICY "Admins and managers can manage regions"
  ON regions FOR ALL
  USING (
    org_id = get_user_org_id(auth.uid()) 
    AND EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() 
      AND role IN ('admin', 'regional_manager', 'sales_manager')
    )
  );

-- Also update the helper function to include sales_manager
CREATE OR REPLACE FUNCTION can_manage_regions(user_uuid UUID)
RETURNS BOOLEAN AS $$
  SELECT role IN ('admin', 'regional_manager', 'sales_manager') 
  FROM users WHERE id = user_uuid;
$$ LANGUAGE sql SECURITY DEFINER;
