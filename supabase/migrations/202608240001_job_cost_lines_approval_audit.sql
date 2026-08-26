-- job_cost_lines.approved / deduct_from_commission_base already exist (123_job_cost_lines_payroll_columns.sql),
-- but nothing in the product has ever set approved:false or recorded who reviewed a line — every cost
-- line has been born pre-approved and payroll-deductible with zero review step. This adds the audit
-- columns a review action needs; the POST route change (separate commit) starts inserting approved:false.

ALTER TABLE job_cost_lines
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

COMMENT ON COLUMN job_cost_lines.approved_by IS 'Payroll admin (admin/owner/operations) who last approved this line for commission deduction. Null while pending review.';
COMMENT ON COLUMN job_cost_lines.approved_at IS 'When the line was last approved. Null while pending review.';
