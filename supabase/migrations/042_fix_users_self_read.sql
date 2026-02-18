-- Allow users to always read their own profile
-- This fixes the circular dependency issue where get_user_org_id needs to read users

-- Add policy for users to read their own row (this should work even if org-based policy fails)
DROP POLICY IF EXISTS "Users can read own profile" ON users;
CREATE POLICY "Users can read own profile" ON users
  FOR SELECT USING (id = auth.uid());
