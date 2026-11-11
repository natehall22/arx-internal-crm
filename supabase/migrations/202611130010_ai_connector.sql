-- AI connector, phase 1 (read-only). NOT applied. Additive only: new tables, nothing existing is changed.
-- Every table is service-role only (RLS on, no policies, no grants to anon/authenticated): the browser never reads them.
-- Secrets are never stored: codes, access keys and refresh keys are kept as SHA-256 hex hashes.

-- Apps (Claude, ChatGPT, ...) that registered with us. Global, not per company: registration happens before anyone signs in.
CREATE TABLE IF NOT EXISTS public.ai_oauth_clients (
  client_id     text PRIMARY KEY,
  client_name   text,
  redirect_uris text[] NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('dcr', 'cimd')),
  metadata_url  text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now()
);

-- One-time sign-in codes (10 minutes, used once).
CREATE TABLE IF NOT EXISTS public.ai_oauth_codes (
  code_hash      text PRIMARY KEY,
  client_id      text NOT NULL REFERENCES public.ai_oauth_clients(client_id) ON DELETE CASCADE,
  org_id         uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  redirect_uri   text NOT NULL,
  code_challenge text NOT NULL,
  resource       text NOT NULL,
  scopes         text[] NOT NULL,
  expires_at     timestamptz NOT NULL,
  used_at        timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- One row per approval ("this person connected this app"). Holds the CURRENT access + refresh key hashes.
CREATE TABLE IF NOT EXISTS public.ai_oauth_grants (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  user_id             uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  client_id           text NOT NULL REFERENCES public.ai_oauth_clients(client_id) ON DELETE CASCADE,
  scopes              text[] NOT NULL,
  resource            text NOT NULL,
  code_hash           text,
  access_hash         text NOT NULL UNIQUE,
  access_expires_at   timestamptz NOT NULL,
  refresh_hash        text NOT NULL UNIQUE,
  refresh_expires_at  timestamptz NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  last_used_at        timestamptz,
  revoked_at          timestamptz,
  revoked_reason      text
);
CREATE INDEX IF NOT EXISTS ai_oauth_grants_org_user_idx ON public.ai_oauth_grants (org_id, user_id);
CREATE INDEX IF NOT EXISTS ai_oauth_grants_code_idx ON public.ai_oauth_grants (code_hash);

-- Refresh keys that were already used once. Showing one again = a stolen copy: the whole grant is revoked.
CREATE TABLE IF NOT EXISTS public.ai_oauth_retired_refresh (
  refresh_hash text PRIMARY KEY,
  grant_id     uuid NOT NULL REFERENCES public.ai_oauth_grants(id) ON DELETE CASCADE,
  retired_at   timestamptz NOT NULL DEFAULT now()
);

-- Every tool call and every connect / revoke. Append-only from the app.
CREATE TABLE IF NOT EXISTS public.ai_audit_log (
  id         bigserial PRIMARY KEY,
  org_id     uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  user_id    uuid REFERENCES public.users(id) ON DELETE SET NULL,
  client_id  text,
  tool       text NOT NULL,
  record_ids text[] NOT NULL DEFAULT '{}',
  result     text NOT NULL CHECK (result IN ('ok', 'denied', 'error', 'rate_limited')),
  args_hash  text,
  detail     text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_audit_log_org_created_idx ON public.ai_audit_log (org_id, created_at DESC);

ALTER TABLE public.ai_oauth_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_oauth_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_oauth_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_oauth_retired_refresh ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_oauth_clients, public.ai_oauth_codes, public.ai_oauth_grants, public.ai_oauth_retired_refresh, public.ai_audit_log FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.ai_audit_log_id_seq FROM anon, authenticated;
