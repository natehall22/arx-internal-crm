-- rpt_jobs.balance_due follows THE collection rule (lib/job-collection.ts): what is owed = sale amount + the sales tax its
-- issued invoices add (a time & materials job owes what its issued invoices total, tax included), minus payments in hand.
-- Before this the view owed sale_amount - collected, so an invoice tax or an hours-billed job disagreed with the job page.
-- Additive: only the balance_due expression changes (same columns, same order). security_invoker + REVOKE kept, as 202610220010.

CREATE OR REPLACE VIEW rpt_jobs WITH (security_invoker = true) AS
SELECT j.org_id,
       j.id                         AS job_id,
       j.job_number,
       j.status,
       j.job_type,
       j.address_text               AS address,
       j.job_source,
       j.sale_date,
       j.completed_at,
       j.cancelled_at,
       j.scheduled_date,
       j.materials_status,
       j.permit_status,
       j.salesperson_id,
       u.full_name                  AS salesperson,
       CASE WHEN j.status = 'cancelled' THEN 0 ELSE COALESCE(j.sale_amount, 0) END AS sale_amount, -- cancelled jobs are not sales
       COALESCE(j.dealer_fee_amount, 0) AS dealer_fee,
       -- cost = live ledger lines (dealer-fee mirror line excluded) + dealer fee (see docs/one-cost-ledger.md)
       COALESCE(c.cost, 0) + COALESCE(j.dealer_fee_amount, 0)                       AS cost_total,
       COALESCE(p.collected, 0)                                                     AS collected,
       CASE WHEN j.status = 'cancelled' THEN 0
            ELSE COALESCE(j.sale_amount, 0) - COALESCE(j.dealer_fee_amount, 0) - COALESCE(c.cost, 0) END AS profit_before_commission,
       -- money still owed on the sale, and how old the sale is (AR aging); cancelled jobs owe nothing
       CASE WHEN j.status = 'cancelled' THEN 0
            ELSE GREATEST(
                   (CASE WHEN j.billing_mode = 'time_materials'
                         THEN COALESCE(iv.issued_total, 0)::numeric / 100.0
                         ELSE COALESCE(j.sale_amount, 0)
                              + CASE WHEN COALESCE(j.sale_amount, 0) > 0 THEN COALESCE(iv.issued_tax, 0)::numeric / 100.0 ELSE 0 END
                    END) - COALESCE(p.collected, 0), 0) END AS balance_due,
       CASE WHEN j.sale_date IS NULL THEN NULL ELSE (CURRENT_DATE - j.sale_date::date) END AS days_since_sale,
       CASE WHEN j.sale_date IS NULL THEN 'no sale date'
            WHEN CURRENT_DATE - j.sale_date::date <= 30 THEN '0-30 days'
            WHEN CURRENT_DATE - j.sale_date::date <= 60 THEN '31-60 days'
            WHEN CURRENT_DATE - j.sale_date::date <= 90 THEN '61-90 days'
            ELSE 'over 90 days' END AS aging_bucket
FROM production_jobs j
LEFT JOIN users u ON u.id = j.salesperson_id
LEFT JOIN LATERAL (
  SELECT SUM(l.amount) AS cost
  FROM job_cost_lines l
  WHERE l.job_id = j.id AND l.status = 'active' AND l.deleted_at IS NULL
    AND l.description IS DISTINCT FROM 'Lender / dealer fee'
) c ON true
LEFT JOIN LATERAL (
  SELECT SUM(pm.amount_cents) / 100.0 AS collected
  FROM job_payments pm
  WHERE pm.job_id = j.id AND pm.funding_status IS DISTINCT FROM 'pending'
) p ON true
LEFT JOIN LATERAL (
  -- Same rule as lib/job-invoice-tax.ts: ISSUED invoices only (not draft, not void) -- their tax is owed on top of the sale
  -- amount; a time & materials job owes what its issued invoices total.
  SELECT SUM(i.total_cents) AS issued_total, SUM(COALESCE(i.tax_cents, 0)) AS issued_tax
  FROM job_invoices i
  WHERE i.job_id = j.id AND i.status NOT IN ('draft', 'void')
) iv ON true;

-- Views are read through the API only (service role); CREATE OR REPLACE keeps grants, restated for clarity.
REVOKE ALL ON rpt_jobs FROM anon, authenticated;
