-- Some environments created inspection_status_updates via RUN_THIS_MISSING_TABLES
-- without completed_at / updated_at. App code and admin feedback rely on these columns.

ALTER TABLE inspection_status_updates
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

UPDATE inspection_status_updates
SET completed_at = COALESCE(completed_at, created_at, NOW())
WHERE completed_at IS NULL;

UPDATE inspection_status_updates
SET updated_at = COALESCE(updated_at, created_at, NOW())
WHERE updated_at IS NULL;

ALTER TABLE inspection_status_updates
  ALTER COLUMN completed_at SET DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_inspection_status_completed
  ON inspection_status_updates(completed_at DESC);

-- Refresh PostgREST schema cache after column add
NOTIFY pgrst, 'reload schema';
