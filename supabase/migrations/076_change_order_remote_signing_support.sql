-- Add remote-signing support fields for job change orders.
ALTER TABLE job_change_orders
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'completed',
  ADD COLUMN IF NOT EXISTS signing_token TEXT,
  ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS customer_email TEXT,
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS customer_signed_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_job_change_orders_signing_token
  ON job_change_orders(signing_token)
  WHERE signing_token IS NOT NULL;

SELECT pg_notify('pgrst', 'reload schema');
