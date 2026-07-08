-- Count only initial canvass inspections toward "inspections set" KPIs.
-- Close / follow-up / insurance follow-up rows share canvasser_user_id but are not sets.
-- Cancelled rows (e.g. after reschedule) must not double-count with the replacement row.

CREATE OR REPLACE FUNCTION public.dashboard_inspections_set_by_canvasser(
  p_org_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_member_ids uuid[]
)
RETURNS TABLE (canvasser_id uuid, cnt bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.canvasser_user_id AS canvasser_id, COUNT(*)::bigint AS cnt
  FROM scheduled_appointments a
  WHERE a.org_id = p_org_id
    AND a.created_at >= p_start
    AND a.created_at < p_end
    AND a.canvasser_user_id = ANY(p_member_ids)
    AND (a.appointment_type IS NULL OR a.appointment_type = 'inspection')
    AND COALESCE(a.status, 'scheduled') <> 'cancelled'
  GROUP BY 1;
$$;
