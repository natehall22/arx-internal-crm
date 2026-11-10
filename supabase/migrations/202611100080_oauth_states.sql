-- Single-use nonces for Google Calendar connect started on a company web address (slice 10). NOT APPLIED — file only.
-- lib/google-oauth-state.ts: the connect start inserts one row per signed state; the callback consumes it with
-- `update ... where used_at is null and expires_at > now()`, so a state works once, within 10 minutes.
-- Service role only (RLS on, no policies). Rows are tiny; a periodic `delete where expires_at < now() - interval '1 day'`
-- can be added to an existing cron later. Apply BEFORE setting APP_BASE_DOMAIN (only company addresses use it).

create table if not exists public.oauth_states (
  nonce uuid primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

alter table public.oauth_states enable row level security;
revoke all on table public.oauth_states from anon, authenticated;
