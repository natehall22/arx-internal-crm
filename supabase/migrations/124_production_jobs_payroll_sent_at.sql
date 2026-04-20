-- Ops: mark when a job has been sent to internal payroll (completed jobs list + job detail).
ALTER TABLE production_jobs
  ADD COLUMN IF NOT EXISTS payroll_sent_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN production_jobs.payroll_sent_at IS 'When set, job was marked sent to payroll from the ops board or job detail.';
