-- Reserve `arx` (arx.arxcapitol.com) for managing CRM customers (Nathan, 2026-11-12). ARX Roofing's own address is
-- `arxhome`. Same rule as 202611100070 plus 'arx'; mirrors RESERVED_SUBDOMAINS in lib/company-host.ts — keep them equal.
-- Safe on prod: no company has a subdomain yet (all NULL, checked 2026-11-12). Phase 1 (before or after the code).
begin;
set local lock_timeout = '5s';
alter table public.orgs drop constraint if exists orgs_subdomain_format;
alter table public.orgs
  add constraint orgs_subdomain_format check (
    subdomain is null
    or (
      subdomain ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'
      and subdomain not in (
        'www', 'app', 'api', 'admin', 'auth', 'login', 'mail', 'email', 'smtp', 'status', 'help', 'support', 'docs',
        'static', 'assets', 'cdn', 'm', 'mobile', 'dev', 'staging', 'preview', 'test', 'arx'
      )
    )
  );
commit;
