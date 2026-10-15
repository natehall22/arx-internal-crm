-- Known Redundancy #11, Phase 3. Additive only: one nullable column + one log table.
-- job_product_orders rows are NOT deleted or altered; they become legacy and are mirrored onto
-- job_cost_lines by scripts/migrate-orders-to-cost-lines.ts, which links each mirror back here so
-- a re-run can never mirror the same order twice.

ALTER TABLE job_cost_lines
  ADD COLUMN IF NOT EXISTS source_product_order_id UUID REFERENCES job_product_orders(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_job_cost_lines_source_product_order
  ON job_cost_lines(source_product_order_id)
  WHERE source_product_order_id IS NOT NULL;

COMMENT ON COLUMN job_cost_lines.source_product_order_id IS
  'The legacy job_product_orders row this line was mirrored from. Null for lines entered directly.';

CREATE TABLE IF NOT EXISTS job_cost_order_migration_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES production_jobs(id) ON DELETE CASCADE,
  product_order_id UUID NOT NULL UNIQUE,
  cost_line_id UUID REFERENCES job_cost_lines(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN ('inserted', 'linked_existing')),
  amount NUMERIC(12, 2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Service-role only: RLS on with no policies.
ALTER TABLE job_cost_order_migration_log ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE job_cost_order_migration_log IS 'Audit trail of job_product_orders mirrored onto job_cost_lines (Redundancy #11 Phase 3).';
