-- "Unsettle": an owner brings a job that was settled outside the CRM back into CRM payroll (reason required, audited).
-- Widens the override_type CHECK on payroll_override_audit (existing values unchanged).
ALTER TABLE payroll_override_audit DROP CONSTRAINT IF EXISTS payroll_override_audit_override_type_check;
ALTER TABLE payroll_override_audit ADD CONSTRAINT payroll_override_audit_override_type_check CHECK (override_type = ANY (ARRAY[
  'include_after_cutoff', 'off_cycle_payout', 'waive_missing_cost', 'manual_adjustment', 'push_chargeback_next_period',
  'override_pay_date', 'force_paid_in_full', 'sale_credit_change', 'settle_externally', 'unsettle_externally'
]::text[]));
-- Rollback: re-create the constraint without the two new values (delete those audit rows first).
