-- orgs.original_brand (2026-11-28): server-only marker of the ORIGINAL company. Additive only.
-- It gates that company's legacy brand strings, bundled artwork, built-in contracts and /whats-new screenshots. It replaces
-- trusting `orgs.email`, which managers can edit. Default false: every other company is neutral.
--
-- DEPLOY ORDER:
--   1. Apply this migration.
--   2. Run, as a database session (service role / SQL editor; the guard below refuses anyone else):
--        update orgs set original_brand = true where id = '9089d4ad-f46c-405b-9798-6751d45a7051';
--      This MUST happen BEFORE the code is deployed, or the original company would resolve as neutral.
--   3. Deploy the code.
-- The code must NOT deploy before steps 1 and 2: it reads orgs.original_brand (a missing column is logged loudly and treated as
-- "not original", so the original company would print neutral text), and unflagged means neutral. The original company
-- keeps its text only while its row is flagged.
-- Direct app-user updates of orgs are already blocked (RLS is on and there is no UPDATE policy for app roles), so the guard
-- below covers original_brand against any future policy; email is changed only through the settings API (super admins).

ALTER TABLE orgs ADD COLUMN IF NOT EXISTS original_brand BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN orgs.original_brand IS
  'True only for the original company. Server-only: changed by the service role or a migration/SQL session, never by an app user (trigger guard_orgs_original_brand).';

-- Admins/managers can UPDATE orgs through RLS, so without this guard any manager could claim the flag with a direct API call.
CREATE OR REPLACE FUNCTION guard_orgs_original_brand()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_role TEXT := COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''),
                          (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'),
                          '');
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF COALESCE(NEW.original_brand, FALSE) AND v_role NOT IN ('service_role', '') THEN
      RAISE EXCEPTION 'original_brand can only be set by the server' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.original_brand IS DISTINCT FROM OLD.original_brand AND v_role NOT IN ('service_role', '') THEN
    RAISE EXCEPTION 'original_brand can only be changed by the server' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_orgs_original_brand ON orgs;
CREATE TRIGGER trg_guard_orgs_original_brand
  BEFORE INSERT OR UPDATE ON orgs
  FOR EACH ROW EXECUTE FUNCTION guard_orgs_original_brand();
