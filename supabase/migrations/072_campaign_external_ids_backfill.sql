-- Ensure campaign external ID fields exist in older environments.
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS external_id TEXT,
  ADD COLUMN IF NOT EXISTS facebook_campaign_id TEXT,
  ADD COLUMN IF NOT EXISTS google_ads_campaign_id TEXT;

-- Ask PostgREST to refresh schema cache immediately after migration.
SELECT pg_notify('pgrst', 'reload schema');
