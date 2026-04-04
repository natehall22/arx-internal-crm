-- Payroll commission base: pre-tax subtotal minus dealer fee; pool cap = 18% of base (app-enforced).

ALTER TABLE production_jobs
  ADD COLUMN IF NOT EXISTS commission_pre_tax_subtotal NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS commission_comp_base NUMERIC(12, 2);

COMMENT ON COLUMN production_jobs.commission_pre_tax_subtotal IS 'Proposal subtotal (pre-sales-tax) at contract; snapshot for payroll.';
COMMENT ON COLUMN production_jobs.commission_comp_base IS 'Pre-tax subtotal minus dealer_fee_amount; total rep commissions + incentives capped at 18% of this.';

ALTER TABLE commissions
  ADD COLUMN IF NOT EXISTS production_job_id UUID REFERENCES production_jobs(id) ON DELETE SET NULL;

COMMENT ON COLUMN commissions.production_job_id IS 'Production job this commission row applies to (earnings or chargeback).';

CREATE INDEX IF NOT EXISTS idx_commissions_production_job ON commissions(production_job_id)
  WHERE production_job_id IS NOT NULL;
