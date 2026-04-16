-- Assign canvass work areas to whole teams (all setters on that team inherit polygon access)
-- Complements canvass_territory_users (individual reps).

CREATE TABLE IF NOT EXISTS canvass_territory_teams (
  territory_id UUID NOT NULL REFERENCES canvass_territories(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (territory_id, team_id)
);

CREATE INDEX IF NOT EXISTS idx_canvass_territory_teams_team_id ON canvass_territory_teams(team_id);

ALTER TABLE canvass_territory_teams ENABLE ROW LEVEL SECURITY;

CREATE POLICY "canvass_territory_teams_select_org"
  ON canvass_territory_teams FOR SELECT
  USING (
    territory_id IN (
      SELECT id FROM canvass_territories WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())
    )
  );

COMMENT ON TABLE canvass_territory_teams IS
  'Team-level assignment to canvass territories; members get same polygon union as canvass_territory_users.';

SELECT pg_notify('pgrst', 'reload schema');
