-- Widen the employee_comp_agreements.agreement_key CHECK to admit the two
-- manager rungs of the published comp ladder (Setter Manager, Sales Manager).
-- Additive only: every previously accepted key remains valid, so existing rows
-- and in-flight agreements are unaffected.
DO $$
DECLARE v_name TEXT;
BEGIN
  SELECT conname INTO v_name
  FROM pg_constraint
  WHERE conrelid = 'employee_comp_agreements'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%agreement_key%';
  IF v_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE employee_comp_agreements DROP CONSTRAINT %I', v_name);
  END IF;
END $$;

ALTER TABLE employee_comp_agreements
  ADD CONSTRAINT employee_comp_agreements_agreement_key_check
  CHECK (agreement_key IN ('field_marketer', 'senior_field_marketer', 'closer', 'setter_manager', 'sales_manager'));
