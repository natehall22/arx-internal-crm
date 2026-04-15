-- Canvass work areas: geographic polygons assigned to reps (trial / MVP)
-- Migration: 110_canvass_territories.sql

-- Extend canvass pin visibility with territory-scoped map (see API for geo filter)
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_canvass_pin_visibility_check;
ALTER TABLE users ADD CONSTRAINT users_canvass_pin_visibility_check
  CHECK (canvass_pin_visibility IN ('own', 'team', 'region', 'org', 'territory'));

COMMENT ON COLUMN users.canvass_pin_visibility IS
  'Canvass map: own | team | region | org | territory (assigned polygons only; see canvass_territory_users)';

CREATE TABLE IF NOT EXISTS canvass_territories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6366F1',
  -- GeoJSON Polygon or MultiPolygon (RFC 7946), validated in application
  boundary_geojson JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_canvass_territories_org_id ON canvass_territories(org_id);

CREATE TABLE IF NOT EXISTS canvass_territory_users (
  territory_id UUID NOT NULL REFERENCES canvass_territories(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (territory_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_canvass_territory_users_user_id ON canvass_territory_users(user_id);

ALTER TABLE canvass_territories ENABLE ROW LEVEL SECURITY;
ALTER TABLE canvass_territory_users ENABLE ROW LEVEL SECURITY;

-- Service role and server routes bypass RLS; policies allow authenticated org access if using client later
CREATE POLICY "canvass_territories_select_org"
  ON canvass_territories FOR SELECT
  USING (
    org_id IN (SELECT org_id FROM users WHERE id = auth.uid())
  );

CREATE POLICY "canvass_territory_users_select_org"
  ON canvass_territory_users FOR SELECT
  USING (
    territory_id IN (
      SELECT id FROM canvass_territories WHERE org_id IN (
        SELECT org_id FROM users WHERE id = auth.uid()
      )
    )
  );

-- Territory visibility: treat like org-wide user list for SQL helpers; geographic filter is applied in app
CREATE OR REPLACE FUNCTION get_canvass_visible_user_ids(user_uuid UUID)
RETURNS SETOF UUID AS $$
DECLARE
  user_record RECORD;
BEGIN
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

  IF user_record.role IN ('owner', 'admin', 'regional_manager', 'sales_manager', 'operations') THEN
    RETURN QUERY
    SELECT id FROM users WHERE org_id = user_record.org_id;
    RETURN;
  END IF;

  CASE user_record.canvass_pin_visibility
    WHEN 'own' THEN
      RETURN NEXT user_uuid;

    WHEN 'team' THEN
      IF user_record.team_id IS NOT NULL THEN
        RETURN QUERY
        SELECT id FROM users
        WHERE org_id = user_record.org_id AND team_id = user_record.team_id;
      ELSE
        RETURN NEXT user_uuid;
      END IF;

    WHEN 'region' THEN
      IF user_record.region_id IS NOT NULL THEN
        RETURN QUERY
        SELECT id FROM users
        WHERE org_id = user_record.org_id AND region_id = user_record.region_id;
      ELSIF user_record.team_id IS NOT NULL THEN
        RETURN QUERY
        SELECT u.id FROM users u
        JOIN teams t ON u.team_id = t.id
        WHERE u.org_id = user_record.org_id
          AND t.region_id = (SELECT region_id FROM teams WHERE id = user_record.team_id);
      ELSE
        RETURN NEXT user_uuid;
      END IF;

    WHEN 'org' THEN
      RETURN QUERY
      SELECT id FROM users WHERE org_id = user_record.org_id;

    WHEN 'territory' THEN
      RETURN QUERY
      SELECT id FROM users WHERE org_id = user_record.org_id;

    ELSE
      RETURN NEXT user_uuid;
  END CASE;

  RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION get_canvass_visible_user_ids IS
  'User IDs whose canvass pins may be visible; territory mode still requires lat/lng in assigned polygons (enforced in API).';

SELECT pg_notify('pgrst', 'reload schema');
