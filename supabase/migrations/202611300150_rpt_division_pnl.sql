-- Reports: profit and loss by division and cost code. A division is the company's trade (org_trades: Lawn care, Soft wash, ...).
-- One row per (day, division, line) with the money that belongs to it: revenue on a "Revenue" line, cost on one line per cost code.
-- Reads: rpt_revenue (the ONE revenue definition, 202611230010), job_cost_lines + production_jobs (the cost ledger), org_trades,
-- org_cost_codes. Needs 202611230010, 202611060030 (org_trades) and 202611120080 (job_cost_lines.cost_code, org_cost_codes).
--
-- HOW MONEY TIES TO A DIVISION
--   Revenue = BILLED (issued, never draft / void), straight from rpt_revenue so this report and the Revenue report can never disagree:
--     * a job's contract is billed once, on the sale date, to the job's trade (production_jobs.job_type = org_trades.slug);
--     * hourly / no-price jobs and service invoices are billed by their issued invoices on the invoice's issue date (a calendar
--       day, no time zone slice); a service invoice line goes to its plan's / visit's trade (service_plans.trade, work_orders.trade);
--     * SALES TAX is left out: it is collected for the tax office, not earned (it stays on the Revenue report as its own line).
--   Cost = live job_cost_lines (status 'active', not deleted), the same lines lib/job-cost-ledger.ts reads, dated on the line's own
--     day, division = the job's trade, line = the line's cost code. A line with no code counts under the code its cost_type maps to
--     (lib/cost-codes.ts codeForLine; a test keeps the two in step). The mirrored 'Lender / dealer fee' line is NOT a ledger cost;
--     the job's dealer_fee_amount is added once, as its own 'Lender fee' line (same as rpt_jobs.cost_total), on the sale date.
--     Day-clock labor already lands in the ledger as lines, so time_entries is never read here (no double count).
--   Anything that cannot be tied to a division (a job of more than one trade, a job type that is not one of the company's trades,
--   a service invoice line with no plan or visit trade) is the division 'No division'. Nothing is dropped.
--   Cancelled jobs bill nothing (rpt_revenue) but keep the cost already spent on them.
--
-- Additive: one new view. security_invoker = true; read through the report runner only (service client, org filter and the
-- reports:financials gate are always added). profit = revenue - cost on each row, so any grouping adds up.
--
-- Rollback: drop view if exists public.rpt_division_pnl; and remove the 'division_pnl' catalog entry.

create or replace view public.rpt_division_pnl with (security_invoker = true) as
with rev as (
  select r.org_id,
         r.event_date::date as entry_date,
         case when exists (select 1 from public.org_trades t where t.org_id = r.org_id and t.label = r.trade)
              then r.trade else 'No division' end as division,
         r.billed as amount
  from public.rpt_revenue r
  where r.entry = 'Billed'
    and r.service is distinct from 'Sales tax'
    and r.billed <> 0
),
cost as (
  select l.org_id,
         coalesce(l.incurred_on, arx_private.org_date(l.org_id, l.created_at))::date as entry_date,
         coalesce(tr.label, 'No division') as division,
         coalesce(nullif(btrim(l.cost_code), ''),
                  case l.cost_type when 'material' then 'materials' when 'labor' then 'labor' when 'subcontractor' then 'sub'
                                   when 'permit' then 'permit' else 'other' end) as code,
         l.amount
  from public.job_cost_lines l
  join public.production_jobs j on j.id = l.job_id and j.org_id = l.org_id
  left join public.org_trades tr on tr.org_id = j.org_id and tr.slug = j.job_type
  where l.status = 'active' and l.deleted_at is null
    and btrim(coalesce(l.description, '')) <> 'Lender / dealer fee'

  union all
  select j.org_id,
         coalesce(j.sale_date, arx_private.org_date(j.org_id, j.created_at))::date,
         coalesce(tr.label, 'No division'),
         'lender_fee',
         j.dealer_fee_amount
  from public.production_jobs j
  left join public.org_trades tr on tr.org_id = j.org_id and tr.slug = j.job_type
  where j.status <> 'cancelled' and coalesce(j.dealer_fee_amount, 0) <> 0
),
lines as (
  select org_id, entry_date, division, 'Revenue'::text as line, sum(amount) as revenue, 0::numeric as cost
  from rev
  group by org_id, entry_date, division

  union all
  select c.org_id, c.entry_date, c.division,
         coalesce(oc.label,
                  case c.code when 'materials' then 'Materials' when 'labor' then 'Labor' when 'sub' then 'Sub' when 'permit' then 'Permit'
                              when 'dump' then 'Dump' when 'equipment' then 'Equipment' when 'other' then 'Other' when 'lender_fee' then 'Lender fee'
                              else initcap(replace(c.code, '_', ' ')) end),
         0::numeric, sum(c.amount)
  from cost c
  left join public.org_cost_codes oc on oc.org_id = c.org_id and oc.code = c.code
  group by c.org_id, c.entry_date, c.division, c.code, oc.label
)
select org_id,
       entry_date::text || '|' || division || '|' || line as pnl_id,
       entry_date,
       division,
       line,
       division || ' · ' || line as division_line,
       revenue,
       cost,
       revenue - cost as profit
from lines
where org_id is not null;

-- Read through the API only (service role), like every other rpt_* view (202610220010).
revoke all on public.rpt_division_pnl from anon, authenticated;

comment on view public.rpt_division_pnl is 'Profit and loss rows by day, division (org_trades label, else No division) and line (Revenue, or a cost code). Revenue = billed (issued, no tax) from rpt_revenue; cost = live job_cost_lines + the job''s lender fee. profit = revenue - cost.';
