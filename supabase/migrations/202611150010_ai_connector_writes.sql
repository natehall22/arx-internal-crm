-- AI connector, phase 2 (writes with preview + confirm). NOT applied. Additive only: one new table + one function.
-- Service-role only (RLS on, no policies, no grants), like the rest of the connector tables.
-- Apply AFTER 202611130010 + 202611130020. Code that uses it fails closed (no change is made) until it is applied.

-- One row per proposed change. The AI asks for a change → a row is born `pending` with the exact arguments and the preview
-- the person was shown; the change happens only when the person confirms that row's one-time key (kept as a SHA-256 hash).
-- Applied rows are kept: they are the record of "changes made by AI" shown to owners.
CREATE TABLE IF NOT EXISTS public.ai_changes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  -- The connection (grant) it was proposed on. Only that same connection may confirm it.
  grant_id     uuid REFERENCES public.ai_oauth_grants(id) ON DELETE SET NULL,
  client_id    text,
  tool         text NOT NULL,
  token_hash   text NOT NULL UNIQUE,
  args         jsonb NOT NULL,
  args_hash    text NOT NULL,
  -- What the person was shown (title, lines, links): the owner screen reads it; preview_hash is re-checked at confirm time.
  preview      jsonb NOT NULL,
  preview_hash text NOT NULL,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applying', 'applied', 'failed', 'expired', 'cancelled')),
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  finished_at  timestamptz,
  result       jsonb,
  record_ids   text[] NOT NULL DEFAULT '{}',
  error        text
);
CREATE INDEX IF NOT EXISTS ai_changes_org_created_idx ON public.ai_changes (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_changes_user_status_idx ON public.ai_changes (org_id, user_id, status);

ALTER TABLE public.ai_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_changes FROM anon, authenticated;

-- Housekeeping: proposals nobody confirmed (and failed / expired ones) go after p_days. Applied changes stay.
CREATE OR REPLACE FUNCTION public.ai_prune_changes(p_days integer)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  DELETE FROM public.ai_changes
  WHERE status <> 'applied' AND status <> 'applying' AND created_at < now() - make_interval(days => p_days);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.ai_prune_changes(integer) FROM public, anon, authenticated;
