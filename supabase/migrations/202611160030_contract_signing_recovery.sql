-- ONE recovery path for a signed contract (PR0 review, 2026-11-11).
-- The signature is claimed atomically (status -> completed); everything after it (sale notice, voiding the
-- superseded contract, PDF, project/job, activity, customer email) is recorded step by step in signing_steps so a
-- retry on the same link finishes only what is missing. signing_finalized_at is set when every step is done.
-- Additive and nullable. APPLY BEFORE THE CODE (and after 202611160020): the sign route writes these columns.

ALTER TABLE order_form_contracts
  ADD COLUMN IF NOT EXISTS signing_steps jsonb,
  ADD COLUMN IF NOT EXISTS signing_finalized_at timestamptz,
  ADD COLUMN IF NOT EXISTS signing_finalize_lease_at timestamptz;

-- Backfill of contracts completed by the OLD code: supabase/data-fixes/2026-11-11_signing_recovery_backfill.sql. Run it right
-- after this migration AND again right after the code deploys (it is safe to run twice).
