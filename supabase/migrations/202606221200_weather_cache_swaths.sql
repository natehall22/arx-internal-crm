-- Phase 2: durable weather cache + MRMS swath storage for canvass overlay.
-- Additive only. Public NOAA/IEM/MRMS-derived geo data — not org-specific CRM rows.

CREATE TABLE IF NOT EXISTS weather_cache (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NULL REFERENCES orgs(id) ON DELETE SET NULL,
  layer TEXT NOT NULL CHECK (layer IN ('hail', 'wind')),
  kind TEXT NOT NULL CHECK (kind IN ('report', 'warning')),
  event_date DATE NULL,
  magnitude NUMERIC NULL,
  damage BOOLEAN NULL DEFAULT false,
  geometry JSONB NOT NULL,
  footprint_bbox JSONB NULL,
  source TEXT NOT NULL,
  properties JSONB NULL DEFAULT '{}'::jsonb,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_weather_cache_layer_date
  ON weather_cache (layer, event_date DESC);

CREATE INDEX IF NOT EXISTS idx_weather_cache_source_refreshed
  ON weather_cache (source, refreshed_at DESC);

CREATE TABLE IF NOT EXISTS weather_swaths (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NULL REFERENCES orgs(id) ON DELETE SET NULL,
  event_date DATE NOT NULL,
  layer TEXT NOT NULL CHECK (layer IN ('hail', 'wind')),
  magnitude NUMERIC NOT NULL,
  geometry JSONB NOT NULL,
  source TEXT NOT NULL DEFAULT 'mrms_mesh',
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_weather_swaths_day_source
  ON weather_swaths (event_date, layer, source);

CREATE INDEX IF NOT EXISTS idx_weather_swaths_layer_date
  ON weather_swaths (layer, event_date DESC);

CREATE TABLE IF NOT EXISTS weather_refresh_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ NULL,
  status TEXT NOT NULL CHECK (status IN ('ok', 'partial', 'failed')),
  summary JSONB NULL DEFAULT '{}'::jsonb,
  error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_weather_refresh_runs_started
  ON weather_refresh_runs (started_at DESC);

ALTER TABLE weather_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE weather_swaths ENABLE ROW LEVEL SECURITY;
ALTER TABLE weather_refresh_runs ENABLE ROW LEVEL SECURITY;

-- Authenticated reps may read public weather geometry; writes are service-role only.
CREATE POLICY weather_cache_authenticated_select ON weather_cache
  FOR SELECT TO authenticated USING (true);

CREATE POLICY weather_swaths_authenticated_select ON weather_swaths
  FOR SELECT TO authenticated USING (true);

CREATE POLICY weather_refresh_runs_authenticated_select ON weather_refresh_runs
  FOR SELECT TO authenticated USING (true);
