-- Weekly sales payroll foundation: periods, job state, cost lines, snapshots, chargebacks, overrides.
-- Cutoff: Wednesday 11:59:59 PM America/New_York; lock: Thursday 12:00 AM (app-enforced timestamps).

-- ── job_change_orders: commissionable flag ───────────────────────────────────
ALTER TABLE job_change_orders
  ADD COLUMN IF NOT EXISTS is_commissionable BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN job_change_orders.is_commissionable IS 'When true, CO amount counts toward commission base (weekly payroll).';

-- ── job_payments: cleared vs pending funding ─────────────────────────────────
ALTER TABLE job_payments
  ADD COLUMN IF NOT EXISTS funding_status TEXT NOT NULL DEFAULT 'cleared'
    CHECK (funding_status IN ('pending', 'cleared'));

COMMENT ON COLUMN job_payments.funding_status IS 'cleared = counts toward fully funded; pending = ACH/check not cleared yet.';

CREATE INDEX IF NOT EXISTS idx_job_payments_funding ON job_payments(job_id, funding_status);

-- ── payroll periods (per org, weekly) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS payroll_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  period_label TEXT NOT NULL,
  cutoff_at TIMESTAMPTZ NOT NULL,
  lock_at TIMESTAMPTZ NOT NULL,
  scheduled_pay_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'locked', 'paid', 'cancelled')),
  locked_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, period_label)
);

CREATE INDEX IF NOT EXISTS idx_payroll_periods_org_status ON payroll_periods(org_id, status);
CREATE INDEX IF NOT EXISTS idx_payroll_periods_cutoff ON payroll_periods(org_id, cutoff_at DESC);

COMMENT ON TABLE payroll_periods IS 'Weekly payroll windows; cutoff_at = end of eligibility for that run (Wed 11:59:59 PM ET).';

-- ── Per-job payroll workflow state (mutable until snapshot at lock) ─────────
CREATE TABLE IF NOT EXISTS job_payroll_state (
  job_id UUID PRIMARY KEY REFERENCES production_jobs(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  install_completed_at TIMESTAMPTZ,
  fully_funded_at TIMESTAMPTZ,
  costs_ready_at TIMESTAMPTZ,
  payroll_eligible_at TIMESTAMPTZ,
  payroll_cutoff_at TIMESTAMPTZ,
  scheduled_pay_date DATE,
  locked_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  current_payroll_period_id UUID REFERENCES payroll_periods(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_payroll_state_org ON job_payroll_state(org_id);
CREATE INDEX IF NOT EXISTS idx_job_payroll_state_eligible ON job_payroll_state(org_id, payroll_eligible_at);

COMMENT ON COLUMN job_payroll_state.payroll_eligible_at IS 'max(install_completed_at, fully_funded_at, costs_ready_at) when all set.';
COMMENT ON COLUMN job_payroll_state.payroll_cutoff_at IS 'Cutoff timestamp for the period this job was assigned to (or rolled).';

-- Backfill rows for existing jobs
INSERT INTO job_payroll_state (job_id, org_id, install_completed_at)
SELECT pj.id, pj.org_id, pj.completed_at
FROM production_jobs pj
LEFT JOIN job_payroll_state jps ON jps.job_id = pj.id
WHERE jps.job_id IS NULL;

UPDATE job_payroll_state jps
SET install_completed_at = pj.completed_at
FROM production_jobs pj
WHERE jps.job_id = pj.id
  AND jps.install_completed_at IS NULL
  AND pj.completed_at IS NOT NULL;

-- job_cost_lines: table created in 071; payroll columns added in 123_job_cost_lines_payroll_columns.sql

-- ── Immutable snapshot header (one per period lock) ───────────────────────────
CREATE TABLE IF NOT EXISTS payroll_period_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  payroll_period_id UUID NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,
  locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_by UUID REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (payroll_period_id)
);

-- ── Immutable per-job snapshot at lock ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS payroll_job_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  payroll_period_snapshot_id UUID NOT NULL REFERENCES payroll_period_snapshots(id) ON DELETE CASCADE,
  payroll_period_id UUID NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES production_jobs(id) ON DELETE CASCADE,
  contract_total NUMERIC(14, 2),
  signed_change_orders_total NUMERIC(14, 2),
  commissionable_change_orders_total NUMERIC(14, 2),
  dealer_fee NUMERIC(14, 2),
  deductible_costs_total NUMERIC(14, 2),
  commission_base NUMERIC(14, 2),
  chargebacks_applied NUMERIC(14, 2) NOT NULL DEFAULT 0,
  comp_plan_version JSONB,
  participants JSONB NOT NULL DEFAULT '[]',
  gross_payout_total NUMERIC(14, 2),
  net_payout_total NUMERIC(14, 2),
  pay_date DATE,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (payroll_period_id, job_id)
);

CREATE INDEX IF NOT EXISTS idx_payroll_job_snapshots_period ON payroll_job_snapshots(payroll_period_id);
CREATE INDEX IF NOT EXISTS idx_payroll_job_snapshots_job ON payroll_job_snapshots(job_id);

-- ── Payout lines per participant (for chargeback application targeting) ─────
CREATE TABLE IF NOT EXISTS payroll_payout_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  payroll_period_id UUID NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,
  payroll_job_snapshot_id UUID NOT NULL REFERENCES payroll_job_snapshots(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES production_jobs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  participant_role TEXT NOT NULL,
  gross_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  net_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  chargeback_applied_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  comp_plan_snapshot JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payroll_payout_lines_period_user ON payroll_payout_lines(payroll_period_id, user_id);

-- ── Chargebacks (balance-based; remainder carries forward) ───────────────────
CREATE TABLE IF NOT EXISTS payroll_chargebacks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id UUID REFERENCES production_jobs(id) ON DELETE SET NULL,
  original_amount NUMERIC(14, 2) NOT NULL,
  remaining_amount NUMERIC(14, 2) NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  apply_period_id UUID REFERENCES payroll_periods(id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payroll_chargebacks_user ON payroll_chargebacks(org_id, user_id, status);

-- ── Chargeback applications to payout lines ─────────────────────────────────
CREATE TABLE IF NOT EXISTS payroll_chargeback_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chargeback_id UUID NOT NULL REFERENCES payroll_chargebacks(id) ON DELETE CASCADE,
  payroll_period_id UUID NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,
  payout_line_id UUID NOT NULL REFERENCES payroll_payout_lines(id) ON DELETE CASCADE,
  applied_amount NUMERIC(14, 2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payroll_cb_app_period ON payroll_chargeback_applications(payroll_period_id);

-- ── Audited admin overrides ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payroll_override_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  override_type TEXT NOT NULL CHECK (override_type IN (
    'include_after_cutoff',
    'off_cycle_payout',
    'waive_missing_cost',
    'manual_adjustment',
    'push_chargeback_next_period',
    'override_pay_date'
  )),
  job_id UUID REFERENCES production_jobs(id) ON DELETE SET NULL,
  payroll_period_id UUID REFERENCES payroll_periods(id) ON DELETE SET NULL,
  actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  before_value JSONB,
  after_value JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payroll_override_audit_org ON payroll_override_audit(org_id, created_at DESC);

-- ── RLS (org-scoped read; writes via service role / privileged policies) ─────
ALTER TABLE payroll_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_payroll_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_cost_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_period_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_job_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_payout_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_chargebacks ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_chargeback_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_override_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payroll_periods_org_select" ON payroll_periods
  FOR SELECT USING (org_id = get_user_org_id(auth.uid()));

CREATE POLICY "job_payroll_state_org_select" ON job_payroll_state
  FOR SELECT USING (org_id = get_user_org_id(auth.uid()));

-- job_cost_lines: SELECT policy already exists in 071 ("Users can view job cost lines in their org")

CREATE POLICY "payroll_period_snapshots_org_select" ON payroll_period_snapshots
  FOR SELECT USING (org_id = get_user_org_id(auth.uid()));

CREATE POLICY "payroll_job_snapshots_org_select" ON payroll_job_snapshots
  FOR SELECT USING (org_id = get_user_org_id(auth.uid()));

CREATE POLICY "payroll_payout_lines_org_select" ON payroll_payout_lines
  FOR SELECT USING (org_id = get_user_org_id(auth.uid()));

CREATE POLICY "payroll_chargebacks_org_select" ON payroll_chargebacks
  FOR SELECT USING (org_id = get_user_org_id(auth.uid()));

CREATE POLICY "payroll_chargeback_applications_select" ON payroll_chargeback_applications
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM payroll_chargebacks pc
      WHERE pc.id = payroll_chargeback_applications.chargeback_id
        AND pc.org_id = get_user_org_id(auth.uid())
    )
  );

CREATE POLICY "payroll_override_audit_org_select" ON payroll_override_audit
  FOR SELECT USING (org_id = get_user_org_id(auth.uid()));
