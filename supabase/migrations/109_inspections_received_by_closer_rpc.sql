-- Inspections "received" by closer: scheduled appointments assigned to this closer (current closer_user_id).
-- Reassignment updates closer_user_id, so credit follows the active assignee (same period rules as inspections set).

CREATE OR REPLACE FUNCTION public.dashboard_inspections_received_by_closer(
  p_org_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_member_ids uuid[]
)
RETURNS TABLE (closer_id uuid, cnt bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.closer_user_id AS closer_id, COUNT(*)::bigint AS cnt
  FROM scheduled_appointments a
  WHERE a.org_id = p_org_id
    AND a.created_at >= p_start
    AND a.created_at < p_end
    AND a.closer_user_id IS NOT NULL
    AND a.closer_user_id = ANY(p_member_ids)
  GROUP BY 1;
$$;

GRANT EXECUTE ON FUNCTION public.dashboard_inspections_received_by_closer(uuid, timestamptz, timestamptz, uuid[]) TO service_role;
