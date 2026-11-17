-- Plan entitlements (2026-11-16, Nathan): which modules a company may use is decided OUTSIDE the company, by the platform
-- owner. Additive only; apply BEFORE the code that reads it (the code treats a missing column as NULL = everything allowed).
--
--   orgs.plan_entitlements   jsonb NULL, a map of feature key -> boolean (keys = lib/org-features.ts ORG_FEATURE_DEFS).
--                            NULL = everything allowed (the original company and every existing company: no data change).
--                            An object = only keys that are true are allowed. Writable ONLY by the server (service role) or
--                            a direct database session, exactly like orgs.support_access_always / orgs.is_demo: a company
--                            user can never change it, through any route or RLS policy.
--   set_plan_entitlement()   the one atomic change: locks the org row, applies one key, writes the log row, in one statement
--                            batch. Callable by the service role only.
--   plan_entitlement_log     append-only record of every change (who, which company, which module, before, after). The
--                            application role can only read and add rows; an update trigger refuses changes even for a
--                            session that holds the privilege.
--
-- Rollback: reverse in the opposite order (log table, function, trigger, guard function, column).

BEGIN;
SET LOCAL lock_timeout = '5s';

-- 1. The plan column ------------------------------------------------------------------------------------------------------
ALTER TABLE public.orgs ADD COLUMN IF NOT EXISTS plan_entitlements jsonb;
COMMENT ON COLUMN public.orgs.plan_entitlements IS
  'Modules this company is allowed (feature key -> boolean). NULL = everything allowed. Set ONLY by the server or a direct database session.';

CREATE OR REPLACE FUNCTION public.guard_orgs_plan_entitlements()
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
    IF NEW.plan_entitlements IS NOT NULL AND v_role NOT IN ('service_role', '') THEN
      RAISE EXCEPTION 'plan_entitlements can only be set by the server' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.plan_entitlements IS DISTINCT FROM OLD.plan_entitlements AND v_role NOT IN ('service_role', '') THEN
    RAISE EXCEPTION 'plan_entitlements can only be changed by the server' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_guard_orgs_plan_entitlements' AND tgrelid = 'public.orgs'::regclass) THEN
    CREATE TRIGGER trg_guard_orgs_plan_entitlements
      BEFORE INSERT OR UPDATE ON public.orgs
      FOR EACH ROW EXECUTE FUNCTION public.guard_orgs_plan_entitlements();
  END IF;
END
$$;

-- 2. The log: append-only -------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.plan_entitlement_log (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id         uuid NOT NULL,
  staff_user_id  uuid NOT NULL,
  feature        text NOT NULL,
  was_entitled   boolean NOT NULL,
  entitled       boolean NOT NULL,
  at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS plan_entitlement_log_org_idx ON public.plan_entitlement_log (org_id, at DESC);
ALTER TABLE public.plan_entitlement_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.plan_entitlement_log FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.plan_entitlement_log TO service_role;
COMMENT ON TABLE public.plan_entitlement_log IS
  'Append-only record of plan changes made on /support. The application role can only read and add rows. Service role only, no policies.';

CREATE OR REPLACE FUNCTION public.plan_entitlement_log_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'plan_entitlement_log is append-only' USING ERRCODE = '42501';
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_plan_entitlement_log_append_only' AND tgrelid = 'public.plan_entitlement_log'::regclass) THEN
    CREATE TRIGGER trg_plan_entitlement_log_append_only
      BEFORE UPDATE ON public.plan_entitlement_log
      FOR EACH ROW EXECUTE FUNCTION public.plan_entitlement_log_append_only();
  END IF;
END
$$;

-- 3. The one atomic change -----------------------------------------------------------------------------------------------
-- p_base is the full map to start from when the company has no plan yet (NULL = all allowed, so the caller passes every
-- feature key as true); the caller (the /support route) validates the feature key against the code's list.
CREATE OR REPLACE FUNCTION public.set_plan_entitlement(p_org uuid, p_staff uuid, p_feature text, p_entitled boolean, p_base jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_was boolean;
BEGIN
  IF p_feature IS NULL OR p_feature = '' OR p_entitled IS NULL OR p_staff IS NULL THEN
    RAISE EXCEPTION 'feature, entitled and staff are required' USING ERRCODE = '22023';
  END IF;
  SELECT plan_entitlements INTO v_old FROM public.orgs WHERE id = p_org FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such company' USING ERRCODE = 'P0002';
  END IF;
  v_was := CASE WHEN v_old IS NULL THEN true ELSE COALESCE((v_old ->> p_feature)::boolean, false) END;
  v_new := COALESCE(v_old, p_base, '{}'::jsonb) || jsonb_build_object(p_feature, p_entitled);
  UPDATE public.orgs SET plan_entitlements = v_new WHERE id = p_org;
  INSERT INTO public.plan_entitlement_log (org_id, staff_user_id, feature, was_entitled, entitled)
  VALUES (p_org, p_staff, p_feature, v_was, p_entitled);
  RETURN v_new;
END;
$$;
REVOKE ALL ON FUNCTION public.set_plan_entitlement(uuid, uuid, text, boolean, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_plan_entitlement(uuid, uuid, text, boolean, jsonb) TO service_role;

COMMIT;
