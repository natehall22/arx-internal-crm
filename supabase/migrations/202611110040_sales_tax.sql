-- Sales tax (lib/sales-tax.ts is the one calculation). Additive + nullable only; safe to apply before or after the code.
-- Rates live in orgs.settings.salesTax (no table). Documents keep a SNAPSHOT of the tax they charged, so a later rate
-- change never rewrites a sent proposal or invoice.
--
-- NULL everywhere = the original behaviour:
--   proposals.tax_lines NULL        -> legacy single tax_rate on the whole after-discount amount
--   proposal_line_items.taxable NULL -> taxed whenever the proposal is taxed (legacy) / price-book flag (set-up company)
--   job_invoice_items.taxable NULL  -> not taxed (contract / deposit / balance lines are already tax-included)
--   job_invoices.tax_cents NULL     -> no tax; total_cents = subtotal_cents as before
--   customers.tax_exempt NULL       -> not exempt
set lock_timeout = '5s';

alter table public.customers
  add column if not exists tax_exempt boolean,
  add column if not exists tax_exempt_reason text,
  add column if not exists tax_exempt_certificate_number text,
  -- the certificate itself is a customer-level document (documents row); deleting that document clears the link.
  add column if not exists tax_exempt_document_id uuid references public.documents(id) on delete set null;

alter table public.proposals
  add column if not exists tax_lines jsonb,
  add column if not exists taxable_subtotal numeric(12,2),
  add column if not exists tax_exempt boolean;

alter table public.proposal_line_items
  add column if not exists taxable boolean;

alter table public.job_invoices
  add column if not exists tax_lines jsonb,
  add column if not exists taxable_subtotal_cents integer,
  add column if not exists tax_cents integer;

alter table public.job_invoice_items
  add column if not exists taxable boolean;

comment on column public.proposals.tax_lines is
  'Sales tax snapshot [{id,name,percent,amount_cents}] (lib/sales-tax.ts). NULL = legacy single tax_rate. tax_amount = sum; tax_rate = sum of percents.';
comment on column public.job_invoices.tax_lines is
  'Sales tax snapshot [{id,name,percent,amount_cents}] (lib/sales-tax.ts), recomputed while draft. total_cents = subtotal_cents + tax_cents.';
comment on column public.customers.tax_exempt is 'Sales-tax exempt customer: new proposals and invoices charge no tax (lib/sales-tax.ts).';
