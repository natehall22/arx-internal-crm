-- lead_in_pipeline: count the same for every viewer (the appointment / deal lookups must not depend on the caller's row access),
-- and a lead that reached an appointment-or-later status counts as booked even if its appointment row is missing.
begin;

create or replace function public.lead_in_pipeline(l public.leads)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
       (nullif(btrim(coalesce(l.homeowner_name, '')), '') is not null
          and (nullif(btrim(coalesce(l.phone, '')), '') is not null or nullif(btrim(coalesce(l.email, '')), '') is not null))
    or l.inspection_scheduled_at is not null
    or l.inspection_scheduled_for is not null
    or l.status::text in ('appointment', 'inspection', 'estimate_sent', 'won', 'lost')
    or exists (select 1 from public.scheduled_appointments a where a.lead_id = l.id and coalesce(a.status::text, '') <> 'cancelled')
    or exists (select 1 from public.opportunities o where o.lead_id = l.id)
    or l.channel::text = 'inbound'
    or lower(coalesce(l.source, '')) in ('web', 'yelp', 'referral', 'call_in', 'facebook-ad', 'ad_campaign')
    or lower(coalesce(l.source, '')) like 'website%'
    or l.source_type::text in ('website', 'google_ads', 'facebook', 'instagram', 'tiktok', 'youtube', 'bing_ads', 'referral', 'phone_call', 'partner', 'home_show', 'walk_in'),
    false);
$$;

revoke all on function public.lead_in_pipeline(public.leads) from public, anon;
grant execute on function public.lead_in_pipeline(public.leads) to authenticated, service_role;

commit;
-- ROLLBACK: re-run the function body from 202610290030_pipeline_lead_rule.sql.
