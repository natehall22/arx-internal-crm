-- Customer portal (switch `customerPortal`): a customer signs in with a one-time emailed link and sees ONLY their own
-- records at their company's own address. NOT applied by the builder. Apply AFTER 202611100040 (job_invoices.org_id) and
-- 202611120020 (online payments) and 202610280010 (message_visible_to); the portal reads nothing that those do not already have.
--
-- Everything here is service-role only (RLS on, no policies): the browser never reads these tables. Tokens are random
-- 256-bit values and only their SHA-256 is stored, so a database read never yields a working link or session.
--
-- Down (manual): drop table portal_login_events, portal_sessions, portal_login_tokens, portal_rate_limits;
--   drop functions portal_find_customers, portal_consume_login_token, portal_take_attempt;
--   alter table documents drop column shared_with_customer; re-create the activities audience / origin checks and
--   arx_private.message_visible_to from 202610270010 / 202610280010 (no rows of audience 'customer' may exist then).

begin;
set local lock_timeout = '5s';

-- ---- 1. One-time sign-in links ---------------------------------------------------------------------------------------
create table if not exists public.portal_login_tokens (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  token_hash text not null unique,
  sent_to text null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz null
);
create index if not exists portal_login_tokens_customer on public.portal_login_tokens (org_id, customer_id, created_at desc);

-- ---- 2. Sessions (one customer of one company each) -----------------------------------------------------------------
create table if not exists public.portal_sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  token_hash text not null unique,
  -- Opaque key of the customer's email when the session began: a session stops working the moment the email on file changes.
  email_key text null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz null,
  revoked_at timestamptz null
);
create index if not exists portal_sessions_customer on public.portal_sessions (org_id, customer_id);

-- ---- 3. Audit log of portal sign-ins (append-only; never holds a token) ----------------------------------------------
create table if not exists public.portal_login_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  customer_id uuid null references public.customers(id) on delete set null,
  kind text not null check (kind in ('link_requested', 'link_sent', 'link_no_match', 'link_blocked', 'login', 'login_failed', 'logout', 'staff_signout')),
  via text null,
  ip_hash text null,
  detail text null check (detail is null or char_length(detail) <= 200),
  created_at timestamptz not null default now()
);
create index if not exists portal_login_events_org_time on public.portal_login_events (org_id, created_at desc);
create index if not exists portal_login_events_customer on public.portal_login_events (org_id, customer_id, created_at desc);

-- ---- 4. Rate limits shared by every server instance -----------------------------------------------------------------
create table if not exists public.portal_rate_limits (
  key text primary key,
  window_start timestamptz not null default now(),
  attempts integer not null default 0
);

-- ---- 5. Messages ---------------------------------------------------------------------------------------------------
-- No table of their own: a customer's message is an ordinary `activities` row (origin 'customer_portal', audience 'team'),
-- and a company's reply is audience 'customer'. The portal reads only those two kinds for ONE customer
-- (lib/threads/portal-thread.ts); staff read them like any team message. Widen the two checks that list the allowed values.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.activities'::regclass and contype = 'c'
       and (pg_get_constraintdef(oid) ilike '%audience = any%' or pg_get_constraintdef(oid) ilike '%origin = any%')
  loop
    execute format('alter table public.activities drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.activities add constraint activities_audience_check check (audience is null or audience in ('team', 'sales', 'production', 'crew', 'customer'));
alter table public.activities add constraint activities_origin_check check (origin is null or origin in ('human', 'system', 'customer_portal'));

-- Same rule as 202610280010, plus the new audience: 'customer' reads like 'team' (own deals for setters/closers, everyone
-- else in the company). Any audience this function does not know reads as false (fails closed), as before for unknown roles.
create or replace function arx_private.message_visible_to(
  p_viewer uuid, p_audience text, p_restricted boolean, p_org uuid, p_opportunity uuid
) returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  with v as (
    select u.id, u.org_id, lower(trim(u.role::text)) as role, u.custom_role_id, coalesce(u.is_super_admin, false) as sa, u.active,
           lower(coalesce(cr.name, '') || ' ' || coalesce(cr.display_name, '')) as crname
    from users u left join custom_roles cr on cr.id = u.custom_role_id
    where u.id = p_viewer
  ),
  d as (select o.owner_user_id, o.setter_user_id from opportunities o where o.id = p_opportunity),
  f as (
    select
      v.org_id = p_org and coalesce(v.active, true) as in_org,
      (v.sa or v.role in ('owner','admin')) as owner_like,
      arx_private.can_view_job_board(v.id) as job_board,
      v.role in ('manager','sales_manager','regional_manager','operations') as manager_like,
      (v.role in ('setter','canvasser')) as base_setter,
      (v.role in ('rep','sales_rep','closer')) as closer_role,
      (v.role in ('rep','sales_rep','closer') and (exists (select 1 from d where d.owner_user_id = v.id)
        or exists (select 1 from scheduled_appointments sa where sa.opportunity_id = p_opportunity and sa.closer_user_id = v.id))) as own_closer,
      (v.role in ('inside_sales','inside sales','call_center')
        or v.crname like '%inside sales%' or v.crname like '%inside_sales%' or v.crname like '%call center%' or v.crname like '%call_center%') as inside_like,
      v.role in ('admin','owner','operations','manager','sales_manager','regional_manager','rep','sales_rep','closer') or v.sa as pricing_role,
      arx_private.is_field_role(v.role, v.crname) as field_role,
      (exists (select 1 from d where d.owner_user_id = v.id or d.setter_user_id = v.id)
        or exists (select 1 from scheduled_appointments sa where sa.opportunity_id = p_opportunity and (sa.closer_user_id = v.id or sa.canvasser_user_id = v.id))) as own_deal
    from v
  ),
  g as (select f.*, (f.owner_like or f.job_board or f.manager_like or f.closer_role or f.base_setter or f.inside_like) as recognized,
        (f.base_setter and not f.inside_like) as setter_like, (f.pricing_role and not f.field_role) as pricing_ok from f)
  select case
    when p_audience is null then true                       -- legacy rows: unchanged behaviour
    when not coalesce((select in_org from g), false) then false
    when coalesce((select owner_like from g), false) then true
    when not coalesce((select recognized from g), false) then false     -- unknown roles (sub, custom-only) see nothing
    when p_restricted is true and not coalesce((select pricing_ok from g), false) then false
    when p_audience in ('production','crew') then
      coalesce((select not field_role and (job_board or manager_like or own_closer) from g), false)
    when p_audience in ('team','sales','customer') then
      case when coalesce((select setter_like or closer_role from g), false) then (p_opportunity is not null and coalesce((select own_deal from g), false))   -- no deal = not theirs (same as canReadRowOnDeal 'none')
           else true end
    else false
  end;
$$;

-- ---- 6. What the company chose to share (job and customer documents; a customer's own visit photos need no switch) -------------------------------------------------------------------------------
alter table public.documents add column if not exists shared_with_customer boolean not null default false;

alter table public.portal_login_tokens enable row level security;
alter table public.portal_sessions enable row level security;
alter table public.portal_login_events enable row level security;
alter table public.portal_rate_limits enable row level security;
revoke all on public.portal_login_tokens, public.portal_sessions, public.portal_login_events, public.portal_rate_limits from anon, authenticated;

-- ---- 7. Find the customers an email / phone belongs to, inside ONE company --------------------------------------------
-- Exact match only (lower-cased email, last 10 digits of the phone). At most 5 (shared family email / duplicate rows).
create or replace function public.portal_find_customers(p_org uuid, p_email text, p_phone10 text)
returns table (id uuid, name text, email text)
language sql
stable
set search_path = public, pg_temp
as $$
  select c.id, c.name, c.email
    from public.customers c
   where c.org_id = p_org
     and (
       (p_email is not null and p_email <> '' and lower(btrim(c.email)) = p_email)
       or (p_phone10 is not null and char_length(p_phone10) = 10
           and right(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), 10) = p_phone10)
     )
   order by c.created_at
   limit 5;
$$;
revoke all on function public.portal_find_customers(uuid, text, text) from public, anon, authenticated;
grant execute on function public.portal_find_customers(uuid, text, text) to service_role;

-- ---- 8. Use a sign-in link exactly once (atomic: two taps / a mail scanner + the customer cannot both win) -----------
create or replace function public.portal_consume_login_token(p_hash text)
returns table (org_id uuid, customer_id uuid)
language sql
set search_path = public, pg_temp
as $$
  update public.portal_login_tokens t
     set used_at = now()
   where t.token_hash = p_hash
     and t.used_at is null
     and t.expires_at > now()
  returning t.org_id, t.customer_id;
$$;
revoke all on function public.portal_consume_login_token(text) from public, anon, authenticated;
grant execute on function public.portal_consume_login_token(text) to service_role;

-- ---- 9. "May this key try again?" — one atomic counter per key and window -----------------------------------------------
create or replace function public.portal_take_attempt(p_key text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
set search_path = public, pg_temp
as $$
declare v integer;
begin
  insert into public.portal_rate_limits as r (key, window_start, attempts)
  values (p_key, now(), 1)
  on conflict (key) do update
     set attempts = case when r.window_start < now() - make_interval(secs => p_window_seconds) then 1 else r.attempts + 1 end,
         window_start = case when r.window_start < now() - make_interval(secs => p_window_seconds) then now() else r.window_start end
  returning attempts into v;
  -- keep the table small: forget windows that ended over a day ago (cheap, bounded)
  delete from public.portal_rate_limits where key in (select key from public.portal_rate_limits where window_start < now() - interval '1 day' limit 50);
  return v <= p_limit;
end;
$$;
revoke all on function public.portal_take_attempt(text, integer, integer) from public, anon, authenticated;
grant execute on function public.portal_take_attempt(text, integer, integer) to service_role;

commit;
