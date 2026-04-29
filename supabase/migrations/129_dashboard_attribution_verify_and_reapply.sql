-- Re-apply pin-first door/contact aggregates (same as 127/128) and add a small introspection
-- helper so the app can detect if production is still on owner-first (migration 107) definitions.

CREATE OR REPLACE FUNCTION public.dashboard_count_door_leads_scoped(
  p_org_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_scope_user_ids uuid[]
)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::bigint
  FROM leads l
  WHERE l.org_id = p_org_id
    AND l.created_at >= p_start
    AND l.created_at < p_end
    AND (
      cardinality(p_scope_user_ids) = 0
      OR COALESCE(l.pin_attributed_user_id, l.owner_user_id) = ANY(p_scope_user_ids)
    )
    AND (
      lower(trim(COALESCE(l.source::text, ''))) IN ('door_to_door', 'canvass', 'door_knock')
      OR l.canvass_disposition IS NOT NULL
    );
$$;

CREATE OR REPLACE FUNCTION public.dashboard_count_contact_leads_scoped(
  p_org_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_scope_user_ids uuid[],
  p_disposition_ids text[]
)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::bigint
  FROM leads l
  WHERE l.org_id = p_org_id
    AND l.created_at >= p_start
    AND l.created_at < p_end
    AND (
      cardinality(p_scope_user_ids) = 0
      OR COALESCE(l.pin_attributed_user_id, l.owner_user_id) = ANY(p_scope_user_ids)
    )
    AND (
      lower(trim(COALESCE(l.source::text, ''))) IN ('door_to_door', 'canvass', 'door_knock')
      OR l.canvass_disposition IS NOT NULL
    )
    AND cardinality(p_disposition_ids) > 0
    AND l.canvass_disposition::text = ANY(p_disposition_ids);
$$;

CREATE OR REPLACE FUNCTION public.dashboard_door_leads_by_owner(
  p_org_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_member_ids uuid[]
)
RETURNS TABLE (owner_id uuid, cnt bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(l.pin_attributed_user_id, l.owner_user_id) AS owner_id,
    COUNT(*)::bigint AS cnt
  FROM leads l
  WHERE l.org_id = p_org_id
    AND l.created_at >= p_start
    AND l.created_at < p_end
    AND COALESCE(l.pin_attributed_user_id, l.owner_user_id) IS NOT NULL
    AND COALESCE(l.pin_attributed_user_id, l.owner_user_id) = ANY(p_member_ids)
    AND (
      lower(trim(COALESCE(l.source::text, ''))) IN ('door_to_door', 'canvass', 'door_knock')
      OR l.canvass_disposition IS NOT NULL
    )
  GROUP BY 1;
$$;

CREATE OR REPLACE FUNCTION public.dashboard_contact_leads_by_owner(
  p_org_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_member_ids uuid[],
  p_disposition_ids text[]
)
RETURNS TABLE (owner_id uuid, cnt bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(l.pin_attributed_user_id, l.owner_user_id) AS owner_id,
    COUNT(*)::bigint AS cnt
  FROM leads l
  WHERE l.org_id = p_org_id
    AND l.created_at >= p_start
    AND l.created_at < p_end
    AND COALESCE(l.pin_attributed_user_id, l.owner_user_id) IS NOT NULL
    AND COALESCE(l.pin_attributed_user_id, l.owner_user_id) = ANY(p_member_ids)
    AND (
      lower(trim(COALESCE(l.source::text, ''))) IN ('door_to_door', 'canvass', 'door_knock')
      OR l.canvass_disposition IS NOT NULL
    )
    AND cardinality(p_disposition_ids) > 0
    AND l.canvass_disposition::text = ANY(p_disposition_ids)
  GROUP BY 1;
$$;

CREATE OR REPLACE FUNCTION public.dashboard_door_rpc_attribution_is_pin_first()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d text;
BEGIN
  BEGIN
    d := pg_get_functiondef(
      'public.dashboard_door_leads_by_owner(uuid,timestamptz,timestamptz,uuid[])'::regprocedure
    );
  EXCEPTION
    WHEN OTHERS THEN
      RETURN NULL;
  END;

  IF d IS NULL OR length(trim(d)) = 0 THEN
    RETURN NULL;
  END IF;

  IF position('COALESCE(l.owner_user_id, l.pin_attributed_user_id' in d) > 0 THEN
    RETURN false;
  END IF;

  IF position('COALESCE(l.pin_attributed_user_id, l.owner_user_id' in d) > 0 THEN
    RETURN true;
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.dashboard_door_rpc_attribution_is_pin_first() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dashboard_door_rpc_attribution_is_pin_first() TO service_role;
