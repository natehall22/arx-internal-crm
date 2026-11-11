-- AI connector, phase 2 (writes with preview + confirm). NOT applied. Additive only: one new table + one function.
-- Service-role only (RLS on, no policies, no grants), like the rest of the connector tables.
-- Apply AFTER 202611130010 + 202611130020. Code that uses it fails closed (no change is made) until it is applied.

-- One row per proposed change. The AI asks for a change → a row is born `pending` with the exact arguments and the preview.
-- The AI can NEVER apply it: the signed-in PERSON opens /ai-changes/<id> in the CRM and taps Approve (or Decline).
-- Applied rows are kept: they are the record of "changes made by AI" shown to owners.
CREATE TABLE IF NOT EXISTS public.ai_changes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  -- The connection (grant) it was proposed on (the AI can only ask about its own changes).
  grant_id     uuid REFERENCES public.ai_oauth_grants(id) ON DELETE SET NULL,
  client_id    text,
  tool         text NOT NULL,
  args         jsonb NOT NULL,
  args_hash    text NOT NULL,
  -- What the person was shown (title, lines, links): the owner screen reads it; preview_hash is re-checked at confirm time.
  preview      jsonb NOT NULL,
  preview_hash text NOT NULL,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applying', 'applied', 'failed', 'expired', 'cancelled', 'declined')),
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  finished_at  timestamptz,
  result       jsonb,
  record_ids   text[] NOT NULL DEFAULT '{}',
  error        text,
  -- Saves tried (a note stuck in `applying` is retried once; the writer is idempotent on this row's id).
  attempts     integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ai_changes_org_created_idx ON public.ai_changes (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_changes_user_status_idx ON public.ai_changes (org_id, user_id, status);

ALTER TABLE public.ai_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_changes FROM anon, authenticated;

-- Housekeeping: proposals nobody approved (expired / cancelled / declined) go after p_days; FAILED ones are kept p_failed_days
-- (default 30) so an owner can look at them. Applied and stuck `applying` rows are never deleted.
CREATE OR REPLACE FUNCTION public.ai_prune_changes(p_days integer, p_failed_days integer DEFAULT 30)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  DELETE FROM public.ai_changes
  WHERE (status IN ('pending', 'expired', 'cancelled', 'declined') AND created_at < now() - make_interval(days => p_days))
     OR (status = 'failed' AND created_at < now() - make_interval(days => GREATEST(p_failed_days, 30)));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.ai_prune_changes(integer, integer) FROM public, anon, authenticated;
