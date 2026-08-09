-- Forward-sorting copy of 202607290001_payroll_payout_line_idempotency.sql.
-- The original file predates the current production migration head and was skipped
-- because of migration-history drift. This unique index is the database-level guard
-- against concurrent or retried materialization creating the same participant payout
-- more than once for a job and payroll period. It creates no payout rows.
CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_payout_lines_period_job_user_role
  ON payroll_payout_lines(payroll_period_id, job_id, user_id, participant_role);
