-- One rule for "is this lead in the pipeline". Canvass pins that only carry a disposition (not home, not interested,
-- renter ...) stay in the canvass app and the door reports; they are not pipeline.
--
--   A lead is in the pipeline when ANY of:
--     1. it has a name AND a phone or an email;
--     2. it has an appointment booked (an inspection time, a non-cancelled appointment, or a deal/opportunity);
--     3. it was entered as an inbound lead (web, Yelp, referral, call-in, ads, or channel = inbound).
--
-- Used as a PostgREST computed column (`lead_in_pipeline`) by the Leads list and the dashboard counts, and directly by rpt_leads.
-- Purely additive: no row is changed or deleted. Rollback at the bottom.

begin;

create or replace function public.lead_in_pipeline(l public.leads)
returns boolean
language sql
stable
as $$
  select coalesce(
       (nullif(btrim(coalesce(l.homeowner_name, '')), '') is not null
          and (nullif(btrim(coalesce(l.phone, '')), '') is not null or nullif(btrim(coalesce(l.email, '')), '') is not null))
    or l.inspection_scheduled_at is not null
    or l.inspection_scheduled_for is not null
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

-- Reports: the same rule (this also keeps the Solar import pins out, as before, because they carry no contact).
create or replace view rpt_leads with (security_invoker = true) as
select l.org_id,
       l.id          as lead_id,
       l.created_at,
       l.status,
       l.source,
       l.canvass_disposition,
       l.owner_user_id,
       u.full_name   as owner
from leads l
left join users u on u.id = l.owner_user_id
where public.lead_in_pipeline(l);

commit;

-- ROLLBACK:
-- create or replace view rpt_leads with (security_invoker = true) as
--   select l.org_id, l.id as lead_id, l.created_at, l.status, l.source, l.canvass_disposition, l.owner_user_id, u.full_name as owner
--   from leads l left join users u on u.id = l.owner_user_id where l.source is distinct from 'solar_import';
-- drop function if exists public.lead_in_pipeline(public.leads);
