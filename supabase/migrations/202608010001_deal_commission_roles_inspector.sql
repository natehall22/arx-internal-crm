-- Adds 'inspector' to deal_commission_roles so the rep who ran the inspection can
-- be paid a per-job cut on a job someone else closed (the 1.5% inspection line in
-- the published comp ladder).
--
-- Widening a CHECK is additive — existing rows stay valid and no column changes.
--
-- Note on the wider change this belongs to: until now NOTHING read
-- deal_commission_roles into payroll. `loadAdditiveDealCommissionParticipants()`
-- existed but was never called, so manager/custom rows produced no payout lines.
-- The materialization change shipping alongside this migration makes that path
-- real for every role in the list below, not only 'inspector'.

ALTER TABLE deal_commission_roles
  DROP CONSTRAINT IF EXISTS deal_commission_roles_role_check;

ALTER TABLE deal_commission_roles
  ADD CONSTRAINT deal_commission_roles_role_check
  CHECK (role IN ('setter', 'closer', 'inspector', 'field_manager', 'senior_manager', 'custom'));

COMMENT ON COLUMN deal_commission_roles.override_percent IS
  'Percent of the job commission base paid to this participant. Counts INSIDE the '
  'sales commission pool cap — these lines scale down with everyone else when a job '
  'exceeds the cap. Takes effect only when override_amount is null (flat dollars win). '
  'Used for the inspection line and percentage-based manager overrides.';

SELECT pg_notify('pgrst', 'reload schema');
