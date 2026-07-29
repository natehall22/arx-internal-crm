-- Prevent retrying payroll materialization from duplicating a participant's
-- payout for the same job and period.
CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_payout_lines_period_job_user_role
  ON payroll_payout_lines(payroll_period_id, job_id, user_id, participant_role);
