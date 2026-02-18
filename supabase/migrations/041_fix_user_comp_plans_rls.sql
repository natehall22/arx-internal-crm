-- Fix RLS policy for user_comp_plans to allow users to read their own assignments
-- The previous policy had issues with circular dependencies on the users table

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view their own comp plan assignments" ON user_comp_plans;
DROP POLICY IF EXISTS "Admins can manage user comp plans" ON user_comp_plans;

-- Simple policy: users can read their own comp plan assignments
CREATE POLICY "Users can view their own comp plan assignments" ON user_comp_plans
  FOR SELECT USING (user_id = auth.uid());

-- Admins can manage all comp plans in their org
CREATE POLICY "Admins can manage user comp plans" ON user_comp_plans
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() 
      AND users.org_id = user_comp_plans.org_id 
      AND users.role IN ('admin', 'owner')
    )
  );
