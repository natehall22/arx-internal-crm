-- Log of pay statement emails sent to reps (admin bulk send / resend).

CREATE TABLE IF NOT EXISTS payroll_statement_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  payroll_period_id UUID NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
  error_message TEXT,
  statement_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payroll_statement_deliveries_period_user
  ON payroll_statement_deliveries(payroll_period_id, user_id, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_payroll_statement_deliveries_org
  ON payroll_statement_deliveries(org_id, sent_at DESC);

COMMENT ON TABLE payroll_statement_deliveries IS 'Audit log for commission/pay statement emails; resends append new rows.';

ALTER TABLE payroll_statement_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payroll_statement_deliveries_org_select" ON payroll_statement_deliveries
  FOR SELECT USING (org_id = get_user_org_id(auth.uid()));
