-- One job cost ledger (Known Redundancy #11). Additive and idempotent.
-- Adds ONE new nullable column: job_cost_lines.source (enum). Everything else is a schema record.
--
-- `job_cost_lines.source_product_order_id` (+ its FK and partial unique index) already exist in
-- prod: they were added out-of-band, with no migration file and no row in
-- supabase_migrations.schema_migrations (checked 2026-10-21), when 22 of the 23
-- `job_product_orders` rows were mirrored into `job_cost_lines`. This file makes the repo match
-- prod so a fresh database / branch has the column the data fix and the app rely on.
-- On prod every statement is a no-op.

ALTER TABLE job_cost_lines
  ADD COLUMN IF NOT EXISTS source_product_order_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'job_cost_lines_source_product_order_id_fkey'
      AND conrelid = 'public.job_cost_lines'::regclass
  ) THEN
    ALTER TABLE job_cost_lines
      ADD CONSTRAINT job_cost_lines_source_product_order_id_fkey
      FOREIGN KEY (source_product_order_id) REFERENCES job_product_orders(id) ON DELETE SET NULL;
  END IF;
END $$;

-- One ledger line per legacy order, so a mirror can never be inserted twice.
CREATE UNIQUE INDEX IF NOT EXISTS uq_job_cost_lines_source_product_order
  ON job_cost_lines (source_product_order_id)
  WHERE source_product_order_id IS NOT NULL;

COMMENT ON COLUMN job_cost_lines.source_product_order_id IS
  'Legacy job_product_orders row this line was mirrored from (one-time migration). Null for lines entered in the ledger directly.';

-- Where each ledger line came from, as a reportable enum (not a free-text note).
-- Nullable: NULL = entered before 2026-10-21 and not classified by the data fix.
DO $$ BEGIN
  CREATE TYPE job_cost_line_source AS ENUM (
    'manual',               -- typed in by a person (Materials "+ Job Cost" or Photos & files)
    'product_order_mirror', -- copied from a legacy job_product_orders row (see source_product_order_id)
    'legacy_column_import', -- moved from production_jobs.material_cost / labor_cost (2026-07-08 tracker import)
    'dealer_fee_sync'       -- mirrored from production_jobs.dealer_fee_amount by signing / financial source
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE job_cost_lines
  ADD COLUMN IF NOT EXISTS source job_cost_line_source;

COMMENT ON COLUMN job_cost_lines.source IS
  'Where the line came from: manual | product_order_mirror | legacy_column_import | dealer_fee_sync. NULL = pre-2026-10-21, unclassified.';

CREATE INDEX IF NOT EXISTS idx_job_cost_lines_source ON job_cost_lines (org_id, source);

COMMENT ON TABLE job_product_orders IS
  'LEGACY — read-only history since 2026-10-21. Every row is mirrored into job_cost_lines (source_product_order_id); the app no longer reads or writes this table. Kept, not dropped (additive-only schema rule).';

COMMENT ON COLUMN production_jobs.material_cost IS
  'LEGACY — not read or written by the app since 2026-10-21. Values were moved into job_cost_lines by supabase/data-fixes/2026-10-21_one_cost_ledger.sql where the job had no material lines.';

COMMENT ON COLUMN production_jobs.labor_cost IS
  'LEGACY — not read or written by the app since 2026-10-21. Labor is a job_cost_lines row (cost_type labor). Values were moved by supabase/data-fixes/2026-10-21_one_cost_ledger.sql where the job had no labor lines.';
