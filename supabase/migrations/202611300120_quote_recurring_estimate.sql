-- Recurring quote lines: the first-season estimate is its OWN number, never part of contract / job / deposit money.
-- Additive / nullable only. Apply BEFORE the code (the code falls back where it can).
--
-- 1. quote_approvals.recurring_estimate_cents: first-season estimate of the approved recurring lines (also in the snapshot).
--    A PLAN-ONLY quote (no one-time lines) makes no contract, job or deposit; its total_cents (which must stay > 0 under the
--    existing check) holds this estimate as a placeholder and `snapshot.planOnly` says so (approvalOneTimeCents reads 0).
-- 2. quote_approvals.pdf_path: where the approval PDF is stored when there is no contract to hang it on (plan-only).
--    quote_approvals.sale_notified_at marks that email so any finalize run can send it once.
-- 3. quote_links.portal_token_enc: the customer portal's reusable "open quote" link (sealed token; row has sent_to = 'portal').
-- 4. service_plans.sold_by_user_id / quote_approval_id: who sold the plan (the deal's closer) and the approval it came from,
--    so a later comp rule can attribute PAID plan invoices to the selling salesperson. Nothing pays on them yet.
-- 5. New view rpt_recurring_sales (see below). rpt_sales itself is NOT changed.
-- Rollback: remove the view and the added columns by hand.

BEGIN;

ALTER TABLE public.quote_approvals
  ADD COLUMN IF NOT EXISTS recurring_estimate_cents integer NULL CHECK (recurring_estimate_cents IS NULL OR recurring_estimate_cents >= 0),
  ADD COLUMN IF NOT EXISTS pdf_path text NULL,
  ADD COLUMN IF NOT EXISTS sale_notified_at timestamptz NULL; -- plan-only sale: the owner sale email went out for this approval (sent once)

ALTER TABLE public.quote_links
  ADD COLUMN IF NOT EXISTS portal_token_enc text NULL;

ALTER TABLE public.service_plans
  ADD COLUMN IF NOT EXISTS sold_by_user_id uuid NULL,
  ADD COLUMN IF NOT EXISTS quote_approval_id uuid NULL;

-- A SEPARATE view, not a union into rpt_sales: every existing sales reader (Signed sales totals, the Sales templates, the
-- dashboard / goals / Sisu counts through lib/reporting/period-metrics) keeps reading signed contracts only, so a recurring
-- estimate can never inflate them. Recurring sales are their own dataset, "Recurring sales (est.)".
-- A row = one approval with a recurring estimate that finished finalizing and still has at least one service plan from it that
-- has not ended (status active or paused). A plan ended early, or an approval that never finished, drops out on its own.
CREATE OR REPLACE VIEW public.rpt_recurring_sales WITH (security_invoker = true) AS
SELECT a.org_id,
       a.id                       AS approval_id,
       'recurring_estimate'::text AS sale_kind,
       'Recurring, est. first season'::text AS agreement_type,
       a.approved_at              AS signed_at,
       p.customer_address         AS address,
       (a.recurring_estimate_cents / 100.0)::numeric AS amount,
       a.opportunity_id,
       o.owner_user_id            AS closer_user_id,
       cl.full_name               AS closer,
       o.setter_user_id           AS setter_user_id,
       st.full_name               AS setter,
       o.job_source,
       COALESCE(o.is_self_generated, false) AS is_self_generated
FROM public.quote_approvals a
JOIN public.proposals p ON p.id = a.proposal_id
LEFT JOIN public.opportunities o ON o.id = a.opportunity_id
LEFT JOIN public.users cl ON cl.id = o.owner_user_id
LEFT JOIN public.users st ON st.id = o.setter_user_id
WHERE COALESCE(a.recurring_estimate_cents, 0) > 0
  AND a.finalized_at IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.service_plans sp WHERE sp.quote_approval_id = a.id AND sp.org_id = a.org_id AND sp.status <> 'ended');

REVOKE ALL ON public.rpt_recurring_sales FROM anon, authenticated;
COMMENT ON VIEW public.rpt_recurring_sales IS 'Approved recurring service sales (first-season estimate), one per quote approval with a live plan. Not part of rpt_sales / signed sales.';

COMMIT;
