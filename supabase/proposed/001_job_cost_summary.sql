-- PROPOSED, NOT APPLIED. Lives outside supabase/migrations on purpose so nothing auto-applies.
--
-- public.job_cost_summary(p_job_id) mirrors `summarizeJobCosts` + `netProductOrdersTotal` +
-- the `loadJobCostInputs` filters in lib/job-costs.ts. That file is the source of truth:
-- any change to either side MUST be made to both in the same PR, and the shared parity
-- fixtures in supabase/proposed/test/job-cost-fixtures.json (run via test/run_parity.sh)
-- must still pass. Add a fixture for every new rule.
--
-- Precedence (see lib/job-costs.ts header):
--   materials: production_jobs.material_cost -> net product orders -> 'material' cost lines
--   labor:     production_jobs.labor_cost    -> 'labor' + 'subcontractor' cost lines
--   permit:    'permit' lines;  misc: everything not material/labor/subcontractor/permit and not a fee line
--   finance:   dealer_fee_amount (> 0)       -> lender/dealer-fee line (only reported if > 0)
--
-- Notes: SECURITY INVOKER, so RLS on the underlying tables applies to the caller.
-- Amount NULL counts as 0; approved NULL counts as NOT approved (TS: !l.approved).

CREATE OR REPLACE FUNCTION public.job_cost_summary(p_job_id uuid)
RETURNS TABLE(
  materials numeric,
  labor numeric,
  permit numeric,
  misc numeric,
  finance numeric,
  direct numeric,
  total numeric,
  pending_extras numeric,
  pending_lines int,
  sources text[],
  has_legacy_only boolean
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH j AS (
    SELECT pj.material_cost AS mat_col, pj.labor_cost AS lab_col, pj.dealer_fee_amount AS fee_col
    FROM production_jobs pj
    WHERE pj.id = p_job_id
  ),
  -- Same filters as loadJobCostInputs. t = TS String(cost_type || ''); fee = isLenderFeeCostLine.
  l AS (
    SELECT
      coalesce(c.amount, 0) AS amt,
      coalesce(c.cost_type, '') AS t,
      (c.approved IS TRUE) AS is_approved,
      (coalesce(c.cost_type, '') NOT IN ('material', 'labor', 'subcontractor', 'permit')
        AND coalesce(c.description, '') ~* '(lender|lending|dealer fee)') AS is_fee
    FROM job_cost_lines c
    WHERE c.job_id = p_job_id AND c.status = 'active' AND c.deleted_at IS NULL
  ),
  ls AS (
    SELECT
      coalesce(sum(amt) FILTER (WHERE t = 'material'), 0) AS material_lines,
      coalesce(sum(amt) FILTER (WHERE t IN ('labor', 'subcontractor')), 0) AS labor_lines,
      coalesce(sum(amt) FILTER (WHERE t = 'permit'), 0) AS permit_sum,
      coalesce(sum(amt) FILTER (WHERE t NOT IN ('material', 'labor', 'subcontractor', 'permit') AND NOT is_fee), 0) AS misc_sum,
      coalesce(sum(amt) FILTER (WHERE is_fee), 0) AS fee_lines,
      coalesce(sum(amt) FILTER (WHERE NOT is_approved
        AND (t = 'permit' OR (t NOT IN ('material', 'labor', 'subcontractor', 'permit') AND NOT is_fee))), 0) AS pending_sum,
      count(*) FILTER (WHERE NOT is_approved) AS pending_n
    FROM l
  ),
  -- NULL (not 0) when the job has no orders at all.
  o AS (
    SELECT CASE WHEN count(*) = 0 THEN NULL
                ELSE round(sum(CASE WHEN po.status = 'returned' THEN -abs(coalesce(po.amount, 0))
                                    ELSE coalesce(po.amount, 0) END), 2)
           END AS orders_total
    FROM job_product_orders po
    WHERE po.job_id = p_job_id
  ),
  m AS (
    SELECT
      CASE WHEN j.mat_col IS NOT NULL THEN j.mat_col
           WHEN o.orders_total IS NOT NULL THEN o.orders_total
           ELSE ls.material_lines END AS mat,
      CASE WHEN j.mat_col IS NOT NULL THEN 'materials:column'
           WHEN o.orders_total IS NOT NULL THEN 'materials:product_orders'
           ELSE 'materials:cost_lines' END AS mat_src,
      (j.mat_col IS NULL AND o.orders_total IS NOT NULL) AS legacy_only,
      CASE WHEN j.lab_col IS NOT NULL THEN j.lab_col ELSE ls.labor_lines END AS lab,
      CASE WHEN j.lab_col IS NOT NULL THEN 'labor:column' ELSE 'labor:cost_lines' END AS lab_src,
      ls.permit_sum AS perm,
      ls.misc_sum AS msc,
      CASE WHEN coalesce(j.fee_col, 0) > 0 THEN j.fee_col ELSE ls.fee_lines END AS fin,
      CASE WHEN coalesce(j.fee_col, 0) > 0 THEN 'finance:column'
           WHEN ls.fee_lines > 0 THEN 'finance:cost_line' END AS fin_src,
      ls.pending_sum,
      ls.pending_n
    FROM (SELECT 1) one
    LEFT JOIN j ON true
    CROSS JOIN ls
    CROSS JOIN o
  )
  SELECT
    round(m.mat, 2),
    round(m.lab, 2),
    round(m.perm, 2),
    round(m.msc, 2),
    round(m.fin, 2),
    round(m.mat + m.lab + m.perm + m.msc, 2),
    round(m.mat + m.lab + m.perm + m.msc + m.fin, 2),
    round(m.pending_sum, 2),
    m.pending_n::int,
    CASE WHEN m.fin_src IS NULL THEN ARRAY[m.mat_src, m.lab_src]
         ELSE ARRAY[m.mat_src, m.lab_src, m.fin_src] END,
    m.legacy_only
  FROM m;
$$;

COMMENT ON FUNCTION public.job_cost_summary(uuid) IS
  'PROPOSED. Mirrors summarizeJobCosts in lib/job-costs.ts; change both in lockstep and re-run supabase/proposed/test/run_parity.sh.';

REVOKE ALL ON FUNCTION public.job_cost_summary(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.job_cost_summary(uuid) TO service_role;
