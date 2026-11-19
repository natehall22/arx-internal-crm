-- Reports: add "Times rolled" to the service-visits dataset (rpt_visits). The only change is one new LAST column (rolls) on the
-- view from 202611300070, so CREATE OR REPLACE is allowed and every existing column is unchanged.
-- Needs 202611300170 (work_order_moves). `rolls` counts only kind = 'roll' moves (the "Not ready" button). Apply 170 first, then this, then deploy the code that offers the column.
-- Rollback: re-run the view from 202611300070.

create or replace view public.rpt_visits with (security_invoker = true) as
select
  w.id as visit_id,
  w.org_id,
  w.scheduled_date as visit_date,
  w.status,
  (w.status = 'completed') as is_done,
  (w.status = 'skipped') as is_skipped,
  w.skip_reason,
  w.trade,
  coalesce(sc.company_name, 'No crew assigned') as crew,
  p.name as plan,
  c.name as customer,
  exists (
    select 1
    from public.job_invoice_items it
    join public.job_invoices i on i.id = it.invoice_id
    where it.work_order_id = w.id and i.status not in ('draft', 'void')
  ) as is_billed,
  (select count(*) from public.work_order_moves m where m.work_order_id = w.id and m.kind = 'roll')::integer as rolls
from public.work_orders w
left join public.sub_contractors sc on sc.id = w.assigned_sub_id
left join public.service_plans p on p.id = w.service_plan_id
left join public.customers c on c.id = w.customer_id
where w.work_order_type = 'service_visit' and w.status <> 'cancelled';

revoke all on public.rpt_visits from anon, authenticated;
