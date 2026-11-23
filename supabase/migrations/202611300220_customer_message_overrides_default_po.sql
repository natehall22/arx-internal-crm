-- Per-customer message timing + a default customer PO for invoices without a job.
--
-- ADDITIVE ONLY. Both columns are nullable; nothing reads them until the code ships, and the code treats a missing
-- column as "none" (company timing; no default PO). Apply before or after the code.
--
-- 1. customers.message_overrides  jsonb { off?: [kind], skipDays?: { quote_follow_up?: [n], invoice_reminder?: [n] } }.
--    Kinds turned off for this customer, and the steps (day numbers) they DROP (not the ones they keep, so a company
--    changing its own steps never silently drops a customer's follow-ups). Written only by
--    lib/customer-messages-db.ts setCustomerOverrides (cleaned); read by the ONE sender's builders.
-- 2. customers.default_po         the PO printed on this customer's invoices that have no job (Ready to bill, one-off).
--    Copied onto job_invoices.customer_po (existing column, migration 202611300180) when the invoice is made. Job
--    invoices keep defaulting from production_jobs.customer_po (trigger, unchanged).
--
-- Rollback: ALTER TABLE public.customers DROP COLUMN message_overrides, DROP COLUMN default_po;

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS message_overrides jsonb NULL;
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS default_po text NULL CHECK (default_po IS NULL OR char_length(default_po) <= 60);

COMMIT;
