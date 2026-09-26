-- In-house roof measurement from free USGS 3DEP lidar.
--
-- USGS publishes each county as ~110 MB LAZ tiles on a slow server, so an ingest
-- worker extracts each tile's building points once into a compact file in the
-- private `lidar-buildings` bucket (lib/lidar/tile-store.ts), and this table tracks
-- which tiles are ready. Service-role only: it is infrastructure, not user data.
--
-- Additive: one new table, one new private bucket.

CREATE TABLE IF NOT EXISTS public.lidar_tiles (
  id TEXT PRIMARY KEY,                      -- '<dataset>/<tile file stem>'
  dataset TEXT NOT NULL,                    -- USGS workunit, e.g. NC_Phase4_Cabarrus_2016
  tile_name TEXT NOT NULL,
  source_url TEXT NOT NULL,                 -- the USGS LAZ it came from
  min_lng DOUBLE PRECISION NOT NULL,
  min_lat DOUBLE PRECISION NOT NULL,
  max_lng DOUBLE PRECISION NOT NULL,
  max_lat DOUBLE PRECISION NOT NULL,
  collected_end DATE NULL,                  -- houses built after this are not in the data
  priority INTEGER NOT NULL DEFAULT 0,      -- higher = ingest sooner (tiles with our jobs/leads)
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'ready', 'failed')),
  storage_path TEXT NULL,
  total_points BIGINT NULL,
  building_points INTEGER NULL,
  stored_bytes INTEGER NULL,
  error TEXT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  processed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lidar_tiles_bbox_idx ON public.lidar_tiles (min_lat, max_lat, min_lng, max_lng);
CREATE INDEX IF NOT EXISTS lidar_tiles_queue_idx ON public.lidar_tiles (status, priority DESC);

ALTER TABLE public.lidar_tiles ENABLE ROW LEVEL SECURITY;
-- No policies: only the service role (worker + server routes) reads or writes.

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('lidar-buildings', 'lidar-buildings', false, 52428800)
ON CONFLICT (id) DO NOTHING;
