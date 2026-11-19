-- Stop order for ONE crew's day. A visit's number on a given day lives on the visit row (work_orders.stop_order); the plan's
-- route_position stays the default for visits nobody has arranged. Nullable and additive: NULL = use the plan's number.
-- A visit moved to another day or crew goes back to NULL (done in visitPatch), so a number never follows a visit to a day it was
-- not arranged for.
alter table public.work_orders add column if not exists stop_order integer;
alter table public.work_orders drop constraint if exists work_orders_stop_order_range;
alter table public.work_orders add constraint work_orders_stop_order_range check (stop_order is null or (stop_order between 1 and 999)) not valid;

-- One statement for a whole day: p_ids in the order they should be visited get p_start, p_start+1, ... Only service visits of this
-- company are touched. Returns how many rows were written. Service role only.
create or replace function public.set_visit_stop_order(p_org_id uuid, p_ids uuid[], p_start integer)
returns integer
language sql
security definer
set search_path = public, pg_temp
as $$
  with n as (
    update public.work_orders w
       set stop_order = p_start + (t.ord - 1)::int
      from unnest(p_ids) with ordinality as t(id, ord)
     where w.id = t.id
       and w.org_id = p_org_id
       and w.work_order_type = 'service_visit'
       and w.stop_order is distinct from p_start + (t.ord - 1)::int
    returning 1
  )
  select count(*)::int from n;
$$;

revoke all on function public.set_visit_stop_order(uuid, uuid[], integer) from public, anon, authenticated;
grant execute on function public.set_visit_stop_order(uuid, uuid[], integer) to service_role;
