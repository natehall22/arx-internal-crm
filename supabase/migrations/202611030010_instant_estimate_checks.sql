-- Instant Estimate accuracy loop (2026-11-03).
--
-- Every real job is a test case: for each property where ARX later has TRUSTED squares (a carrier report, a manual
-- entry, or a human-reviewed in-house measurement), the nightly cron (app/api/cron/instant-estimate-accuracy) runs the
-- public Instant Estimate for that address in shadow mode and stores what it said next to the truth. One row per
-- (opportunity, estimate_version), so every new estimator version is re-scored against the same properties.
--
-- Additive only: one table, two views. Service-role access only (same pattern as rpt_* / saved_reports): RLS enabled
-- with no policies, and anon/authenticated revoked. People read it through /reports/explore (lib/reporting/run.ts
-- always adds the org filter; the dataset has no owner column, so only company-wide/finance viewers see it).
--
-- est_base_squares is the base (no-waste) squares the estimate RETURNED, i.e. with calibration_factor already applied.
-- The calibration view divides it back out so calibration is always learned from the raw measure (no feedback loop).
-- Docs: docs/measure-tool/instant-estimate-accuracy.md

CREATE TABLE IF NOT EXISTS instant_estimate_checks (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                    uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  address                   text,
  lat                       double precision,
  lng                       double precision,
  opportunity_id            uuid REFERENCES opportunities(id) ON DELETE SET NULL,
  production_job_id         uuid REFERENCES production_jobs(id) ON DELETE SET NULL,
  lead_id                   uuid REFERENCES leads(id) ON DELETE SET NULL,
  estimate_version          text NOT NULL,
  measure_source            text,            -- lidar | solar_mask | solar_mask_whole | solar_reconciled | solar_segments | none | error:<reason>
  confidence                text,            -- high | standard | low
  flags                     text[],
  est_base_squares          numeric,         -- as returned (calibration applied), no waste
  est_waste_percent         numeric,
  est_squares_with_waste    numeric,
  calibration_factor        numeric,         -- factor the estimate applied (1 = none)
  truth_source              text,            -- carrier_report | manual | in_house_manual | lidar_reviewed | in_house_reviewed
  truth_base_squares        numeric,         -- roof_measurements.total_squares (sloped area / 100, no waste)
  truth_squares_with_waste  numeric,         -- sold squares (lib/job-sold-scope.ts), waste included
  ordered_squares           numeric,         -- ops-entered field-shingle order quantity, when present
  notes                     text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_instant_estimate_checks_opp_version
  ON instant_estimate_checks (org_id, opportunity_id, estimate_version) WHERE opportunity_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_instant_estimate_checks_job_version
  ON instant_estimate_checks (org_id, production_job_id, estimate_version) WHERE production_job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_instant_estimate_checks_org_created
  ON instant_estimate_checks (org_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_instant_estimate_checks_updated_at ON instant_estimate_checks;
CREATE TRIGGER trg_instant_estimate_checks_updated_at
  BEFORE UPDATE ON instant_estimate_checks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE instant_estimate_checks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON instant_estimate_checks FROM anon, authenticated;
COMMENT ON TABLE instant_estimate_checks IS
  'Instant Estimate (shadow run) vs trusted squares per property and estimate_version. Service-role only; written by the instant-estimate-accuracy cron.';

-- Calibration: per org + measure_source, the median truth/raw-estimate ratio over the last 365 days.
-- Only trusted truth sources count — in_house_reviewed (a Solar-seeded outline a rep only reviewed) is recorded but
-- excluded, because it shares the estimate's own error. lib/instant-estimate-calibration.ts applies a factor only
-- when n >= 8 and clamps it to [0.85, 1.15].
CREATE OR REPLACE VIEW instant_estimate_calibration WITH (security_invoker = true) AS
WITH latest AS (
  -- one row per property: the newest check for each opportunity/job (re-checks under a new version don't double count)
  SELECT DISTINCT ON (c.org_id, COALESCE(c.opportunity_id, c.production_job_id, c.id))
         c.org_id,
         c.measure_source,
         c.truth_base_squares,
         c.est_base_squares / NULLIF(COALESCE(NULLIF(c.calibration_factor, 0), 1), 0) AS raw_est_base_squares
  FROM instant_estimate_checks c
  WHERE c.created_at >= now() - interval '365 days'
    AND c.truth_source IN ('carrier_report', 'manual', 'in_house_manual', 'lidar_reviewed')
    -- An unedited lidar measurement can't grade a lidar estimate: same data, same error.
    AND NOT (c.truth_source = 'lidar_reviewed' AND c.measure_source = 'lidar')
    AND c.truth_base_squares > 0
    AND c.est_base_squares > 0
    AND c.measure_source IS NOT NULL
    AND c.measure_source NOT LIKE 'error:%'
  ORDER BY c.org_id, COALESCE(c.opportunity_id, c.production_job_id, c.id), c.created_at DESC
)
SELECT org_id,
       measure_source,
       count(*)::int                                                                                  AS n,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY truth_base_squares / raw_est_base_squares)          AS median_ratio,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY abs(raw_est_base_squares - truth_base_squares) / truth_base_squares) * 100
                                                                                                      AS median_abs_pct_error
FROM latest
WHERE raw_est_base_squares > 0
GROUP BY org_id, measure_source;

-- Report dataset (lib/reporting/catalog.ts 'instant_estimate_accuracy'). Error is what the CUSTOMER saw:
-- the returned (calibrated) base squares vs trusted base squares. Positive = estimate read high.
CREATE OR REPLACE VIEW rpt_instant_estimate_accuracy WITH (security_invoker = true) AS
SELECT c.org_id,
       c.id                                   AS check_id,
       c.address,
       c.created_at                           AS checked_at,
       c.estimate_version,
       c.measure_source,
       c.confidence,
       array_to_string(c.flags, ', ')         AS flags,
       c.truth_source,
       c.est_base_squares,
       c.truth_base_squares,
       c.est_squares_with_waste,
       c.truth_squares_with_waste,
       c.ordered_squares,
       c.calibration_factor,
       CASE WHEN c.truth_base_squares > 0 AND c.est_base_squares > 0
            THEN round(((c.est_base_squares - c.truth_base_squares) / c.truth_base_squares * 100)::numeric, 1) END
                                              AS error_pct,
       CASE WHEN c.truth_base_squares > 0 AND c.est_base_squares > 0
            THEN round((abs(c.est_base_squares - c.truth_base_squares) / c.truth_base_squares * 100)::numeric, 1) END
                                              AS abs_error_pct,
       CASE WHEN c.truth_squares_with_waste > 0 AND c.est_squares_with_waste > 0
            THEN round(((c.est_squares_with_waste - c.truth_squares_with_waste) / c.truth_squares_with_waste * 100)::numeric, 1) END
                                              AS sold_error_pct,
       c.opportunity_id,
       c.production_job_id
FROM instant_estimate_checks c;

-- Views are read through the API only (service role).
REVOKE ALL ON instant_estimate_calibration, rpt_instant_estimate_accuracy FROM anon, authenticated;

-- Rollback:
--   DROP VIEW IF EXISTS rpt_instant_estimate_accuracy, instant_estimate_calibration;
--   DROP TABLE IF EXISTS instant_estimate_checks;
