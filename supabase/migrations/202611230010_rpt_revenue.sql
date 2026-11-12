-- Reports: gross revenue, billed and collected, for every kind of work. One row per revenue EVENT (a billing or a payment), dollars.
-- Reads: production_jobs, job_invoices, job_invoice_items, job_payments (+ service_plans / service_plan_templates / work_orders /
-- org_trades / customers for labels). Needs 202611110060 (invoices without a job), 202611110030 (service plans), 202611060030
-- (org_trades) and 202611120030 (production_jobs.billing_mode).
--
-- THE NO-DOUBLE-COUNT RULE (one dollar is counted once as BILLED and once as COLLECTED, never twice in either):
--
--   BILLED
--     Jobs (job_id on the invoice / the job's own contract):
--       * a job is billed ONCE, by its contract: sale_amount at sale_date. Cancelled jobs bill nothing (same as rpt_jobs.sale_amount).
--         A job with NO contract price (sale_amount null or 0) has no contract to bill, so it is billed by its issued invoices, like time & materials.
--       * the job's own invoices (deposit / final / standard) bill the SAME contract dollars, so they add nothing ...
--       * ... except the sales tax an issued invoice adds on top of the contract (rpt_jobs.balance_due: sale_amount + issued tax),
--         booked on the invoice date as its own 'Sales tax' row;
--       * a TIME & MATERIALS job (billing_mode = 'time_materials') or a job with no contract price bills what its issued invoices total
--         (rpt_jobs.balance_due: issued invoice total), booked per invoice on the invoice date: the amount before tax, and the tax as its own 'Sales tax' row.
--         ONE rule, written in rpt_jobs.balance_due (replaced below, same columns) AND here; lib/__tests__/revenue-report.test.ts fails if they drift.
--     Service (invoices with NO job, job_invoices.job_id IS NULL, customer_id set): each issued invoice is billed once, line by line
--       (job_invoice_items.line_total_cents) plus its sales tax as its own row, on the invoice date. These dollars never also appear
--       on a job, because a no-job invoice has no job to carry a contract.
--     Issued = status NOT draft / void (the rpt_jobs / rpt_invoices rule). A draft is not billed yet; a void invoice drops out whole.
--   COLLECTED
--     ONE ledger: job_payments (each payment is ONE row whether or not it is applied to an invoice — invoice_payments only LINKS a payment
--     to an invoice and is never read here, so a paid invoice cannot be counted again as a payment). Job payment (job_id set) = Jobs;
--     payment on a no-job invoice (job_id NULL) = Service. Pending (ACH / check not cleared) is not collected (rpt_jobs.collected rule).
--     A refund is a NEGATIVE job_payments row, so it takes dollars back out in the month the refund happened.
--     NOT collected here: invoices.paid_outside_cents (paid before a Jobber import): no date, method or amount per payment exists, and none is made up.
--
-- Additive: a new view; rpt_jobs is replaced with the SAME columns in the same order (only balance_due's no-price rule changes);
-- rpt_invoices / rpt_payments are untouched. security_invoker = true; read through the API only (the
-- report runner uses the service client and ALWAYS adds the org filter and the reports:financials gate — lib/reporting/catalog.ts, financeOnly).
--
-- Rollback: drop view if exists public.rpt_revenue; drop function if exists arx_private.org_date(uuid, timestamptz); re-apply 202611220010 (rpt_jobs).


-- A timestamp's calendar day in the company's own time zone (orgs.timezone; a missing / invalid zone falls back to the app default
-- America/New_York = DEFAULT_TIMEZONE in lib/timezone.ts). Same pattern as arx_private.org_today (202611140010), for dates NOT typed by a person
-- (created_at fallbacks). Never a UTC slice: an evening entry must stay on its own day.
create schema if not exists arx_private;
create or replace function arx_private.org_date(p_org uuid, p_ts timestamptz) returns date
language plpgsql stable as $f$
declare v_tz text;
begin
  if p_ts is null then return null; end if;
  begin
    select o.timezone into v_tz from public.orgs o where o.id = p_org;
    return (p_ts at time zone coalesce(nullif(btrim(v_tz), ''), 'America/New_York'))::date;
  exception when others then
    return (p_ts at time zone 'America/New_York')::date;
  end;
end;
$f$;
revoke all on function arx_private.org_date(uuid, timestamptz) from public, anon, authenticated;
grant usage on schema arx_private to service_role;
grant execute on function arx_private.org_date(uuid, timestamptz) to service_role;

create or replace view public.rpt_revenue with (security_invoker = true) as
with ev as (
  -- Jobs: the contract, billed once on the sale date (cancelled / time & materials / no price: nothing).
  select j.org_id,
         'job:' || j.id::text                                    as revenue_id,
         coalesce(j.sale_date, arx_private.org_date(j.org_id, j.created_at)) as event_date,
         'Jobs'::text                                            as work_type,
         'Billed'::text                                          as entry,
         coalesce(tr.label, case when j.job_type = 'mixed' then 'Mixed' else j.job_type end, 'Job') as service,
         coalesce(tr.label, case when j.job_type = 'mixed' then 'Mixed' else j.job_type end)        as trade,
         j.job_number                                            as reference,
         cu.name                                                 as customer,
         j.sale_amount::numeric                                  as amount
  from public.production_jobs j
  left join public.org_trades tr on tr.org_id = j.org_id and tr.slug = j.job_type
  left join public.customers cu on cu.id = j.customer_id and cu.org_id = j.org_id
  where j.status <> 'cancelled'
    and j.billing_mode is distinct from 'time_materials'
    and coalesce(j.sale_amount, 0) > 0

  union all
  -- Jobs: the sales tax an issued invoice adds on top of a contract (the invoice's dollars are the contract's, only the tax is new).
  select j.org_id,
         'jobtax:' || i.id::text,
         coalesce(i.issued_at, arx_private.org_date(i.org_id, i.created_at)),
         'Jobs', 'Billed', 'Sales tax',
         coalesce(tr.label, case when j.job_type = 'mixed' then 'Mixed' else j.job_type end),
         i.invoice_number, cu.name,
         i.tax_cents / 100.0
  from public.job_invoices i
  join public.production_jobs j on j.id = i.job_id
  left join public.org_trades tr on tr.org_id = j.org_id and tr.slug = j.job_type
  left join public.customers cu on cu.id = j.customer_id and cu.org_id = j.org_id
  where i.status not in ('draft', 'void')
    and j.status <> 'cancelled'
    and j.billing_mode is distinct from 'time_materials'
    and coalesce(j.sale_amount, 0) > 0
    and coalesce(i.tax_cents, 0) > 0

  union all
  -- Jobs billed by their invoices (time & materials, or no contract price): the invoice amount before tax ...
  select j.org_id,
         'tm:' || i.id::text,
         coalesce(i.issued_at, arx_private.org_date(j.org_id, i.created_at)),
         'Jobs', 'Billed',
         case when j.billing_mode = 'time_materials' then 'Hourly (time & materials)' else 'Invoiced (no contract price)' end,
         coalesce(tr.label, case when j.job_type = 'mixed' then 'Mixed' else j.job_type end),
         i.invoice_number, cu.name,
         (i.total_cents - coalesce(i.tax_cents, 0)) / 100.0
  from public.job_invoices i
  join public.production_jobs j on j.id = i.job_id
  left join public.org_trades tr on tr.org_id = j.org_id and tr.slug = j.job_type
  left join public.customers cu on cu.id = j.customer_id and cu.org_id = j.org_id
  where i.status not in ('draft', 'void')
    and j.status <> 'cancelled'
    and (j.billing_mode = 'time_materials' or coalesce(j.sale_amount, 0) = 0)
    and i.total_cents - coalesce(i.tax_cents, 0) <> 0

  union all
  -- ... and its tax as its own row, like every other tax here.
  select j.org_id,
         'tmtax:' || i.id::text,
         coalesce(i.issued_at, arx_private.org_date(j.org_id, i.created_at)),
         'Jobs', 'Billed', 'Sales tax',
         coalesce(tr.label, case when j.job_type = 'mixed' then 'Mixed' else j.job_type end),
         i.invoice_number, cu.name,
         i.tax_cents / 100.0
  from public.job_invoices i
  join public.production_jobs j on j.id = i.job_id
  left join public.org_trades tr on tr.org_id = j.org_id and tr.slug = j.job_type
  left join public.customers cu on cu.id = j.customer_id and cu.org_id = j.org_id
  where i.status not in ('draft', 'void')
    and j.status <> 'cancelled'
    and (j.billing_mode = 'time_materials' or coalesce(j.sale_amount, 0) = 0)
    and coalesce(i.tax_cents, 0) <> 0

  union all
  -- Service: one row per invoice line (a $0 line — a monthly plan's listed visit — is skipped).
  select i.org_id,
         'line:' || it.id::text,
         coalesce(i.issued_at, arx_private.org_date(i.org_id, i.created_at)),
         'Service', 'Billed',
         coalesce(nullif(btrim(tpl.name), ''), nullif(btrim(sp.name), ''),
                  case when it.unit = 'hour' then 'Hourly (time & materials)' else 'One-off / other' end),
         tr.label,
         i.invoice_number, cu.name,
         it.line_total_cents / 100.0
  from public.job_invoices i
  join public.job_invoice_items it on it.invoice_id = i.id
  left join public.service_plans sp on sp.id = it.service_plan_id and sp.org_id = i.org_id
  left join public.service_plan_templates tpl on tpl.id = sp.template_id and tpl.org_id = i.org_id
  left join public.work_orders w on w.id = it.work_order_id and w.org_id = i.org_id
  left join public.org_trades tr on tr.org_id = i.org_id and tr.slug = coalesce(sp.trade, w.trade)
  left join public.customers cu on cu.id = i.customer_id and cu.org_id = i.org_id
  where i.job_id is null and i.customer_id is not null
    and i.status not in ('draft', 'void')
    and coalesce(it.line_total_cents, 0) <> 0

  union all
  -- Service: whatever the invoice's subtotal holds that its lines do not (an imported invoice with no lines, a rounded total),
  -- so billed always ties to the invoice's own total (rpt_invoices.total).
  select i.org_id,
         'rest:' || i.id::text,
         coalesce(i.issued_at, arx_private.org_date(i.org_id, i.created_at)),
         'Service', 'Billed', 'One-off / other', null::text,
         i.invoice_number, cu.name,
         (i.subtotal_cents - coalesce(l.line_cents, 0)) / 100.0
  from public.job_invoices i
  left join lateral (select sum(it.line_total_cents) as line_cents from public.job_invoice_items it where it.invoice_id = i.id) l on true
  left join public.customers cu on cu.id = i.customer_id and cu.org_id = i.org_id
  where i.job_id is null and i.customer_id is not null
    and i.status not in ('draft', 'void')
    and i.subtotal_cents - coalesce(l.line_cents, 0) <> 0

  union all
  -- Service: the invoice's sales tax, its own row.
  select i.org_id,
         'tax:' || i.id::text,
         coalesce(i.issued_at, arx_private.org_date(i.org_id, i.created_at)),
         'Service', 'Billed', 'Sales tax', null::text,
         i.invoice_number, cu.name,
         i.tax_cents / 100.0
  from public.job_invoices i
  left join public.customers cu on cu.id = i.customer_id and cu.org_id = i.org_id
  where i.job_id is null and i.customer_id is not null
    and i.status not in ('draft', 'void')
    and coalesce(i.tax_cents, 0) <> 0

  union all
  -- Collected: the one payment ledger. Negative rows are refunds.
  select coalesce(pm.org_id, j.org_id),
         'pay:' || pm.id::text,
         pm.paid_at,
         case when pm.job_id is null then 'Service' else 'Jobs' end,
         'Collected', 'Payment received', null::text,
         j.job_number, cu.name,
         pm.amount_cents / 100.0
  from public.job_payments pm
  left join public.production_jobs j on j.id = pm.job_id
  left join public.customers cu on cu.id = coalesce(pm.customer_id, j.customer_id) and cu.org_id = coalesce(pm.org_id, j.org_id)
  where pm.funding_status is distinct from 'pending'
)
select org_id,
       revenue_id,
       event_date,
       work_type,
       entry,
       service,
       trade,
       reference,
       customer,
       case when entry = 'Billed' then amount else 0 end                                  as billed,
       case when entry = 'Collected' then amount else 0 end                               as collected,
       case when entry = 'Billed' and work_type = 'Jobs' then amount else 0 end           as billed_jobs,
       case when entry = 'Billed' and work_type = 'Service' then amount else 0 end        as billed_service,
       case when entry = 'Collected' and work_type = 'Jobs' then amount else 0 end        as collected_jobs,
       case when entry = 'Collected' and work_type = 'Service' then amount else 0 end     as collected_service
from ev
where org_id is not null;

-- Views are read through the API only (service role), like every other rpt_* view (202610220010).
revoke all on public.rpt_revenue from anon, authenticated;

comment on view public.rpt_revenue is 'Gross revenue events (dollars): billed (job contracts + issued service invoice lines + sales tax) and collected (the job_payments ledger, refunds negative). A job''s own invoices add only their sales tax (time & materials jobs bill their invoices instead). No dollar is billed twice.';


-- rpt_jobs.balance_due, one change: a job with NO contract price (sale_amount null / 0, not cancelled) is owed what its issued invoices
-- total, the same as a time & materials job (before: it owed 0 however much it had invoiced). Same columns, same order; every other
-- expression is 202611220010 exactly. security_invoker + REVOKE kept. rpt_revenue bills such a job by its invoices (same rule).
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
                   (CASE WHEN j.billing_mode = 'time_materials' OR COALESCE(j.sale_amount, 0) = 0
                         THEN COALESCE(iv.issued_total, 0)::numeric / 100.0
                         ELSE COALESCE(j.sale_amount, 0)
                              + COALESCE(iv.issued_tax, 0)::numeric / 100.0
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
