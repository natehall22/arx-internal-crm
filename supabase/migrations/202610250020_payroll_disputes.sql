-- "Something's wrong?" on a rep's pay line. Lands in the admin's Needs you on Pay this week; answering it (or adding a fix)
-- closes it. Additive; written and read only by the app (service role).
CREATE TABLE IF NOT EXISTS payroll_disputes (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payroll_period_id  UUID REFERENCES payroll_periods(id) ON DELETE SET NULL,
  job_id             UUID REFERENCES production_jobs(id) ON DELETE SET NULL,
  line_label         TEXT NOT NULL,                       -- what the rep tapped, e.g. "26-0129 · 19 Imaginary Elm Ave"
  message            TEXT NOT NULL CHECK (char_length(btrim(message)) > 0),
  status             TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered', 'fixed', 'rejected')),
  reply              TEXT,
  adjustment_id      UUID REFERENCES payroll_adjustments(id) ON DELETE SET NULL,
  resolved_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  resolved_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payroll_disputes_open ON payroll_disputes(org_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payroll_disputes_user ON payroll_disputes(org_id, user_id, created_at DESC);
ALTER TABLE payroll_disputes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON payroll_disputes FROM anon, authenticated;
-- Rollback: DROP TABLE payroll_disputes;  (run after 202610250010; it references payroll_adjustments)
