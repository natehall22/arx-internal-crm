-- Payment terms: a customer's own terms (override of the company default in orgs.settings.paymentTerms).
-- Additive and nullable: NULL = use the company default. Nothing reads or writes it until the code ships.
alter table public.customers add column if not exists payment_terms text
  check (payment_terms is null or payment_terms in ('due_on_receipt', 'net_15', 'net_30'));
