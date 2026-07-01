-- Materials order list follow-ups: column backfill, job overrides table, org coverage constants.

-- Task 2: backfill drip_edge_lf / step_flashing_lf from raw_data (idempotent).
UPDATE roof_measurements
SET drip_edge_lf = (raw_data->>'drip_edge_lf')::numeric
WHERE drip_edge_lf IS NULL
  AND raw_data->>'drip_edge_lf' IS NOT NULL
  AND (raw_data->>'drip_edge_lf') ~ '^[0-9]+(\.[0-9]+)?$'
  AND (raw_data->>'drip_edge_lf')::numeric > 0;

UPDATE roof_measurements
SET step_flashing_lf = (raw_data->>'step_flashing_lf')::numeric
WHERE step_flashing_lf IS NULL
  AND raw_data->>'step_flashing_lf' IS NOT NULL
  AND (raw_data->>'step_flashing_lf') ~ '^[0-9]+(\.[0-9]+)?$'
  AND (raw_data->>'step_flashing_lf')::numeric > 0;

-- Task 5: org-configurable coverage constants (NULL = lib defaults).
ALTER TABLE orgs
  ADD COLUMN IF NOT EXISTS starter_lf_per_bundle NUMERIC,
  ADD COLUMN IF NOT EXISTS cap_lf_per_bundle NUMERIC,
  ADD COLUMN IF NOT EXISTS underlayment_sq_per_roll NUMERIC,
  ADD COLUMN IF NOT EXISTS ridge_vent_lf_per_piece NUMERIC,
  ADD COLUMN IF NOT EXISTS ridge_vent_end_setback_ft NUMERIC,
  ADD COLUMN IF NOT EXISTS ice_water_lf_per_roll NUMERIC;

-- Task 3: per-job materials order overrides.
CREATE TABLE IF NOT EXISTS job_material_order_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES production_jobs(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,
  qty_text TEXT,
  excluded BOOLEAN NOT NULL DEFAULT false,
  note TEXT,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (job_id, item_key)
);

CREATE INDEX IF NOT EXISTS idx_job_material_order_overrides_org_id ON job_material_order_overrides(org_id);
CREATE INDEX IF NOT EXISTS idx_job_material_order_overrides_job_id ON job_material_order_overrides(job_id);

ALTER TABLE job_material_order_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view job material order overrides in their org" ON job_material_order_overrides;
CREATE POLICY "Users can view job material order overrides in their org"
  ON job_material_order_overrides FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Users can insert job material order overrides in their org" ON job_material_order_overrides;
CREATE POLICY "Users can insert job material order overrides in their org"
  ON job_material_order_overrides FOR INSERT
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Users can update job material order overrides in their org" ON job_material_order_overrides;
CREATE POLICY "Users can update job material order overrides in their org"
  ON job_material_order_overrides FOR UPDATE
  USING (org_id = get_user_org_id(auth.uid()))
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

DROP TRIGGER IF EXISTS trigger_job_material_order_overrides_updated_at ON job_material_order_overrides;
CREATE TRIGGER trigger_job_material_order_overrides_updated_at
  BEFORE UPDATE ON job_material_order_overrides
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE job_material_order_overrides IS 'Ops overrides for computed materials order list rows (qty, exclude, note).';
