-- Backfill opportunities (and canvass lead marker) for historically signed Repair Agreements
-- that never received status = 'won' when an existing project row skipped that update in /api/contracts/sign.

-- 1) Close opportunities as won; carry customer_id from linked projects when the opp still lacks it.
UPDATE opportunities o
SET
  status = 'won',
  customer_id = COALESCE(
    o.customer_id,
    (
      SELECT p.customer_id
      FROM projects p
      WHERE p.opportunity_id = o.id
        AND p.customer_id IS NOT NULL
      LIMIT 1
    ),
    (
      SELECT p2.customer_id
      FROM projects p2
      WHERE p2.org_id = o.org_id
        AND o.lead_id IS NOT NULL
        AND p2.lead_id = o.lead_id
        AND p2.customer_id IS NOT NULL
      LIMIT 1
    )
  )
WHERE o.status IN ('open', 'in_progress')
  AND EXISTS (
    SELECT 1
    FROM order_form_contracts c
    WHERE c.opportunity_id = o.id
      AND c.org_id = o.org_id
      AND c.agreement_type = 'repair'
      AND c.status = 'completed'
      AND c.customer_signed_at IS NOT NULL
  );

-- 2) Canvass sold ($) pin: set when still null so past repair signings match installation sign behaviour.
UPDATE leads l
SET installation_agreement_signed_at = x.signed_at
FROM (
  SELECT
    o.lead_id,
    MIN(c.customer_signed_at) AS signed_at
  FROM order_form_contracts c
  INNER JOIN opportunities o ON o.id = c.opportunity_id
  WHERE c.agreement_type = 'repair'
    AND c.status = 'completed'
    AND c.customer_signed_at IS NOT NULL
    AND o.lead_id IS NOT NULL
  GROUP BY o.lead_id
) x
WHERE l.id = x.lead_id
  AND l.installation_agreement_signed_at IS NULL;
