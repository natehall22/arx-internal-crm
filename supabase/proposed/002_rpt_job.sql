-- PROPOSED, NOT APPLIED. Depends on 001_job_cost_summary.sql.
-- One row per production_jobs row, with costs from job_cost_summary (which mirrors lib/job-costs.ts).
-- production_jobs has no deleted_at and no opportunity_id column in any migration, so neither is used.
-- security_invoker: RLS of the querying user applies to production_jobs, job_payments, cost tables.

CREATE OR REPLACE VIEW public.rpt_job
WITH (security_invoker = true) AS
SELECT
  pj.id AS job_id,
  pj.org_id,
  pj.job_number,
  pj.project_id,
  pj.job_type,
  pj.job_source,
  pj.status,
  pj.sale_date,
  pj.completed_at,
  pj.salesperson_id,
  pj.assigned_sub_id,
  pj.sale_amount,
  cs.materials,
  cs.labor,
  cs.permit,
  cs.misc,
  cs.finance,
  cs.direct,
  cs.total,
  cs.pending_extras,
  cs.pending_lines,
  cs.sources,
  cs.has_legacy_only,
  coalesce(pay.collected_to_date, 0) AS collected_to_date,
  coalesce(pj.sale_amount, 0) - coalesce(pay.collected_to_date, 0) AS balance_due,
  coalesce(pj.sale_amount, 0) - cs.total AS gross_profit_before_comp,
  -- Negation of jobHasCostData (lib/goals-job-economics.ts), plus legacy product orders count as cost data
  -- (matches lib/reporting/job-ledger.ts missingCostData).
  NOT (
    cs.has_legacy_only
    OR pj.material_cost IS NOT NULL
    OR pj.labor_cost IS NOT NULL
    OR EXISTS (
      SELECT 1 FROM job_cost_lines c
      WHERE c.job_id = pj.id AND c.status = 'active' AND c.deleted_at IS NULL AND coalesce(c.amount, 0) > 0
    )
  ) AS missing_costs
FROM production_jobs pj
CROSS JOIN LATERAL public.job_cost_summary(pj.id) cs
LEFT JOIN LATERAL (
  -- job_payments stores integer cents, append-only, refunds are negative rows; no status/deleted column exists.
  SELECT round(sum(p.amount_cents)::numeric / 100, 2) AS collected_to_date
  FROM job_payments p
  WHERE p.job_id = pj.id
) pay ON true;

COMMENT ON VIEW public.rpt_job IS
  'PROPOSED per-job reporting row. Costs mirror lib/job-costs.ts. Commissions and overhead are NOT included yet: they live in TS (lib/goals-job-economics.ts, lib/reporting/), so gross_profit_before_comp is sale_amount - total cost only, not net profit. collected_to_date sums all job_payments (all payment types, refunds negative) in dollars.';

-- Cost and profit are finance data. Supabase grants new objects to anon/authenticated by default and the
-- underlying tables' RLS is org-member wide, so lock these down; expose through a server route that checks
-- finance/ops access instead.
REVOKE ALL ON public.rpt_job FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.rpt_job TO service_role;
