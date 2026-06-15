-- Rep GPS location at time of door knock (separate from pin lat/lng which is the property address)
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS rep_lat             DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS rep_lng             DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS rep_geo_accuracy    REAL,
  ADD COLUMN IF NOT EXISTS rep_geo_captured_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_leads_rep_lat_lng ON leads(rep_lat, rep_lng)
  WHERE rep_lat IS NOT NULL;

COMMENT ON COLUMN leads.rep_lat             IS 'Rep physical latitude at moment of door disposition — for accountability/fraud detection';
COMMENT ON COLUMN leads.rep_lng             IS 'Rep physical longitude at moment of door disposition';
COMMENT ON COLUMN leads.rep_geo_accuracy    IS 'GPS accuracy in metres at time of capture (from browser Geolocation API)';
COMMENT ON COLUMN leads.rep_geo_captured_at IS 'UTC timestamp when rep GPS was snapshotted';
