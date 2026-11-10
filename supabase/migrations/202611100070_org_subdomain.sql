-- Company web address (multi-company slice 10). NOT APPLIED — file only.
--
-- One app + one shared database: each company signs in at <subdomain>.<APP_BASE_DOMAIN>. The address lives on
-- the org row as a real column (not orgs.settings) because it must be UNIQUE across companies and looked up on
-- every request by an index; orgs.settings has several stale-copy writers (Known Redundancy 25) that could
-- silently drop a JSON key, and a JSON key cannot carry a unique constraint cleanly.
--
-- Additive + nullable: NULL = the company has no web address yet (it keeps using the legacy address).
-- Readers: lib/company-host.ts only (via org_id_for_subdomain). Writers: SQL / the seed script; no UI yet.
-- Format + reserved names mirror SUBDOMAIN_RE / RESERVED_SUBDOMAINS in lib/company-host.ts — keep them equal.
--
-- Deploy order: apply this BEFORE setting env APP_BASE_DOMAIN. With APP_BASE_DOMAIN unset nothing reads it.
-- Then: update public.orgs set subdomain = '<name>' where id = '<org id>';

alter table public.orgs add column if not exists subdomain text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'orgs_subdomain_format' and conrelid = 'public.orgs'::regclass) then
    alter table public.orgs
      add constraint orgs_subdomain_format check (
        subdomain is null
        or (
          subdomain ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'
          and subdomain not in (
            'www', 'app', 'api', 'admin', 'auth', 'login', 'mail', 'email', 'smtp', 'status', 'help', 'support', 'docs',
            'static', 'assets', 'cdn', 'm', 'mobile', 'dev', 'staging', 'preview', 'test'
          )
        )
      );
  end if;
end $$;

create unique index if not exists orgs_subdomain_key on public.orgs (subdomain) where subdomain is not null;

comment on column public.orgs.subdomain is
  'Company web address label: <subdomain>.<APP_BASE_DOMAIN>. Lowercase DNS label, unique. NULL = none yet. Read only via lib/company-host.ts.';

-- Address → org id, callable before sign-in (middleware + login page). Returns only the id: whether a name is in
-- use is public anyway (the wildcard DNS answers for every name and the page 404s or not).
create or replace function public.org_id_for_subdomain(p_subdomain text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select o.id
  from public.orgs o
  where p_subdomain is not null
    and o.subdomain = lower(btrim(p_subdomain))
  limit 1
$$;

revoke all on function public.org_id_for_subdomain(text) from public;
grant execute on function public.org_id_for_subdomain(text) to anon, authenticated, service_role;
