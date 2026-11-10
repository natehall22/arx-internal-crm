-- Google Calendar connect started on a company web address (slice 10). NOT APPLIED — file only.
-- lib/google-oauth-state.ts: start inserts one row per signed ticket (and an httpOnly nonce cookie in that browser);
-- the callback parks Google's one-time code here (AES-256-GCM sealed, once); the finish step on the company address
-- consumes the row exactly once and only for the starting browser + user. Expired rows are pruned on every new ticket.
-- Service role only (RLS on, no policies). Apply BEFORE setting APP_BASE_DOMAIN (only company addresses use it).

create table if not exists public.oauth_states (
  nonce uuid primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  code_ciphertext text,
  code_received_at timestamptz
);

create index if not exists oauth_states_expires_at_idx on public.oauth_states (expires_at);

alter table public.oauth_states enable row level security;
revoke all on table public.oauth_states from anon, authenticated;
