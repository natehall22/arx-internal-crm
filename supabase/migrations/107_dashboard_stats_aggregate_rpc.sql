-- Server-side aggregates for dashboard APIs (avoid loading millions of rows in Node).

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
      OR COALESCE(l.owner_user_id, l.pin_attributed_user_id) = ANY(p_scope_user_ids)
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
      OR COALESCE(l.owner_user_id, l.pin_attributed_user_id) = ANY(p_scope_user_ids)
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
    COALESCE(l.owner_user_id, l.pin_attributed_user_id) AS owner_id,
    COUNT(*)::bigint AS cnt
  FROM leads l
  WHERE l.org_id = p_org_id
    AND l.created_at >= p_start
    AND l.created_at < p_end
    AND COALESCE(l.owner_user_id, l.pin_attributed_user_id) IS NOT NULL
    AND COALESCE(l.owner_user_id, l.pin_attributed_user_id) = ANY(p_member_ids)
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
    COALESCE(l.owner_user_id, l.pin_attributed_user_id) AS owner_id,
    COUNT(*)::bigint AS cnt
  FROM leads l
  WHERE l.org_id = p_org_id
    AND l.created_at >= p_start
    AND l.created_at < p_end
    AND COALESCE(l.owner_user_id, l.pin_attributed_user_id) IS NOT NULL
    AND COALESCE(l.owner_user_id, l.pin_attributed_user_id) = ANY(p_member_ids)
    AND (
      lower(trim(COALESCE(l.source::text, ''))) IN ('door_to_door', 'canvass', 'door_knock')
      OR l.canvass_disposition IS NOT NULL
    )
    AND cardinality(p_disposition_ids) > 0
    AND l.canvass_disposition::text = ANY(p_disposition_ids)
  GROUP BY 1;
$$;

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
  GROUP BY 1;
$$;

CREATE OR REPLACE FUNCTION public.dashboard_closer_calendar_appts_by_closer(
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
    AND a.scheduled_for >= p_start
    AND a.scheduled_for < p_end
    AND a.closer_user_id IS NOT NULL
    AND a.closer_user_id = ANY(p_member_ids)
  GROUP BY 1;
$$;

CREATE OR REPLACE FUNCTION public.dashboard_sit_counts_by_setter(
  p_org_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_member_ids uuid[],
  p_normalized_outcomes text[]
)
RETURNS TABLE (setter_id uuid, cnt bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT o.setter_user_id AS setter_id, COUNT(*)::bigint AS cnt
  FROM opportunities o
  WHERE o.org_id = p_org_id
    AND o.inspection_outcome IS NOT NULL
    AND o.inspection_outcome_at IS NOT NULL
    AND o.inspection_outcome_at >= p_start
    AND o.inspection_outcome_at < p_end
    AND o.setter_user_id = ANY(p_member_ids)
    AND cardinality(p_normalized_outcomes) > 0
    AND lower(trim(o.inspection_outcome::text)) = ANY(p_normalized_outcomes)
  GROUP BY 1;
$$;

CREATE OR REPLACE FUNCTION public.dashboard_sit_counts_by_owner(
  p_org_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_member_ids uuid[],
  p_normalized_outcomes text[]
)
RETURNS TABLE (owner_id uuid, cnt bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT o.owner_user_id AS owner_id, COUNT(*)::bigint AS cnt
  FROM opportunities o
  WHERE o.org_id = p_org_id
    AND o.inspection_outcome IS NOT NULL
    AND o.inspection_outcome_at IS NOT NULL
    AND o.inspection_outcome_at >= p_start
    AND o.inspection_outcome_at < p_end
    AND o.owner_user_id = ANY(p_member_ids)
    AND cardinality(p_normalized_outcomes) > 0
    AND lower(trim(o.inspection_outcome::text)) = ANY(p_normalized_outcomes)
  GROUP BY 1;
$$;

GRANT EXECUTE ON FUNCTION public.dashboard_count_door_leads_scoped(uuid, timestamptz, timestamptz, uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_count_contact_leads_scoped(uuid, timestamptz, timestamptz, uuid[], text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_door_leads_by_owner(uuid, timestamptz, timestamptz, uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_contact_leads_by_owner(uuid, timestamptz, timestamptz, uuid[], text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_inspections_set_by_canvasser(uuid, timestamptz, timestamptz, uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_closer_calendar_appts_by_closer(uuid, timestamptz, timestamptz, uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_sit_counts_by_setter(uuid, timestamptz, timestamptz, uuid[], text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_sit_counts_by_owner(uuid, timestamptz, timestamptz, uuid[], text[]) TO service_role;

-- Distinct opportunities (team scope) — same deal must not double-count in summary
CREATE OR REPLACE FUNCTION public.dashboard_distinct_sit_opp_count(
  p_org_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_member_ids uuid[],
  p_normalized_outcomes text[]
)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(DISTINCT o.id)::bigint
  FROM opportunities o
  WHERE o.org_id = p_org_id
    AND o.inspection_outcome IS NOT NULL
    AND o.inspection_outcome_at IS NOT NULL
    AND o.inspection_outcome_at >= p_start
    AND o.inspection_outcome_at < p_end
    AND cardinality(p_normalized_outcomes) > 0
    AND lower(trim(o.inspection_outcome::text)) = ANY(p_normalized_outcomes)
    AND (o.setter_user_id = ANY(p_member_ids) OR o.owner_user_id = ANY(p_member_ids));
$$;

CREATE OR REPLACE FUNCTION public.dashboard_distinct_sale_opp_count(
  p_org_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_member_ids uuid[]
)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(DISTINCT c.opportunity_id)::bigint
  FROM order_form_contracts c
  INNER JOIN opportunities o ON o.id = c.opportunity_id
  WHERE c.org_id = p_org_id
    AND c.agreement_type = 'installation'
    AND c.status = 'completed'
    AND c.customer_signed_at IS NOT NULL
    AND c.customer_signed_at >= p_start
    AND c.customer_signed_at < p_end
    AND c.opportunity_id IS NOT NULL
    AND (o.setter_user_id = ANY(p_member_ids) OR o.owner_user_id = ANY(p_member_ids));
$$;

CREATE OR REPLACE FUNCTION public.dashboard_install_sales_by_setter(
  p_org_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_member_ids uuid[]
)
RETURNS TABLE (setter_id uuid, cnt bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT o.setter_user_id AS setter_id, COUNT(DISTINCT c.opportunity_id)::bigint AS cnt
  FROM order_form_contracts c
  INNER JOIN opportunities o ON o.id = c.opportunity_id
  WHERE c.org_id = p_org_id
    AND c.agreement_type = 'installation'
    AND c.status = 'completed'
    AND c.customer_signed_at IS NOT NULL
    AND c.customer_signed_at >= p_start
    AND c.customer_signed_at < p_end
    AND c.opportunity_id IS NOT NULL
    AND o.setter_user_id = ANY(p_member_ids)
  GROUP BY 1;
$$;

CREATE OR REPLACE FUNCTION public.dashboard_install_sales_by_owner(
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
  SELECT o.owner_user_id AS owner_id, COUNT(DISTINCT c.opportunity_id)::bigint AS cnt
  FROM order_form_contracts c
  INNER JOIN opportunities o ON o.id = c.opportunity_id
  WHERE c.org_id = p_org_id
    AND c.agreement_type = 'installation'
    AND c.status = 'completed'
    AND c.customer_signed_at IS NOT NULL
    AND c.customer_signed_at >= p_start
    AND c.customer_signed_at < p_end
    AND c.opportunity_id IS NOT NULL
    AND o.owner_user_id = ANY(p_member_ids)
  GROUP BY 1;
$$;

CREATE OR REPLACE FUNCTION public.dashboard_count_install_sales_scoped(
  p_org_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_scope_user_ids uuid[],
  p_attribute_by_setter boolean
)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(DISTINCT c.opportunity_id)::bigint
  FROM order_form_contracts c
  INNER JOIN opportunities o ON o.id = c.opportunity_id
  WHERE c.org_id = p_org_id
    AND c.agreement_type = 'installation'
    AND c.status = 'completed'
    AND c.customer_signed_at IS NOT NULL
    AND c.customer_signed_at >= p_start
    AND c.customer_signed_at < p_end
    AND c.opportunity_id IS NOT NULL
    AND (
      cardinality(p_scope_user_ids) = 0
      OR (
        p_attribute_by_setter
        AND o.setter_user_id IS NOT NULL
        AND o.setter_user_id = ANY(p_scope_user_ids)
      )
      OR (
        NOT p_attribute_by_setter
        AND o.owner_user_id IS NOT NULL
        AND o.owner_user_id = ANY(p_scope_user_ids)
      )
    );
$$;

GRANT EXECUTE ON FUNCTION public.dashboard_distinct_sit_opp_count(uuid, timestamptz, timestamptz, uuid[], text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_distinct_sale_opp_count(uuid, timestamptz, timestamptz, uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_install_sales_by_setter(uuid, timestamptz, timestamptz, uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_install_sales_by_owner(uuid, timestamptz, timestamptz, uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_count_install_sales_scoped(uuid, timestamptz, timestamptz, uuid[], boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.dashboard_count_sits_scoped(
  p_org_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_scope_user_ids uuid[],
  p_attribute_by_setter boolean,
  p_normalized_outcomes text[]
)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::bigint
  FROM opportunities o
  WHERE o.org_id = p_org_id
    AND o.inspection_outcome IS NOT NULL
    AND o.inspection_outcome_at IS NOT NULL
    AND o.inspection_outcome_at >= p_start
    AND o.inspection_outcome_at < p_end
    AND cardinality(p_normalized_outcomes) > 0
    AND lower(trim(o.inspection_outcome::text)) = ANY(p_normalized_outcomes)
    AND (
      cardinality(p_scope_user_ids) = 0
      OR (
        p_attribute_by_setter
        AND o.setter_user_id IS NOT NULL
        AND o.setter_user_id = ANY(p_scope_user_ids)
      )
      OR (
        NOT p_attribute_by_setter
        AND o.owner_user_id IS NOT NULL
        AND o.owner_user_id = ANY(p_scope_user_ids)
      )
    );
$$;

GRANT EXECUTE ON FUNCTION public.dashboard_count_sits_scoped(uuid, timestamptz, timestamptz, uuid[], boolean, text[]) TO service_role;
