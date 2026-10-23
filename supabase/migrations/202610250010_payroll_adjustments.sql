-- Payroll adjustments: a mistake in a PAID week is never edited — it becomes a signed line on a LATER (open) week.
-- Also carries a negative check forward as a balance. One row = one line on one period's check. Additive; written and read
-- only by the app (service role).
CREATE TABLE IF NOT EXISTS payroll_adjustments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  payroll_period_id   UUID NOT NULL REFERENCES payroll_periods(id) ON DELETE RESTRICT,  -- the week this line is paid in
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  job_id              UUID REFERENCES production_jobs(id) ON DELETE SET NULL,
  amount              NUMERIC(14, 2) NOT NULL CHECK (amount <> 0),                      -- signed: + pays, − takes back
  reason              TEXT NOT NULL CHECK (char_length(btrim(reason)) > 0),
  kind                TEXT NOT NULL DEFAULT 'fix' CHECK (kind IN ('fix', 'balance', 'chargeback', 'resplit', 'topup')),
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'void')),
  source_period_id    UUID REFERENCES payroll_periods(id) ON DELETE SET NULL,           -- the paid week the mistake was in
  created_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  applied_at          TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_payroll_adjustments_period ON payroll_adjustments(payroll_period_id, user_id) WHERE status <> 'void';
CREATE INDEX IF NOT EXISTS idx_payroll_adjustments_user ON payroll_adjustments(org_id, user_id, created_at DESC);
-- A negative check is carried forward at most once per person per source week (a retried approve can't carry it twice).
CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_adjustments_one_balance ON payroll_adjustments(source_period_id, user_id) WHERE kind = 'balance' AND status <> 'void';
ALTER TABLE payroll_adjustments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON payroll_adjustments FROM anon, authenticated;
COMMENT ON TABLE payroll_adjustments IS 'Signed lines added to a payroll period (fixes after a paid week, carried-forward negative balances). Counted in the period total while status <> void.';
-- Rollback: DROP TABLE payroll_adjustments;
