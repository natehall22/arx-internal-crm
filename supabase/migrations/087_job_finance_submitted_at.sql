-- Track when a finance job's payment was submitted (persists across page reloads)
ALTER TABLE production_jobs ADD COLUMN IF NOT EXISTS finance_submitted_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN production_jobs.finance_submitted_at IS
  'Set when the rep clicks "Submit for Finance Payment". Persists the banner state across page reloads.';
