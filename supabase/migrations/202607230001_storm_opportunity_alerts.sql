-- Storm-near-opportunity alerts for Inside Sales (cron-driven, deduped per org/opp/day/layer).

CREATE TABLE IF NOT EXISTS storm_opportunity_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  opportunity_id UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  event_date DATE NOT NULL,
  layer TEXT NOT NULL CHECK (layer IN ('hail', 'wind')),
  magnitude NUMERIC NULL,
  damage BOOLEAN NOT NULL DEFAULT false,
  storm_lat NUMERIC(10, 8) NULL,
  storm_lng NUMERIC(11, 8) NULL,
  distance_miles NUMERIC(8, 4) NULL,
  routed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, opportunity_id, event_date, layer)
);

CREATE INDEX IF NOT EXISTS idx_storm_opportunity_alerts_org_created
  ON storm_opportunity_alerts (org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_storm_opportunity_alerts_opportunity
  ON storm_opportunity_alerts (opportunity_id, event_date DESC);

ALTER TABLE storm_opportunity_alerts ENABLE ROW LEVEL SECURITY;

-- Optional org-scoped read for authenticated CRM users.
DROP POLICY IF EXISTS storm_opportunity_alerts_org_select ON storm_opportunity_alerts;
CREATE POLICY storm_opportunity_alerts_org_select ON storm_opportunity_alerts
  FOR SELECT TO authenticated
  USING (org_id = get_user_org_id(auth.uid()));

COMMENT ON TABLE storm_opportunity_alerts IS
  'Deduped storm-near-opportunity matches for Inside Sales cron alerts. Writes are service-role only.';
