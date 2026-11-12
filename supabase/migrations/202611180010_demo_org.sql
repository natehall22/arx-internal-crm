-- Demo company (2026-11-11): a flag that marks ONE fictional company used to show prospects the CRM, and the only way
-- to wipe it. Additive: one nullable-safe column, one guard trigger, one SQL function. Do not apply by hand outside the
-- normal migration flow (apply BEFORE the code that reads orgs.is_demo; the code tolerates the column being missing).
--
--   orgs.is_demo            true = a demo company. Set ONLY by the server (service role) or a direct DB session, exactly
--                           like users.is_super_admin: an org admin with a browser session can neither make a real company
--                           a demo (which would make it wipeable) nor flip a demo to real.
--   demo_reset_org(org)     deletes every row that belongs to the demo company (every public table with an org_id column)
--                           and clears its settings, leaving the orgs row itself. REFUSES any org whose is_demo is not
--                           true, and any caller that is not the service role. Callable by nobody else (EXECUTE revoked).
--
-- Rollback: DROP FUNCTION public.demo_reset_org(uuid); DROP TRIGGER trg_guard_orgs_is_demo ON public.orgs;
--           DROP FUNCTION public.guard_orgs_is_demo(); ALTER TABLE public.orgs DROP COLUMN is_demo;

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.orgs ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.orgs.is_demo IS
  'Fictional demo company (scripts/seed-company.ts --demo). Outbound email/SMS is suppressed, Stripe live keys / QuickBooks / a real texting number are refused, and demo_reset_org may wipe it. Server-only.';

-- Same pattern as guard_users_is_super_admin (202610210010): the browser roles can never change it.
CREATE OR REPLACE FUNCTION public.guard_orgs_is_demo()
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
    IF COALESCE(NEW.is_demo, false) AND v_role NOT IN ('service_role', '') THEN
      RAISE EXCEPTION 'is_demo can only be set by the server' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.is_demo IS DISTINCT FROM OLD.is_demo AND v_role NOT IN ('service_role', '') THEN
    RAISE EXCEPTION 'is_demo can only be changed by the server' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_orgs_is_demo ON public.orgs;
CREATE TRIGGER trg_guard_orgs_is_demo
  BEFORE INSERT OR UPDATE ON public.orgs
  FOR EACH ROW EXECUTE FUNCTION public.guard_orgs_is_demo();

-- Wipe ONE demo company's data. Every public base table that has a uuid org_id column is emptied for that org only
-- (`DELETE ... WHERE org_id = p_org`), in as many passes as it takes for foreign keys to clear (a parent row can only go
-- once its children have). A table that refuses (an append-only trigger, a foreign key from a table with no org_id) is
-- reported in `blocked` and left alone: the caller stops and says so instead of rebuilding over leftovers.
-- Returns { deleted: { table: rows }, blocked: { table: message }, passes: n }.
CREATE OR REPLACE FUNCTION public.demo_reset_org(p_org uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text := COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''),
                          (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'),
                          '');
  rec record;
  pass integer := 0;
  n bigint;
  progress boolean;
  deleted jsonb := '{}'::jsonb;
  blocked jsonb := '{}'::jsonb;
BEGIN
  IF v_role NOT IN ('service_role', '') THEN
    RAISE EXCEPTION 'demo_reset_org can only be called by the server' USING ERRCODE = '42501';
  END IF;
  IF p_org IS NULL OR NOT EXISTS (SELECT 1 FROM public.orgs o WHERE o.id = p_org AND o.is_demo IS TRUE) THEN
    RAISE EXCEPTION 'not a demo company: nothing was deleted' USING ERRCODE = '42501';
  END IF;

  LOOP
    pass := pass + 1;
    progress := false;
    blocked := '{}'::jsonb;
    FOR rec IN
      SELECT c.table_name::text AS t
        FROM information_schema.columns c
        JOIN information_schema.tables tb ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
       WHERE c.table_schema = 'public' AND c.column_name = 'org_id' AND c.data_type = 'uuid'
         AND tb.table_type = 'BASE TABLE' AND c.table_name <> 'orgs'
       ORDER BY c.table_name
    LOOP
      BEGIN
        EXECUTE format('DELETE FROM public.%I WHERE org_id = $1', rec.t) USING p_org;
        GET DIAGNOSTICS n = ROW_COUNT;
        IF n > 0 THEN
          progress := true;
          deleted := jsonb_set(deleted, ARRAY[rec.t], to_jsonb(COALESCE((deleted ->> rec.t)::bigint, 0) + n));
        END IF;
      EXCEPTION WHEN OTHERS THEN
        blocked := jsonb_set(blocked, ARRAY[rec.t], to_jsonb(left(SQLERRM, 200)));
      END;
    END LOOP;
    EXIT WHEN NOT progress OR blocked = '{}'::jsonb OR pass >= 12;
  END LOOP;

  -- The company's own settings start empty again (the seed writes them); the orgs row, its name and is_demo stay.
  UPDATE public.orgs SET settings = '{}'::jsonb WHERE id = p_org AND is_demo IS TRUE;

  RETURN jsonb_build_object('deleted', deleted, 'blocked', blocked, 'passes', pass);
END;
$$;

REVOKE ALL ON FUNCTION public.demo_reset_org(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.demo_reset_org(uuid) TO service_role;

COMMIT;
