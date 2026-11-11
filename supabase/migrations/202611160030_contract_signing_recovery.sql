-- ONE recovery path for a signed contract (PR0 review, 2026-11-11).
-- The signature is claimed atomically (status -> completed); everything after it (sale notice, voiding the
-- superseded contract, PDF, project/job, activity, customer email) is recorded step by step in signing_steps so a
-- retry on the same link finishes only what is missing. signing_finalized_at is set when every step is done.
-- Additive and nullable. APPLY BEFORE THE CODE (and after 202611160020): the sign route writes these columns.

ALTER TABLE order_form_contracts
  ADD COLUMN IF NOT EXISTS signing_steps jsonb,
  ADD COLUMN IF NOT EXISTS signing_finalized_at timestamptz,
  ADD COLUMN IF NOT EXISTS signing_finalize_lease_at timestamptz;

-- Backfill: contracts already completed before this ships must NOT be re-finished (no duplicate emails/notices).
-- Those with a stored PDF are finalized; those still waiting on a PDF keep only the pdf (and its email) open.
UPDATE order_form_contracts
   SET signing_finalized_at = COALESCE(customer_signed_at, now())
 WHERE status = 'completed'
   AND signing_finalized_at IS NULL
   AND COALESCE(NULLIF(pdf_storage_path, ''), NULLIF(pdf_url, '')) IS NOT NULL;

UPDATE order_form_contracts
   SET signing_steps = jsonb_build_object(
         'sale_notice', now(), 'void_older', now(), 'project', now(), 'signed_note', now(), 'project_error_note', now())
 WHERE status = 'completed'
   AND signing_finalized_at IS NULL
   AND signing_steps IS NULL;
