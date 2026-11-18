-- Reports: service visits and clocked time, as two more datasets for the one report runner (lib/reporting/catalog.ts).
--   rpt_visits: one row per service-plan visit (work_orders.work_order_type = 'service_visit', not cancelled), on the day it sits on:
--               done / skipped / billed per crew, plan and day.
--   rpt_time:   one row per finished work stretch on the time clock (time_entries.kind = 'work', not removed, ended): hours per
--               person, crew, job and day. A clock still running is not a row yet (same rule as loadWorkSecondsByStop).
-- Additive: two new views, nothing existing is replaced. security_invoker = true; the report runner reads them with the service client
-- and ALWAYS adds the org filter. rpt_time is company-level data (no owner column) and is marked finance-free: hours are not pay.
-- Needs 202611110030 (service plans) and 202611110070 (time clock); the org day comes from arx_private.org_date (202611230010).
--
-- Rollback: remove the two views (see the Rollback line of 202611230010 for the style) and the two catalog entries.

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
  ) as is_billed
from public.work_orders w
left join public.sub_contractors sc on sc.id = w.assigned_sub_id
left join public.service_plans p on p.id = w.service_plan_id
left join public.customers c on c.id = w.customer_id
where w.work_order_type = 'service_visit' and w.status <> 'cancelled';

create or replace view public.rpt_time with (security_invoker = true) as
select
  t.id as entry_id,
  t.org_id,
  arx_private.org_date(t.org_id, t.started_at) as work_date,
  coalesce(u.full_name, 'Unnamed') as person,
  coalesce(sc.company_name, 'No crew') as crew,
  j.job_number,
  w.work_order_number as visit_number,
  round((extract(epoch from (t.ended_at - t.started_at)) / 3600.0)::numeric, 2) as hours
from public.time_entries t
left join public.users u on u.id = t.user_id
left join public.sub_contractors sc on sc.id = t.sub_id
left join public.production_jobs j on j.id = t.production_job_id
left join public.work_orders w on w.id = t.work_order_id
where t.kind = 'work' and t.removed_at is null and t.ended_at is not null;

revoke all on public.rpt_visits, public.rpt_time from anon, authenticated;
