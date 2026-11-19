-- Customer PO numbers and master invoices (builders: their PO on every invoice, one invoice for several finished houses).
--
-- ADDITIVE ONLY. Every column is nullable; nothing reads or writes any of it until the code ships. Code that predates this
-- keeps working, and the new code falls back cleanly while it is missing (a missing column / table reads as "none").
--
-- 1. production_jobs.customer_po   the customer's PO number for this job (editable on the job).
-- 2. job_invoices.customer_po      the PO printed on the invoice. Defaults from the job when the invoice is created (trigger
--                                  below, so every creator — final, deposit, custom amount, quote, hourly — gets it with no
--                                  code in each); editable on the draft. An invoice without a job (recurring service) has
--                                  no default and is typed on the invoice.
-- 3. invoice_batches               a MASTER INVOICE: a presentation + payment-split group over one customer's job invoices.
--    job_invoices.batch_id         It holds NO money. Every job keeps its own invoice, so paid-in-full (lib/job-collection.ts),
--                                  payroll eligibility, commission, job profit and QuickBooks (which still hears about each
--                                  job invoice, exactly as before) read per-job rows unchanged. A payment on the batch is split
--                                  over its job invoices by the existing payment writers; nothing is stored here but the
--                                  document's own header (number, when / to whom it was sent, an optional note).
--    Service role only (no policy), like visit_collections.
--
-- Deploy: apply before the code. Rollback: DROP TRIGGER trigger_job_invoices_batch_guard / trigger_job_invoices_customer_po
--   ON public.job_invoices; DROP FUNCTION the two functions; ALTER TABLE public.job_invoices DROP COLUMN batch_id,
--   DROP COLUMN customer_po; DROP TABLE public.invoice_batches; ALTER TABLE public.production_jobs DROP COLUMN customer_po.

BEGIN;

ALTER TABLE public.production_jobs
  ADD COLUMN IF NOT EXISTS customer_po text NULL CHECK (customer_po IS NULL OR char_length(customer_po) <= 60);

ALTER TABLE public.job_invoices
  ADD COLUMN IF NOT EXISTS customer_po text NULL CHECK (customer_po IS NULL OR char_length(customer_po) <= 60);

CREATE TABLE IF NOT EXISTS public.invoice_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id),
  batch_number text NOT NULL CHECK (char_length(batch_number) <= 30),
  public_note text NULL CHECK (public_note IS NULL OR char_length(public_note) <= 1000),
  sent_at timestamptz NULL,
  sent_to_email text NULL,
  created_by uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS invoice_batches_org_number_key ON public.invoice_batches (org_id, batch_number);
CREATE INDEX IF NOT EXISTS invoice_batches_customer_idx ON public.invoice_batches (org_id, customer_id);
ALTER TABLE public.invoice_batches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.invoice_batches FROM anon, authenticated;

ALTER TABLE public.job_invoices
  ADD COLUMN IF NOT EXISTS batch_id uuid NULL REFERENCES public.invoice_batches(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS job_invoices_batch_idx ON public.job_invoices (batch_id) WHERE batch_id IS NOT NULL;

-- The PO defaults from the job on insert (never overwrites one the caller gave).
CREATE OR REPLACE FUNCTION public.job_invoices_default_customer_po() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.customer_po IS NULL AND NEW.job_id IS NOT NULL THEN
    SELECT pj.customer_po INTO NEW.customer_po FROM public.production_jobs pj WHERE pj.id = NEW.job_id;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trigger_job_invoices_customer_po ON public.job_invoices;
CREATE TRIGGER trigger_job_invoices_customer_po
  BEFORE INSERT ON public.job_invoices
  FOR EACH ROW EXECUTE FUNCTION public.job_invoices_default_customer_po();

-- A master invoice holds one company's, one customer's JOB invoices only (the FKs alone do not check either).
CREATE OR REPLACE FUNCTION public.job_invoices_batch_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.batch_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.batch_id IS NOT DISTINCT FROM OLD.batch_id THEN
    RETURN NEW;
  END IF;
  IF NEW.job_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.invoice_batches b
    JOIN public.production_jobs pj ON pj.id = NEW.job_id
    WHERE b.id = NEW.batch_id AND b.org_id = pj.org_id AND b.customer_id = pj.customer_id
  ) THEN
    RAISE EXCEPTION 'a master invoice holds one customer''s job invoices in the same company' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trigger_job_invoices_batch_guard ON public.job_invoices;
CREATE TRIGGER trigger_job_invoices_batch_guard
  BEFORE INSERT OR UPDATE OF batch_id ON public.job_invoices
  FOR EACH ROW EXECUTE FUNCTION public.job_invoices_batch_guard();

COMMIT;
