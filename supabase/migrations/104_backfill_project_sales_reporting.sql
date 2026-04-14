-- Align sales reporting with existing project-backed sales.
-- Older manual signed-contract uploads created/won projects without setting inspection_outcome='sale'.

UPDATE projects p
SET opportunity_id = o.id
FROM opportunities o
WHERE p.opportunity_id IS NULL
  AND p.lead_id IS NOT NULL
  AND o.lead_id = p.lead_id
  AND o.org_id = p.org_id;

UPDATE opportunities o
SET inspection_outcome = 'sale',
    inspection_outcome_at = COALESCE(
      o.inspection_outcome_at,
      (
        SELECT c.customer_signed_at
        FROM order_form_contracts c
        WHERE c.opportunity_id = o.id
          AND c.status = 'completed'
          AND COALESCE(c.agreement_type, 'installation') = 'installation'
        ORDER BY c.customer_signed_at DESC NULLS LAST, c.created_at DESC
        LIMIT 1
      ),
      (
        SELECT p2.contract_uploaded_at
        FROM projects p2
        WHERE p2.opportunity_id = o.id
        ORDER BY p2.contract_uploaded_at DESC NULLS LAST, p2.created_at DESC
        LIMIT 1
      ),
      (
        SELECT p3.created_at
        FROM projects p3
        WHERE p3.opportunity_id = o.id
        ORDER BY p3.created_at DESC
        LIMIT 1
      ),
      o.updated_at,
      o.created_at
    ),
    status = 'won'
WHERE EXISTS (
    SELECT 1
    FROM projects p
    WHERE p.opportunity_id = o.id
  )
  AND o.inspection_outcome IS DISTINCT FROM 'sale'
  AND NOT EXISTS (
    SELECT 1
    FROM order_form_contracts c
    WHERE c.opportunity_id = o.id
      AND c.status = 'completed'
      AND COALESCE(c.agreement_type, 'installation') = 'contingency'
      AND NOT EXISTS (
        SELECT 1
        FROM order_form_contracts c2
        WHERE c2.opportunity_id = o.id
          AND c2.status = 'completed'
          AND COALESCE(c2.agreement_type, 'installation') = 'installation'
      )
  );

UPDATE opportunities o
SET inspection_outcome = 'sale',
    inspection_outcome_at = COALESCE(o.inspection_outcome_at, o.updated_at, o.created_at),
    status = 'won'
WHERE o.status = 'won'
  AND o.inspection_outcome IS DISTINCT FROM 'sale'
  AND EXISTS (
    SELECT 1
    FROM projects p
    WHERE p.opportunity_id = o.id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM order_form_contracts c
    WHERE c.opportunity_id = o.id
      AND c.status = 'completed'
      AND COALESCE(c.agreement_type, 'installation') = 'contingency'
      AND NOT EXISTS (
        SELECT 1
        FROM order_form_contracts c2
        WHERE c2.opportunity_id = o.id
          AND c2.status = 'completed'
          AND COALESCE(c2.agreement_type, 'installation') = 'installation'
      )
  );
