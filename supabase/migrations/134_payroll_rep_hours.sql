-- Manual hourly earnings per rep per payroll period (setters, canvassers, call center on hybrid plans).

CREATE TABLE IF NOT EXISTS payroll_rep_hours (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  payroll_period_id UUID NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  regular_hours NUMERIC(7, 2) NOT NULL DEFAULT 0 CHECK (regular_hours >= 0),
  overtime_hours NUMERIC(7, 2) NOT NULL DEFAULT 0 CHECK (overtime_hours >= 0),
  hourly_rate_snapshot NUMERIC(10, 2),
  hourly_earnings NUMERIC(14, 2),
  notes TEXT,
  locked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (payroll_period_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_payroll_rep_hours_period ON payroll_rep_hours(payroll_period_id);
CREATE INDEX IF NOT EXISTS idx_payroll_rep_hours_user ON payroll_rep_hours(org_id, user_id);

COMMENT ON TABLE payroll_rep_hours IS 'Admin-entered regular/OT hours and computed hourly pay per rep per payroll period.';

CREATE TABLE IF NOT EXISTS payroll_rep_hours_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  rep_hours_id UUID NOT NULL REFERENCES payroll_rep_hours(id) ON DELETE CASCADE,
  payroll_period_id UUID NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  field_changed TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payroll_rep_hours_audit_rep ON payroll_rep_hours_audit(rep_hours_id, created_at DESC);

CREATE TRIGGER update_payroll_rep_hours_updated_at
  BEFORE UPDATE ON payroll_rep_hours
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE payroll_rep_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_rep_hours_audit ENABLE ROW LEVEL SECURITY;

-- Org-scoped read; writes via service role / admin APIs.
CREATE POLICY "payroll_rep_hours_org_select" ON payroll_rep_hours
  FOR SELECT USING (org_id = get_user_org_id(auth.uid()));

CREATE POLICY "payroll_rep_hours_audit_org_select" ON payroll_rep_hours_audit
  FOR SELECT USING (org_id = get_user_org_id(auth.uid()));
