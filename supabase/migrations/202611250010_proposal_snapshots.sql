-- Proposal snapshots (2026-11-25): what a customer was shown on a proposal, kept as DATA (the exact figures, lines, theme and
-- notes fed to the PDF renderer) so the exact PDF can be rebuilt later. ARX customers never sign proposals (they sign the
-- installation agreement, which is stored as a PDF); this answers "what did we quote them" and copy requests. Additive only.
--
-- * One row per distinct content: unique (proposal_id, content_hash), so regenerating an unchanged PDF stores nothing new.
--   The hash is computed by the server from canonical JSON (lib/proposal-snapshots.ts), never by the browser.
-- * snapshot holds paths / URLs already in the proposal data, never image bytes (the app caps a row at 512 KB).
-- * RLS on with no policies: service role only (the API route does the access check).
-- * proposal_id has no foreign key on purpose: a snapshot is a record of what was quoted and must outlive a removed proposal.
--   The guard trigger checks on insert that the proposal exists in the same company.
-- Apply BEFORE the code (the code skips quietly and logs once if the table is missing).
-- Rollback (no other table depends on it): remove the table proposal_snapshots and the function proposal_snapshots_guard.

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.proposal_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.orgs(id),
  proposal_id uuid NOT NULL,
  reason text NOT NULL CHECK (reason IN ('pdf', 'sent', 'quote_link')),
  content_hash text NOT NULL CHECK (char_length(content_hash) BETWEEN 16 AND 128),
  snapshot jsonb NOT NULL,
  created_by uuid NULL, -- no foreign key: a removed user must not block or erase the record
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT proposal_snapshots_one_per_content UNIQUE (proposal_id, content_hash)
);
CREATE INDEX IF NOT EXISTS proposal_snapshots_proposal_idx ON public.proposal_snapshots (org_id, proposal_id, created_at DESC);

ALTER TABLE public.proposal_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.proposal_snapshots FROM anon, authenticated;

-- Company guard: the proposal and the person are this company's own; a row never moves company.
CREATE OR REPLACE FUNCTION public.proposal_snapshots_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.org_id IS DISTINCT FROM OLD.org_id OR NEW.proposal_id IS DISTINCT FROM OLD.proposal_id THEN
      RAISE EXCEPTION 'a snapshot cannot move to another proposal or company' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.proposals p WHERE p.id = NEW.proposal_id AND p.org_id = NEW.org_id) THEN
    RAISE EXCEPTION 'proposal is not in this company' USING ERRCODE = '42501';
  END IF;
  IF NEW.created_by IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = NEW.created_by AND u.org_id = NEW.org_id) THEN
    RAISE EXCEPTION 'user is not in this company' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER proposal_snapshots_guard_trg BEFORE INSERT OR UPDATE ON public.proposal_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.proposal_snapshots_guard();
