-- Work categories (Residential / Commercial / New build / whatever the owner adds; Settings -> Job setup -> Categories).
-- The category lives ON THE CUSTOMER (customers.category); a job may override it (production_jobs.category, e.g. a residential
-- customer's one-off new build). Slugs are stable and never deleted (a category is turned off); the list itself is
-- orgs.settings.categories.items (written only by lib/categories-db.ts through mergeOrgSettings).
--
-- Additive only:
--   * customers.category / production_jobs.category: nullable text, slug format checked. NO backfill: blank = not set (it is not
--     "Residential" and not zero), and reports show it as an empty category.
--   * arx_private.org_category_label(org, slug): the company's label for a slug (its saved list), else the three standard names,
--     else the slug title-cased. Reports show LABELS so a rename shows up everywhere at once.
--   * rpt_jobs / rpt_invoices / rpt_revenue are replaced with EVERY existing column in the same order and ONE new column,
--     `category`, appended last (effective category: job override, else customer; service invoices follow the customer).
--     Every other expression is copied unchanged from 202611230010 (rpt_jobs, rpt_revenue) and 202611140010 (rpt_invoices).
--     rpt_payments is not touched (payments are reported through rpt_revenue, which carries the category).
--   security_invoker + REVOKE kept; read through the API only (service role; the report runner always adds the org filter).
--   Not sensitive: field roles see the category.
--
-- Needs: 202611140010 (rpt_invoices, arx_private.org_today), 202611230010 (rpt_revenue, arx_private.org_date), 202611220010/230010 (rpt_jobs as replaced there).
--
-- Rollback: re-apply 202611230010 (rpt_jobs, rpt_revenue) and 202611140010 (rpt_invoices); drop function if exists
--           arx_private.org_category_label(uuid, text); the two columns can stay (nullable, unread).

alter table public.customers add column if not exists category text;
alter table public.production_jobs add column if not exists category text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'customers_category_slug_chk') then
    alter table public.customers add constraint customers_category_slug_chk check (category is null or category ~ '^[a-z][a-z0-9_]{0,39}$') not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'production_jobs_category_slug_chk') then
    alter table public.production_jobs add constraint production_jobs_category_slug_chk check (category is null or category ~ '^[a-z][a-z0-9_]{0,39}$') not valid;
  end if;
end $$;

comment on column public.customers.category is 'Work category slug (company list in orgs.settings.categories.items; default residential / commercial / new_build). NULL = not set.';
comment on column public.production_jobs.category is 'Optional override of the customer''s work category for this one job. NULL = same as the customer.';

create schema if not exists arx_private;
create or replace function arx_private.org_category_label(p_org uuid, p_slug text) returns text
language sql stable as $f$
  select case when nullif(btrim(p_slug), '') is null then null else coalesce(
    (select e->>'label'
       from public.orgs o,
            jsonb_array_elements(case when jsonb_typeof(o.settings->'categories'->'items') = 'array' then o.settings->'categories'->'items' else '[]'::jsonb end) e
      where o.id = p_org and e->>'slug' = p_slug and nullif(btrim(e->>'label'), '') is not null
      limit 1),
    case p_slug when 'residential' then 'Residential' when 'commercial' then 'Commercial' when 'new_build' then 'New build'
      else upper(left(replace(p_slug, '_', ' '), 1)) || substr(replace(p_slug, '_', ' '), 2) end) end
$f$;
revoke all on function arx_private.org_category_label(uuid, text) from public, anon, authenticated;
grant usage on schema arx_private to service_role;
grant execute on function arx_private.org_category_label(uuid, text) to service_role;

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
            ELSE 'over 90 days' END AS aging_bucket,
       -- Work category (appended last: new columns only ever go at the end). The job's own override, else its customer's;
       -- blank = not set. Shown as the company's label (renames follow), see arx_private.org_category_label.
       arx_private.org_category_label(j.org_id, COALESCE(NULLIF(j.category, ''), NULLIF(cu.category, ''))) AS category
FROM production_jobs j
LEFT JOIN users u ON u.id = j.salesperson_id
LEFT JOIN customers cu ON cu.id = j.customer_id AND cu.org_id = j.org_id
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


create or replace view public.rpt_invoices with (security_invoker = true) as
select i.org_id,
       i.id                                         as invoice_id,
       i.invoice_number,
       i.customer_id,
       cu.name                                      as customer,
       i.property_id,
       pr.address_text                              as property,
       i.status,
       coalesce(i.issued_at, i.created_at::date)    as invoice_date,
       i.due_at,
       i.subtotal_cents / 100.0                     as subtotal,
       coalesce(i.tax_cents, 0) / 100.0             as tax,
       i.total_cents / 100.0                        as total,
       (coalesce(a.applied_cents, 0) + coalesce(i.paid_outside_cents, 0)) / 100.0 as paid,
       greatest(i.total_cents - coalesce(a.applied_cents, 0) - coalesce(i.paid_outside_cents, 0), 0) / 100.0 as balance_due,
       case when i.total_cents - coalesce(a.applied_cents, 0) - coalesce(i.paid_outside_cents, 0) > 0
                 and i.due_at is not null and i.due_at < t.today then (t.today - i.due_at) else null end as days_overdue,
       case when i.total_cents - coalesce(a.applied_cents, 0) - coalesce(i.paid_outside_cents, 0) <= 0 then 'paid'
            when i.due_at is null or i.due_at >= t.today then 'not due yet'
            when t.today - i.due_at <= 30 then '1-30 days late'
            when t.today - i.due_at <= 60 then '31-60 days late'
            when t.today - i.due_at <= 90 then '61-90 days late'
            else 'over 90 days late' end              as aging_bucket,
       -- Service invoices follow the customer's work category (appended last).
       arx_private.org_category_label(i.org_id, nullif(cu.category, '')) as category
from public.job_invoices i
left join public.customers cu on cu.id = i.customer_id and cu.org_id = i.org_id
left join public.properties pr on pr.id = i.property_id and pr.org_id = i.org_id
left join lateral (select arx_private.org_today(i.org_id) as today) t on true
left join lateral (
  select sum(ip.applied_cents) as applied_cents from public.invoice_payments ip where ip.invoice_id = i.id
) a on true
where i.job_id is null
  and i.customer_id is not null
  and i.status in ('sent', 'partially_paid', 'paid');


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
         j.sale_amount::numeric                                  as amount,
         coalesce(nullif(j.category, ''), nullif(cu.category, ''))   as category
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
         i.tax_cents / 100.0,
         coalesce(nullif(j.category, ''), nullif(cu.category, ''))
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
         (i.total_cents - coalesce(i.tax_cents, 0)) / 100.0,
         coalesce(nullif(j.category, ''), nullif(cu.category, ''))
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
         i.tax_cents / 100.0,
         coalesce(nullif(j.category, ''), nullif(cu.category, ''))
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
         it.line_total_cents / 100.0,
         nullif(cu.category, '')
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
         (i.subtotal_cents - coalesce(l.line_cents, 0)) / 100.0,
         nullif(cu.category, '')
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
         i.tax_cents / 100.0,
         nullif(cu.category, '')
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
         pm.amount_cents / 100.0,
         coalesce(nullif(j.category, ''), nullif(cu.category, ''))
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
       case when entry = 'Collected' and work_type = 'Service' then amount else 0 end     as collected_service,
       arx_private.org_category_label(org_id, category)                                  as category
from ev
where org_id is not null;


-- Views are read through the API only (service role), like every other rpt_* view (202610220010).
revoke all on public.rpt_invoices from anon, authenticated;
revoke all on public.rpt_revenue from anon, authenticated;
revoke all on public.rpt_jobs from anon, authenticated;
