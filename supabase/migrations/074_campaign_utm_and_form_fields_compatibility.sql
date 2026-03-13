-- Compatibility backfill for environments with partial campaigns schema.
-- Adds fields used by /admin/campaigns form + API inserts.
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS source_type TEXT,
  ADD COLUMN IF NOT EXISTS channel TEXT,
  ADD COLUMN IF NOT EXISTS budget NUMERIC,
  ADD COLUMN IF NOT EXISTS utm_source TEXT,
  ADD COLUMN IF NOT EXISTS utm_medium TEXT,
  ADD COLUMN IF NOT EXISTS utm_campaign TEXT,
  ADD COLUMN IF NOT EXISTS utm_term TEXT,
  ADD COLUMN IF NOT EXISTS utm_content TEXT,
  ADD COLUMN IF NOT EXISTS external_id TEXT,
  ADD COLUMN IF NOT EXISTS facebook_campaign_id TEXT,
  ADD COLUMN IF NOT EXISTS google_campaign_id TEXT,
  ADD COLUMN IF NOT EXISTS google_ads_campaign_id TEXT,
  ADD COLUMN IF NOT EXISTS start_date DATE,
  ADD COLUMN IF NOT EXISTS end_date DATE,
  ADD COLUMN IF NOT EXISTS created_by UUID,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

-- Ask PostgREST to refresh schema cache immediately after migration.
SELECT pg_notify('pgrst', 'reload schema');
