-- NTP / hold fields, payout line hourly totals, comp plan hourly override, pricebook role rates.

ALTER TABLE production_jobs
  ADD COLUMN IF NOT EXISTS ntp_date DATE,
  ADD COLUMN IF NOT EXISTS ntp_commission_percent NUMERIC(5, 2),
  ADD COLUMN IF NOT EXISTS commission_hold_status TEXT CHECK (
    commission_hold_status IN ('held_till_install', 'released')
  );

COMMENT ON COLUMN production_jobs.ntp_date IS 'Notice-to-proceed date for partial commission release.';
COMMENT ON COLUMN production_jobs.ntp_commission_percent IS 'Percent of deal commission released at NTP (remainder at install).';
COMMENT ON COLUMN production_jobs.commission_hold_status IS 'held_till_install until install completes; released when paid out.';

ALTER TABLE job_payroll_state
  ADD COLUMN IF NOT EXISTS ntp_completed_at TIMESTAMPTZ;

COMMENT ON COLUMN job_payroll_state.ntp_completed_at IS 'When NTP was recorded for payroll eligibility (NTP tranche).';

ALTER TABLE payroll_payout_lines
  ADD COLUMN IF NOT EXISTS hourly_earnings NUMERIC(14, 2) NOT NULL DEFAULT 0;

ALTER TABLE payroll_payout_lines
  ADD COLUMN IF NOT EXISTS total_earnings NUMERIC(14, 2)
    GENERATED ALWAYS AS (COALESCE(hourly_earnings, 0) + net_amount) STORED;

COMMENT ON COLUMN payroll_payout_lines.hourly_earnings IS 'Hourly pay for this period (not subject to 18% pool cap).';
COMMENT ON COLUMN payroll_payout_lines.total_earnings IS 'hourly_earnings + net_amount; COALESCE on hourly so historical rows stay non-null.';

ALTER TABLE user_comp_plans
  ADD COLUMN IF NOT EXISTS hourly_rate_override NUMERIC(10, 2);

COMMENT ON COLUMN user_comp_plans.hourly_rate_override IS 'Per-user hourly rate override; takes precedence over comp_plans.hourly_rate.';

ALTER TABLE pricebook_items
  ADD COLUMN IF NOT EXISTS role_commission_rates JSONB;

COMMENT ON COLUMN pricebook_items.role_commission_rates IS 'Per-role commission multipliers, e.g. {"setter":0.5,"closer":1.0,"field_manager":0.25,"senior_manager":0.1}.';

-- Document orgs.settings keys (no schema change):
-- payroll_schedule: { cadence: weekly|semi_monthly, semi_monthly_day: 15, tz: America/New_York }
-- commission_release: { model: ntp_install, ntp_release_pct: 50, install_release_pct: 50 }
COMMENT ON COLUMN orgs.settings IS 'Org JSON settings. Payroll: payroll_schedule, commission_release (NTP/install release model).';
