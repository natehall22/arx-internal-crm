-- Contact data for setters / canvassers: names, phones, emails and addresses of leads, customers, deals and appointments are
-- readable with their own token ONLY for their own work. Canvass pins on the map (address, location, disposition, who knocked) are
-- served by the canvass API, which keeps showing every pin; the same API now blanks name / phone / email / notes on pins that are
-- not theirs (lib/contact-scope.ts, which asks the same SQL rule below).
--
-- "Their own work" (one definition, arx_private.lead_mine):
--   a lead they own, dropped, are the closer on, knocked (canvass_knocks), or set an appointment / deal on;
--   an appointment they set, closer, or booked;  a deal they are owner / setter / assigned on, or on a lead of theirs;
--   a customer tied to one of those deals or leads.
-- RESTRICTIVE select policies only for setter / canvasser roles (inside sales work the whole queue and are not touched).
-- Writes untouched. Rollback at the bottom.
begin;

create or replace function arx_private.lead_mine(p_user uuid, p_lead uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_lead is not null and (
       exists (select 1 from public.leads l where l.id = p_lead and (l.owner_user_id = p_user or l.pin_attributed_user_id = p_user or l.closer_user_id = p_user))
    or exists (select 1 from public.canvass_knocks k where k.lead_id = p_lead and k.user_id = p_user)
    or exists (select 1 from public.scheduled_appointments a where a.lead_id = p_lead and (a.canvasser_user_id = p_user or a.closer_user_id = p_user or a.inside_sales_booked_by_user_id = p_user))
    or exists (select 1 from public.opportunities o where o.lead_id = p_lead and (o.setter_user_id = p_user or o.owner_user_id = p_user or o.assigned_user_id = p_user))
  );
$$;

create or replace function public.is_setter_canvasser_self()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select arx_private.is_field_role(lower(btrim(u.role::text)), lower(coalesce(cr.name, '') || ' ' || coalesce(cr.display_name, '')))
            and not (lower(btrim(u.role::text)) in ('inside_sales', 'inside sales', 'call_center', 'call center')
                     or lower(coalesce(cr.name, '') || ' ' || coalesce(cr.display_name, '')) ~ '(inside[ _-]?sales|call[ _-]?cent(er|re))')
            and not coalesce(u.is_super_admin, false)
       from public.users u left join public.custom_roles cr on cr.id = u.custom_role_id
      where u.id = auth.uid()),
    false);
$$;

create or replace function public.lead_is_mine_self(p_lead uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select arx_private.lead_mine(auth.uid(), p_lead); $$;

-- Server side (service role): which of these leads are the user's own? The canvass API uses it to blank other people's contact fields.
create or replace function public.my_lead_ids(p_user uuid, p_ids uuid[])
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select i from unnest(p_ids) as i where arx_private.lead_mine(p_user, i); $$;

revoke all on function public.is_setter_canvasser_self() from public, anon;
revoke all on function public.lead_is_mine_self(uuid) from public, anon;
revoke all on function public.my_lead_ids(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.is_setter_canvasser_self() to authenticated, service_role;
grant execute on function public.lead_is_mine_self(uuid) to authenticated, service_role;
grant execute on function public.my_lead_ids(uuid, uuid[]) to service_role;
revoke all on function arx_private.lead_mine(uuid, uuid) from public, anon, authenticated;

drop policy if exists setter_own_work on public.leads;
create policy setter_own_work on public.leads as restrictive for select to authenticated
  using (not public.is_setter_canvasser_self() or owner_user_id = auth.uid() or pin_attributed_user_id = auth.uid() or closer_user_id = auth.uid() or public.lead_is_mine_self(id));

drop policy if exists setter_own_work on public.scheduled_appointments;
create policy setter_own_work on public.scheduled_appointments as restrictive for select to authenticated
  using (not public.is_setter_canvasser_self() or canvasser_user_id = auth.uid() or closer_user_id = auth.uid() or inside_sales_booked_by_user_id = auth.uid() or public.lead_is_mine_self(lead_id));

drop policy if exists setter_own_work on public.opportunities;
create policy setter_own_work on public.opportunities as restrictive for select to authenticated
  using (not public.is_setter_canvasser_self() or setter_user_id = auth.uid() or owner_user_id = auth.uid() or assigned_user_id = auth.uid() or public.lead_is_mine_self(lead_id));

-- A customer is theirs when one of THEIR deals or leads points at it (the inner reads run under the same restrictive policies).
drop policy if exists setter_own_work on public.customers;
create policy setter_own_work on public.customers as restrictive for select to authenticated
  using (not public.is_setter_canvasser_self()
         or exists (select 1 from public.opportunities o where o.customer_id = customers.id)
         or exists (select 1 from public.leads l where l.customer_id = customers.id));

commit;

-- ROLLBACK:
-- drop policy if exists setter_own_work on public.leads; drop policy if exists setter_own_work on public.scheduled_appointments;
-- drop policy if exists setter_own_work on public.opportunities; drop policy if exists setter_own_work on public.customers;
