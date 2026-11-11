-- Reports: service revenue. One row per ISSUED invoice without a job (recurring / one-off service billed to a customer,
-- job_invoices.job_id IS NULL, migration 202611110060). Job invoices stay out on purpose: a job's money is already
-- counted once through rpt_jobs (sale_amount / collected / balance_due) and rpt_payments, so adding job invoices here
-- would count the same dollars twice.
--
-- Issued = status sent / partially_paid / paid. Draft and void never count as revenue (a void frees its visits to be
-- billed again). Money is dollars (numeric), like every other rpt_* view; paid = payments applied (invoice_payments,
-- already NET of refunds) + paid_outside_cents (paid before an import, migration 202611120040) — the same rule as
-- lib/invoice-lines.ts invoicePaidCents — so balance_due here equals the balance on the invoice screen.
--
-- Additive: a new view only. security_invoker = true; the report runner reads with the service client and ALWAYS adds
-- the org filter (org_id is the first column) and the finance gate (lib/reporting/catalog.ts: financeOnly, money columns).
-- Needs: 202611110060 (customer_id / property_id on job_invoices) and 202611120040 (paid_outside_cents).
--
-- Rollback: drop view if exists public.rpt_invoices; drop function if exists arx_private.org_today(uuid);

-- "Today" in the company's own time zone (orgs.timezone; a missing / invalid zone falls back to the app default
-- America/New_York = DEFAULT_TIMEZONE in lib/timezone.ts). Uses the time zone database, so DST is handled; the same
-- day the app uses (ymdInZone) when it says an invoice is late.
create schema if not exists arx_private;
create or replace function arx_private.org_today(p_org uuid) returns date
language plpgsql stable as $f$
declare v_tz text;
begin
  begin
    select o.timezone into v_tz from public.orgs o where o.id = p_org;
    return (now() at time zone coalesce(nullif(btrim(v_tz), ''), 'America/New_York'))::date;
  exception when others then
    return (now() at time zone 'America/New_York')::date;
  end;
end;
$f$;
revoke all on function arx_private.org_today(uuid) from public, anon, authenticated;

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
            else 'over 90 days late' end              as aging_bucket
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

-- Views are read through the API only (service role), like every other rpt_* view (202610220010).
revoke all on public.rpt_invoices from anon, authenticated;

comment on view public.rpt_invoices is 'Issued invoices without a job (service revenue): totals, paid (net of refunds + paid before import), balance, aging. Job invoices are reported through rpt_jobs / rpt_payments.';
