-- Storm opportunity alerts: swath-based matching support.
--
-- Also re-applies 202607230002 (processed_at / email_sent_at). That migration was
-- authored but never landed in prod, so the cron's `.select('id, routed,
-- processed_at, email_sent_at')` would have errored on its first insert. IF NOT
-- EXISTS keeps this idempotent for any environment where it did apply.

ALTER TABLE storm_opportunity_alerts
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS email_sent_at TIMESTAMPTZ NULL,
  -- 'report' = IEM point report within STORM_ALERT_RADIUS_MILES.
  -- 'swath'  = inside (or within STORM_SWATH_BUFFER_MILES of) an MRMS polygon.
  -- Nullable: rows written before this column existed have no known source.
  ADD COLUMN IF NOT EXISTS match_source TEXT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'storm_opportunity_alerts_match_source_check'
  ) THEN
    ALTER TABLE storm_opportunity_alerts
      ADD CONSTRAINT storm_opportunity_alerts_match_source_check
      CHECK (match_source IS NULL OR match_source IN ('report', 'swath'));
  END IF;
END $$;

-- The cron reads recent swaths by event_date on every run (3x daily).
CREATE INDEX IF NOT EXISTS weather_swaths_event_date_layer_idx
  ON weather_swaths (event_date DESC, layer);
