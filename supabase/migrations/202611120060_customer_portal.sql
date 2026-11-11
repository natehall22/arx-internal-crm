-- Customer portal (switch `customerPortal`): a customer signs in with a one-time emailed link and sees ONLY their own
-- records at their company's own address. NOT applied by the builder. Apply AFTER 202611100040 (job_invoices.org_id) and
-- 202611120020 (online payments); the portal reads nothing that those do not already have.
--
-- Everything here is service-role only (RLS on, no policies): the browser never reads these tables. Tokens are random
-- 256-bit values and only their SHA-256 is stored, so a database read never yields a working link or session.
--
-- Down (manual): drop table portal_messages, portal_login_events, portal_sessions, portal_login_tokens, portal_rate_limits;
--   drop functions portal_find_customers, portal_consume_login_token, portal_take_attempt;
--   alter table documents / photos drop column shared_with_customer.

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
  via text not null check (via in ('email_link', 'pay_link', 'report_link', 'sign_link')),
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
  kind text not null check (kind in ('link_requested', 'link_sent', 'link_no_match', 'link_blocked', 'login', 'login_failed', 'login_via_link', 'logout')),
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

-- ---- 5. Messages from the customer to the company (and the company's replies) ----------------------------------------
-- Simple inbox: the existing thread system carries staff audiences (team / sales / production / crew) whose visibility is
-- mirrored in SQL (message_visible_to) and in lib/threads/visibility.ts; adding a customer audience would put a customer
-- one wrong rule away from every internal note. A separate table cannot leak one.
create table if not exists public.portal_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  direction text not null check (direction in ('from_customer', 'from_company')),
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_by uuid null references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  read_by_company_at timestamptz null
);
create index if not exists portal_messages_customer on public.portal_messages (org_id, customer_id, created_at desc);

-- ---- 6. What the company chose to share -------------------------------------------------------------------------------
alter table public.documents add column if not exists shared_with_customer boolean not null default false;
alter table public.photos add column if not exists shared_with_customer boolean not null default false;

alter table public.portal_login_tokens enable row level security;
alter table public.portal_sessions enable row level security;
alter table public.portal_login_events enable row level security;
alter table public.portal_rate_limits enable row level security;
alter table public.portal_messages enable row level security;
revoke all on public.portal_login_tokens, public.portal_sessions, public.portal_login_events, public.portal_rate_limits, public.portal_messages from anon, authenticated;

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
