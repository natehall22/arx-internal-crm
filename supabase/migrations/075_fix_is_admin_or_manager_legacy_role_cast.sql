-- Fix legacy helper function that still referenced 'manager' as enum literal.
-- Using role::text avoids enum-cast failures in partially migrated environments.
CREATE OR REPLACE FUNCTION is_admin_or_manager(user_uuid UUID)
RETURNS BOOLEAN AS $$
  SELECT COALESCE(role::text, '') IN (
    'admin',
    'owner',
    'regional_manager',
    'sales_manager',
    'regional_setter_manager',
    'setter_manager',
    'manager' -- legacy value in older environments
  )
  FROM users
  WHERE id = user_uuid;
$$ LANGUAGE sql SECURITY DEFINER;

-- Ask PostgREST to refresh schema cache immediately after migration.
SELECT pg_notify('pgrst', 'reload schema');
