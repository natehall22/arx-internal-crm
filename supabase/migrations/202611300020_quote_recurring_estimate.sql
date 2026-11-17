-- Recurring quote lines: the first-season estimate is its OWN number, never part of contract / job / deposit money.
-- Additive / nullable only. Apply BEFORE the code (the code falls back where it can).
--
-- 1. quote_approvals.recurring_estimate_cents: first-season estimate of the approved recurring lines (also in the snapshot).
--    A PLAN-ONLY quote (no one-time lines) makes no contract, job or deposit; its total_cents (which must stay > 0 under the
--    existing check) holds this estimate as a placeholder and `snapshot.planOnly` says so (approvalOneTimeCents reads 0).
-- 2. quote_approvals.pdf_path: where the approval PDF is stored when there is no contract to hang it on (plan-only).
-- 3. quote_links.portal_token_enc: the customer portal's reusable "open quote" link (sealed token; row has sent_to = 'portal').
-- 4. service_plans.sold_by_user_id / quote_approval_id: who sold the plan (the deal's closer) and the approval it came from,
--    so a later comp rule can attribute PAID plan invoices to the selling salesperson. Nothing pays on them yet.
-- 5. rpt_sales gains one union row per approval with a recurring estimate, labelled 'Recurring, est. first season'
--    (contract_id = the approval id). Same columns as before; contract rows are unchanged.
-- Rollback: restore the view from 202610220010 and remove the added columns by hand.

BEGIN;

ALTER TABLE public.quote_approvals
  ADD COLUMN IF NOT EXISTS recurring_estimate_cents integer NULL CHECK (recurring_estimate_cents IS NULL OR recurring_estimate_cents >= 0),
  ADD COLUMN IF NOT EXISTS pdf_path text NULL;

ALTER TABLE public.quote_links
  ADD COLUMN IF NOT EXISTS portal_token_enc text NULL;

ALTER TABLE public.service_plans
  ADD COLUMN IF NOT EXISTS sold_by_user_id uuid NULL,
  ADD COLUMN IF NOT EXISTS quote_approval_id uuid NULL;

CREATE OR REPLACE VIEW rpt_sales WITH (security_invoker = true) AS
SELECT c.org_id,
       c.id                       AS contract_id,
       c.agreement_type,
       c.customer_signed_at       AS signed_at,
       c.project_address          AS address,
       COALESCE(c.project_cost, 0) AS amount,
       c.payment_method,
       c.opportunity_id,
       o.owner_user_id            AS closer_user_id,
       cl.full_name               AS closer,
       o.setter_user_id           AS setter_user_id,
       st.full_name               AS setter,
       o.job_source,
       COALESCE(o.is_self_generated, false) AS is_self_generated
FROM order_form_contracts c
LEFT JOIN opportunities o ON o.id = c.opportunity_id
LEFT JOIN users cl ON cl.id = o.owner_user_id
LEFT JOIN users st ON st.id = o.setter_user_id
WHERE c.status = 'completed' AND c.agreement_type IN ('installation', 'repair') AND c.customer_signed_at IS NOT NULL
UNION ALL
SELECT a.org_id,
       a.id                       AS contract_id,
       'Recurring, est. first season'::text AS agreement_type,
       a.approved_at              AS signed_at,
       p.customer_address         AS address,
       (a.recurring_estimate_cents / 100.0)::numeric AS amount,
       NULL::text                 AS payment_method,
       a.opportunity_id,
       o.owner_user_id            AS closer_user_id,
       cl.full_name               AS closer,
       o.setter_user_id           AS setter_user_id,
       st.full_name               AS setter,
       o.job_source,
       COALESCE(o.is_self_generated, false) AS is_self_generated
FROM quote_approvals a
JOIN proposals p ON p.id = a.proposal_id
LEFT JOIN opportunities o ON o.id = a.opportunity_id
LEFT JOIN users cl ON cl.id = o.owner_user_id
LEFT JOIN users st ON st.id = o.setter_user_id
WHERE COALESCE(a.recurring_estimate_cents, 0) > 0;

COMMIT;
