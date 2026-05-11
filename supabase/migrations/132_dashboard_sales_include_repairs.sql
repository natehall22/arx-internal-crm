-- Count completed repair agreements as sales in dashboard reporting.

CREATE INDEX IF NOT EXISTS idx_order_form_contracts_org_signed_sale_agreements
  ON order_form_contracts (org_id, customer_signed_at)
  WHERE status = 'completed'
    AND agreement_type IN ('installation', 'repair')
    AND customer_signed_at IS NOT NULL;

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
    AND c.agreement_type IN ('installation', 'repair')
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
    AND c.agreement_type IN ('installation', 'repair')
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
    AND c.agreement_type IN ('installation', 'repair')
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
    AND c.agreement_type IN ('installation', 'repair')
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

GRANT EXECUTE ON FUNCTION public.dashboard_distinct_sale_opp_count(uuid, timestamptz, timestamptz, uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_install_sales_by_setter(uuid, timestamptz, timestamptz, uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_install_sales_by_owner(uuid, timestamptz, timestamptz, uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_count_install_sales_scoped(uuid, timestamptz, timestamptz, uuid[], boolean) TO service_role;
