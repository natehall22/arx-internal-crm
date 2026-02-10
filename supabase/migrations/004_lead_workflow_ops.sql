-- Lead workflow + ops fields
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS inspection_scheduled_at TIMESTAMPTZ;

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS contract_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS contract_uploaded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS scope_of_work TEXT,
  ADD COLUMN IF NOT EXISTS permits_status TEXT,
  ADD COLUMN IF NOT EXISTS product_summary TEXT,
  ADD COLUMN IF NOT EXISTS install_date DATE,
  ADD COLUMN IF NOT EXISTS ops_notes TEXT;

CREATE INDEX IF NOT EXISTS idx_jobs_owner_user_id ON jobs(owner_user_id);
