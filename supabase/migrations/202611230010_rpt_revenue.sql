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
--       * the job's own invoices (deposit / final / standard) bill the SAME contract dollars, so they add nothing ...
--       * ... except the sales tax an issued invoice adds on top of the contract (rpt_jobs.balance_due: sale_amount + issued tax),
--         booked on the invoice date as its own 'Sales tax' row;
--       * a TIME & MATERIALS job (billing_mode = 'time_materials') has no contract to bill: what it bills is what its issued
--         invoices total (rpt_jobs.balance_due: issued invoice total), booked per invoice on the invoice date.
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
-- Additive: a new view only; rpt_jobs / rpt_invoices / rpt_payments are untouched. security_invoker = true; read through the API only (the
-- report runner uses the service client and ALWAYS adds the org filter and the reports:financials gate — lib/reporting/catalog.ts, financeOnly).
--
-- Rollback: drop view if exists public.rpt_revenue;

create or replace view public.rpt_revenue with (security_invoker = true) as
with ev as (
  -- Jobs: the contract, billed once on the sale date (cancelled / time & materials / no price: nothing).
  select j.org_id,
         'job:' || j.id::text                                    as revenue_id,
         coalesce(j.sale_date, j.created_at::date)               as event_date,
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
         coalesce(i.issued_at, i.created_at::date),
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
  -- Jobs: a time & materials job bills what its issued invoices total (no contract to bill).
  select j.org_id,
         'tm:' || i.id::text,
         coalesce(i.issued_at, i.created_at::date),
         'Jobs', 'Billed', 'Hourly (time & materials)',
         coalesce(tr.label, case when j.job_type = 'mixed' then 'Mixed' else j.job_type end),
         i.invoice_number, cu.name,
         i.total_cents / 100.0
  from public.job_invoices i
  join public.production_jobs j on j.id = i.job_id
  left join public.org_trades tr on tr.org_id = j.org_id and tr.slug = j.job_type
  left join public.customers cu on cu.id = j.customer_id and cu.org_id = j.org_id
  where i.status not in ('draft', 'void')
    and j.status <> 'cancelled'
    and j.billing_mode = 'time_materials'
    and coalesce(i.total_cents, 0) <> 0

  union all
  -- Service: one row per invoice line (a $0 line — a monthly plan's listed visit — is skipped).
  select i.org_id,
         'line:' || it.id::text,
         coalesce(i.issued_at, i.created_at::date),
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
         coalesce(i.issued_at, i.created_at::date),
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
         coalesce(i.issued_at, i.created_at::date),
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
  left join public.customers cu on cu.id = coalesce(pm.customer_id, j.customer_id)
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
