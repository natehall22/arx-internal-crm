-- Old company web addresses keep working after a rename (multi-company, company links). NOT APPLIED — file only.
-- Needs 202611100070 (orgs.subdomain) first.
--
-- When a company's orgs.subdomain changes, the old name is kept here as an alias of that company. Links already sent
-- (reports /r, crew /crew, signing pages, review /api/r, staff emails) carry the old address; middleware.ts answers any
-- request on an alias with a 308 to the same path on the company's CURRENT address (lib/company-host.ts
-- lookupSubdomainAlias via company_subdomain_for_alias). New links always use orgs.subdomain.
--
-- An alias belongs to its company for good: no other company can take that name (it would receive the first
-- company's customer links). The company itself can take it back (the alias row is then removed).
--
-- Additive: new table + triggers + function. RLS on, no policies (service role / security-definer function only).

create table if not exists public.org_subdomain_aliases (
  subdomain text primary key,
  org_id uuid not null references public.orgs (id) on delete cascade,
  retired_at timestamptz not null default now(),
  constraint org_subdomain_aliases_format check (subdomain ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$')
);

create index if not exists org_subdomain_aliases_org_id_idx on public.org_subdomain_aliases (org_id);

alter table public.org_subdomain_aliases enable row level security;

comment on table public.org_subdomain_aliases is
  'Retired company web names (old orgs.subdomain values). Requests on them are redirected to the current address. Read only via lib/company-host.ts.';

-- Before a company takes a name: refuse another company's retired name.
create or replace function public.orgs_subdomain_alias_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.subdomain is not null and exists (
    select 1 from public.org_subdomain_aliases a where a.subdomain = new.subdomain and a.org_id <> new.id
  ) then
    raise exception 'The web address "%" is a former address of another company and cannot be reused.', new.subdomain
      using errcode = '23505';
  end if;
  return new;
end
$$;

-- After a rename: keep the old name as this company's alias; a name taken back stops being an alias.
create or replace function public.orgs_subdomain_keep_alias()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.subdomain is not null and old.subdomain is distinct from new.subdomain then
    insert into public.org_subdomain_aliases (subdomain, org_id)
    values (old.subdomain, new.id)
    on conflict (subdomain) do nothing;
  end if;
  if new.subdomain is not null then
    delete from public.org_subdomain_aliases a where a.subdomain = new.subdomain and a.org_id = new.id;
  end if;
  return new;
end
$$;

drop trigger if exists orgs_subdomain_alias_guard on public.orgs;
create trigger orgs_subdomain_alias_guard
  before insert or update of subdomain on public.orgs
  for each row execute function public.orgs_subdomain_alias_guard();

drop trigger if exists orgs_subdomain_keep_alias on public.orgs;
create trigger orgs_subdomain_keep_alias
  after update of subdomain on public.orgs
  for each row execute function public.orgs_subdomain_keep_alias();

-- Retired name → the company's CURRENT web name (null when it is no alias, or the company has none now).
-- Anon-callable like org_id_for_subdomain: the redirect itself reveals the same fact. Returns no org id.
create or replace function public.company_subdomain_for_alias(p_subdomain text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select o.subdomain
  from public.org_subdomain_aliases a
  join public.orgs o on o.id = a.org_id
  where p_subdomain is not null
    and a.subdomain = lower(btrim(p_subdomain))
    and o.subdomain is not null
  limit 1
$$;

revoke all on function public.company_subdomain_for_alias(text) from public;
grant execute on function public.company_subdomain_for_alias(text) to anon, authenticated, service_role;
