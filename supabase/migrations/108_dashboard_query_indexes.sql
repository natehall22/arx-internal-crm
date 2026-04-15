-- Speed up dashboard RPCs: filter pattern is almost always org_id + time range (+ optional user id).

CREATE INDEX IF NOT EXISTS idx_opportunities_org_inspection_outcome_at
  ON opportunities (org_id, inspection_outcome_at)
  WHERE inspection_outcome_at IS NOT NULL AND inspection_outcome IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_order_form_contracts_org_signed_install
  ON order_form_contracts (org_id, customer_signed_at)
  WHERE status = 'completed'
    AND agreement_type = 'installation'
    AND customer_signed_at IS NOT NULL;
