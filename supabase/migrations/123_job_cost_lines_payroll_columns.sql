-- job_cost_lines already exists (071_project_files_mvp_foundation.sql).
-- Migration 121 used CREATE TABLE IF NOT EXISTS, which skipped — these columns were never added.

ALTER TABLE job_cost_lines
  ADD COLUMN IF NOT EXISTS approved BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS deduct_from_commission_base BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN job_cost_lines.approved IS 'When false, job may be blocked from payroll until approved (weekly worksheet). Legacy rows default true.';
COMMENT ON COLUMN job_cost_lines.deduct_from_commission_base IS 'When true, counted in deductible costs for commission base.';
