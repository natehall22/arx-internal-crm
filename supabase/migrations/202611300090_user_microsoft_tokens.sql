-- Outlook / Microsoft 365 calendar connection, one row per user (parallel to user_google_tokens). NOT APPLIED - file only.
-- Additive. Access and refresh tokens are sealed at rest (lib/secret-seal.ts, env SECRETS_ENCRYPTION_KEY, bound to
-- "<user id>:<column>"). Microsoft rotates refresh tokens, so every refresh rewrites both columns.
-- One calendar provider per user is enforced in code (lib/calendar/connection.ts): connecting one clears the other.
-- Service role only (RLS on, no policies).

create table if not exists public.user_microsoft_tokens (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  access_token_sealed text not null,
  refresh_token_sealed text not null,
  expires_at timestamptz not null,
  scope text,
  account_email text,
  tenant_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

create index if not exists user_microsoft_tokens_org_idx on public.user_microsoft_tokens (org_id);

alter table public.user_microsoft_tokens enable row level security;
revoke all on table public.user_microsoft_tokens from anon, authenticated;
