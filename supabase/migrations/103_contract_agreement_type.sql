-- Separate insurance contingency agreements from final installation agreements.

ALTER TABLE order_form_contracts
  ADD COLUMN IF NOT EXISTS agreement_type TEXT NOT NULL DEFAULT 'installation'
  CHECK (agreement_type IN ('installation', 'contingency'));

CREATE INDEX IF NOT EXISTS idx_order_form_contracts_agreement_type
  ON order_form_contracts(org_id, opportunity_id, agreement_type, status);

COMMENT ON COLUMN order_form_contracts.agreement_type IS 'installation = final install agreement; contingency = insurance claim contingency authorization';
