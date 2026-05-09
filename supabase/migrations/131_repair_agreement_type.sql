-- Add limited-scope "repair" agreement type (distinct from full Installation Agreement).

ALTER TABLE order_form_contracts
  DROP CONSTRAINT IF EXISTS order_form_contracts_agreement_type_check;

ALTER TABLE order_form_contracts
  ADD CONSTRAINT order_form_contracts_agreement_type_check
  CHECK (agreement_type IN ('installation', 'contingency', 'repair'));

COMMENT ON COLUMN order_form_contracts.agreement_type IS
  'installation = full install agreement; contingency = insurance claim authorization; repair = limited-scope repair/work authorization';
