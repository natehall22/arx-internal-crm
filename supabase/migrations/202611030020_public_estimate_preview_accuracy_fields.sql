-- Instant Estimate accuracy upgrade (2026-11): keep what the estimate was based on, so the
-- price is locked at preview time and every estimate can be checked against the real job.
-- Additive + nullable only. Code writes these columns but falls back to the old column set
-- if this migration hasn't been applied yet (lib/public-estimate-preview-store.ts).

ALTER TABLE public_estimate_previews
  ADD COLUMN IF NOT EXISTS base_squares NUMERIC,
  ADD COLUMN IF NOT EXISTS confidence TEXT CHECK (confidence IN ('high', 'standard', 'low')),
  ADD COLUMN IF NOT EXISTS price_per_square NUMERIC,
  ADD COLUMN IF NOT EXISTS flags TEXT[],
  ADD COLUMN IF NOT EXISTS other_structures JSONB,
  ADD COLUMN IF NOT EXISTS imagery_date DATE,
  ADD COLUMN IF NOT EXISTS lidar_collected_end DATE,
  ADD COLUMN IF NOT EXISTS calibration_factor NUMERIC,
  ADD COLUMN IF NOT EXISTS estimate_version TEXT;
