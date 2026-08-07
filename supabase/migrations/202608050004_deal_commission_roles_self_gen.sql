-- Adds 'self_gen' to deal_commission_roles so the self-generated commission line
-- (6% in the published comp ladder, paid to a closer who sourced the deal themselves)
-- can be recorded per job — either derived from opportunities.is_self_generated or
-- entered by hand by a payroll admin.
--
-- Widening a CHECK is additive: existing rows stay valid and no column changes.
--
-- Precedence, same as the inspection line: an explicit row with role='self_gen' on a
-- job always wins over the derived one, including a deliberate $0.

ALTER TABLE deal_commission_roles
  DROP CONSTRAINT IF EXISTS deal_commission_roles_role_check;

ALTER TABLE deal_commission_roles
  ADD CONSTRAINT deal_commission_roles_role_check
  CHECK (role IN ('setter', 'closer', 'inspector', 'field_manager', 'senior_manager', 'self_gen', 'custom'));

SELECT pg_notify('pgrst', 'reload schema');
