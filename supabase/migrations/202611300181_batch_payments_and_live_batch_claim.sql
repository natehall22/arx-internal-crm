-- Master invoices, round 2 (additive; apply after 202611300180, before the code).
--
-- 1. batch_payments: ONE payment taken on a master invoice. The split over the houses is decided ONCE and stored on the row
--    (`allocations`: [{ "invoice_id", "job_id", "cents", "payment_id" }]) before any money is written, exactly like
--    visit_collections: a retry applies each saved allocation (each has its own idempotency key) and never re-splits live
--    balances. `receipt_claimed_at` is the one-receipt claim (compare-and-set), so a double tap sends a single receipt.
--    The row is a record of how a payment was divided; the money itself is the per-house job payments, as always.
--    Service role only (no policy).
-- 2. A job can be in only ONE live master invoice: unique partial index. A second "Bill" call that races the first fails the
--    link (the code then rolls its own work back and answers 409) instead of double-billing a house.
--
-- Rollback: DROP INDEX job_invoices_one_live_batch_per_job; DROP TABLE batch_payments.

BEGIN;

CREATE TABLE IF NOT EXISTS public.batch_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  batch_id uuid NOT NULL REFERENCES public.invoice_batches(id) ON DELETE CASCADE,
  client_key text NOT NULL CHECK (char_length(client_key) <= 64),
  amount_cents integer NOT NULL CHECK (amount_cents > 0 AND amount_cents <= 1000000000),
  method text NOT NULL CHECK (char_length(method) <= 30),
  paid_on date NOT NULL,
  note text NULL CHECK (note IS NULL OR char_length(note) <= 500),
  allocations jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(allocations) = 'array' AND jsonb_array_length(allocations) <= 100),
  receipt_claimed_at timestamptz NULL,
  created_by uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS batch_payments_key ON public.batch_payments (batch_id, client_key);
CREATE INDEX IF NOT EXISTS batch_payments_org_idx ON public.batch_payments (org_id, batch_id);
ALTER TABLE public.batch_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.batch_payments FROM anon, authenticated;

CREATE UNIQUE INDEX IF NOT EXISTS job_invoices_one_live_batch_per_job
  ON public.job_invoices (job_id)
  WHERE batch_id IS NOT NULL AND status <> 'void';

COMMIT;
