-- QuickBooks Online connection (feature switch `quickbooks`, default OFF). docs/quickbooks-sync.md, PR 2 (connection only).
-- NOT APPLIED — file only. Additive: two new tables, nothing existing changes. Service role only (RLS on, no policies, no grants).
--
-- qb_connections: each company's ONE QuickBooks company (realm). Tokens are stored ENCRYPTED (AES-256-GCM, key from env
--   SECRETS_ENCRYPTION_KEY, lib/secret-seal.ts); plaintext tokens never touch this table. Rows are kept after a disconnect
--   (tokens wiped, status 'disconnected') so qb_links keep meaning; a new connect for the same company reuses the row.
--   refresh_version + refresh_lease_until = compare-and-swap lease so two workers never refresh the same token at once
--   (Intuit rotates the refresh token on use: a second refresh with the old one kills the connection).
-- qb_links: THE one CRM <-> QuickBooks map. Nothing else stores a QuickBooks id.
--
-- Down (manual): drop table qb_links; drop table qb_connections;

begin;
set local lock_timeout = '5s';

create table if not exists public.qb_connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  realm_id text not null,
  environment text not null default 'production' check (environment in ('sandbox', 'production')),
  company_name text null,
  status text not null default 'connected' check (status in ('connected', 'needs_reconnect', 'disconnected')),
  needs_reconnect_reason text null,
  access_token_ct text null,
  refresh_token_ct text null,
  access_expires_at timestamptz null,
  refresh_expires_at timestamptz null,
  refresh_version integer not null default 0,
  refresh_lease_until timestamptz null,
  last_refreshed_at timestamptz null,
  last_error text null,
  connected_by uuid null references public.users(id) on delete set null,
  connected_at timestamptz not null default now(),
  disconnected_at timestamptz null,
  disconnected_by uuid null references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint qb_connections_one_per_company unique (org_id),
  -- a connected row always holds both tokens; a disconnected one holds none
  constraint qb_connections_tokens_match_status check (
    (status = 'disconnected' and access_token_ct is null and refresh_token_ct is null)
    or (status <> 'disconnected' and refresh_token_ct is not null)
  )
);

-- One QuickBooks company belongs to ONE CRM company at a time (a disconnected row frees it).
create unique index if not exists qb_connections_one_live_realm on public.qb_connections (realm_id, environment) where status <> 'disconnected';

create table if not exists public.qb_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  crm_table text not null,
  crm_id uuid not null,
  qb_type text not null,
  qb_id text not null,
  sync_token text null,
  last_synced_at timestamptz null,
  created_at timestamptz not null default now(),
  constraint qb_links_one_per_crm_record unique (org_id, crm_table, crm_id, qb_type),
  constraint qb_links_one_per_qb_record unique (org_id, qb_type, qb_id)
);

alter table public.qb_connections enable row level security;
alter table public.qb_links enable row level security;
revoke all on table public.qb_connections from anon, authenticated;
revoke all on table public.qb_links from anon, authenticated;

commit;
