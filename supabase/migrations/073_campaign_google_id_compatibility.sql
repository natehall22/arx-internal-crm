-- Compatibility backfill for environments missing older/newer campaign ID columns.
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS external_id TEXT,
  ADD COLUMN IF NOT EXISTS facebook_campaign_id TEXT,
  ADD COLUMN IF NOT EXISTS google_campaign_id TEXT,
  ADD COLUMN IF NOT EXISTS google_ads_campaign_id TEXT;

-- Ask PostgREST to refresh schema cache immediately after migration.
SELECT pg_notify('pgrst', 'reload schema');
