-- Support access (2026-11-16, Nathan): the one audited door by which the product owner and his support staff enter a customer
-- company's CRM ("Grant Account Login Access" + "Login As"). Additive only; apply BEFORE the code that reads these tables.
-- The code treats a missing table as "no support access for anyone" (fails closed).
--
--   platform_support_staff   who may use /support. Service role only, no policies. Rows are added by SQL by the operator
--                            (see docs/support-access.md); nobody can add themselves from the app.
--   support_access_grants    a company owner's grant: for a chosen time (1 day / 1 week / 1 month / 1 year), ended any time.
--   orgs.support_access_always  true = this company is always open to support (the operator's own company). Set only by
--                            the server or a direct database session, exactly like orgs.is_demo / users.is_super_admin.
--   support_access_log       append-only record of every enter / exit / upgrade / write / blocked send. The application role
--                            can only read and add rows: update and removal are refused by privileges, and an update trigger
--                            refuses changes even for a session that holds them.
--
-- Rollback: reverse the objects below in the opposite order (log, grants, staff, trigger, function, column).
-- The log and the grant/user references carry no cascading keys on purpose: an audit trail must outlive the people in it.

BEGIN;
SET LOCAL lock_timeout = '5s';

-- 1. Platform support staff ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.platform_support_staff (
  user_id   uuid PRIMARY KEY REFERENCES public.users(id),
  added_at  timestamptz NOT NULL DEFAULT now(),
  added_by  uuid
);
ALTER TABLE public.platform_support_staff ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_support_staff FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.platform_support_staff TO service_role;
COMMENT ON TABLE public.platform_support_staff IS
  'People allowed to use /support. Service role only, no RLS policies. Added by SQL by the operator; see docs/support-access.md.';

-- 2. Grants a company owner gives -----------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.support_access_grants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.orgs(id),
  granted_by  uuid,
  granted_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  ended_at    timestamptz,
  ended_by    uuid
);
CREATE INDEX IF NOT EXISTS support_access_grants_org_idx ON public.support_access_grants (org_id, expires_at);
ALTER TABLE public.support_access_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.support_access_grants FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.support_access_grants TO service_role;
COMMENT ON TABLE public.support_access_grants IS
  'A company owner''s grant of support access. Live = ended_at is null and expires_at is in the future. Service role only.';

-- 3. Always-on flag, writable only by the server ----------------------------------------------------------------------------
ALTER TABLE public.orgs ADD COLUMN IF NOT EXISTS support_access_always boolean;
COMMENT ON COLUMN public.orgs.support_access_always IS
  'true = support staff may always enter this company (the operator''s own). Set ONLY by the server or a direct database session.';

CREATE OR REPLACE FUNCTION public.guard_orgs_support_access_always()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_role text := COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''),
                          (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'),
                          '');
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.support_access_always IS NOT NULL AND v_role NOT IN ('service_role', '') THEN
      RAISE EXCEPTION 'support_access_always can only be set by the server' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.support_access_always IS DISTINCT FROM OLD.support_access_always AND v_role NOT IN ('service_role', '') THEN
    RAISE EXCEPTION 'support_access_always can only be changed by the server' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_guard_orgs_support_access_always' AND tgrelid = 'public.orgs'::regclass) THEN
    CREATE TRIGGER trg_guard_orgs_support_access_always
      BEFORE INSERT OR UPDATE ON public.orgs
      FOR EACH ROW EXECUTE FUNCTION public.guard_orgs_support_access_always();
  END IF;
END
$$;

-- 4. The log: append-only -------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.support_access_log (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id            uuid NOT NULL,
  staff_user_id     uuid NOT NULL,
  acting_as_user_id uuid,
  level             text NOT NULL CHECK (level IN ('view', 'full')),
  event             text NOT NULL CHECK (event IN ('enter', 'exit', 'upgrade', 'write', 'blocked_send')),
  detail            jsonb NOT NULL DEFAULT '{}'::jsonb,
  handoff_id        text,
  at                timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_access_log_org_idx ON public.support_access_log (org_id, at DESC);
-- A hand-off link is good once: its one-time id is logged with the 'enter' row, and a second use breaks this index.
CREATE UNIQUE INDEX IF NOT EXISTS support_access_log_handoff_once ON public.support_access_log (handoff_id) WHERE handoff_id IS NOT NULL;
ALTER TABLE public.support_access_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.support_access_log FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.support_access_log TO service_role;
COMMENT ON TABLE public.support_access_log IS
  'Append-only record of support sessions. The application role can only read and add rows. Service role only.';

CREATE OR REPLACE FUNCTION public.support_access_log_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'support_access_log is append-only' USING ERRCODE = '42501';
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_support_access_log_append_only' AND tgrelid = 'public.support_access_log'::regclass) THEN
    CREATE TRIGGER trg_support_access_log_append_only
      BEFORE UPDATE ON public.support_access_log
      FOR EACH ROW EXECUTE FUNCTION public.support_access_log_append_only();
  END IF;
END
$$;

COMMIT;
