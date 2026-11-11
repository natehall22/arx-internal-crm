-- Signing recovery backfill. Idempotent: run after migration 202611160030 AND again right after the code deploys (it catches
-- contracts the old code signed in between). Only rows the NEW code never touched (no finalize lease) are changed, so a
-- contract the new code is still finishing is left alone. Completed contracts are marked finished so nothing is re-sent.
-- Backfill: contracts already completed before this ships must NOT be re-finished (no duplicate emails/notices).
-- Those with a stored PDF are finalized; those still waiting on a PDF keep only the pdf (and its email) open.
UPDATE order_form_contracts
   SET signing_finalized_at = COALESCE(customer_signed_at, now())
 WHERE status = 'completed'
   AND signing_finalized_at IS NULL
   AND signing_finalize_lease_at IS NULL
   AND COALESCE(NULLIF(pdf_storage_path, ''), NULLIF(pdf_url, '')) IS NOT NULL;

UPDATE order_form_contracts
   SET signing_steps = jsonb_build_object(
         'sale_notice', now(), 'void_older', now(), 'project', now(), 'signed_note', now(), 'project_error_note', now())
 WHERE status = 'completed'
   AND signing_finalized_at IS NULL
   AND signing_finalize_lease_at IS NULL
   AND signing_steps IS NULL;
