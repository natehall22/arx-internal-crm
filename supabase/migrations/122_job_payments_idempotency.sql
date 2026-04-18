-- Duplicate payment guard (Tier 1): optional idempotency key per job payment.

ALTER TABLE job_payments
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

COMMENT ON COLUMN job_payments.idempotency_key IS 'When set, unique per job_id; prevents accidental double-post from retries (see lib/weekly-payroll/explicit-rules.ts).';

CREATE UNIQUE INDEX IF NOT EXISTS idx_job_payments_job_idempotency
  ON job_payments (job_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
