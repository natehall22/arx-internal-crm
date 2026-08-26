-- dashboard_door_rpc_attribution_is_pin_first() (130_dashboard_canvass_exclude_inbound_disposition_only.sql)
-- is a live drift guard: app/api/dashboard/team-stats/route.ts calls it on every admin
-- request and console.warns if dashboard_door_leads_by_owner looks like it regressed to
-- owner-first attribution. 202608250002_dashboard_door_counts_from_knocks.sql rewrote that
-- function to source from canvass_knocks (frozen-at-knock-time user_id) instead of a live
-- COALESCE(l.pin_attributed_user_id, l.owner_user_id) join, so the old text match would
-- now find neither pattern and start warning on every correctly-migrated request. Teach it
-- the new shape instead of leaving a permanent false alarm.
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

  -- Current shape (202608250002): attribution is frozen per-knock in canvass_knocks.user_id
  -- at write time, not resolved live against leads on every read.
  IF position('FROM canvass_knocks' in d) > 0 THEN
    RETURN true;
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
