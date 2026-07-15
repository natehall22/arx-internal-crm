-- Setter ramp program: replaces the 444 program's role as the new-FM activity
-- gate, but wired as the eligibility check for the $500-or-3%-whichever-greater
-- weekly comp plan instead of a standalone spiff. See DECISIONS.md.
--
-- Ramp thresholds (tenure weeks are Sunday-aligned relative to enrollment
-- start_date, same windowing convention as compute444WeekWindows):
--   Week 1:    200 doors knocked
--   Week 2:    400 doors knocked AND 4 appointments set
--   Week 3+:   trailing rolling-average appointments/week >= threshold
--              (window size and threshold are org-configurable — see
--              orgs.setter_ramp_avg_window_weeks below; confirm the intended
--              averaging window before relying on week 3+ gating in prod)
--
-- 444 stays live and untouched by this migration; disable it operationally
-- (stop enrolling, optionally cancel active enrollments) per DECISIONS.md,
-- do not repurpose its tables.

-- ── Org-level configuration ──────────────────────────────────────────────────
ALTER TABLE orgs
  ADD COLUMN IF NOT EXISTS setter_ramp_weekly_floor_amount NUMERIC(10,2) NOT NULL DEFAULT 500,
  ADD COLUMN IF NOT EXISTS setter_ramp_commission_rate NUMERIC(5,2) NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS setter_ramp_week3_avg_target NUMERIC(6,2) NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS setter_ramp_avg_window_weeks INT NOT NULL DEFAULT 4;

COMMENT ON COLUMN orgs.setter_ramp_avg_window_weeks IS
  'Trailing rolling-average window (in weeks) used to evaluate the week 3+ '
  '"N appointments/week on average" gate. Confirm with ops before trusting '
  'week 3+ results — this was set to a reasonable default (4), not a confirmed '
  'business rule.';

-- ── Enrollment (one active row per rep, mirrors program_444_enrollments) ─────
CREATE TABLE IF NOT EXISTS setter_ramp_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  enrolled_by UUID REFERENCES users(id) ON DELETE SET NULL,
  start_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, user_id, start_date)
);

CREATE INDEX IF NOT EXISTS idx_setter_ramp_enrollments_org ON setter_ramp_enrollments(org_id, status);
CREATE INDEX IF NOT EXISTS idx_setter_ramp_enrollments_user ON setter_ramp_enrollments(user_id, status);

-- Enforce one ACTIVE enrollment per user (mirrors 444's app-level check, backed
-- here at the DB level too since this table also gates real payroll).
CREATE UNIQUE INDEX IF NOT EXISTS idx_setter_ramp_enrollments_one_active
  ON setter_ramp_enrollments(org_id, user_id)
  WHERE status = 'active';

ALTER TABLE setter_ramp_enrollments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "setter_ramp_enrollments_org_select" ON setter_ramp_enrollments
  FOR SELECT USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

CREATE POLICY "setter_ramp_enrollments_admin_insert" ON setter_ramp_enrollments
  FOR INSERT WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

CREATE POLICY "setter_ramp_enrollments_admin_update" ON setter_ramp_enrollments
  FOR UPDATE USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

CREATE POLICY "setter_ramp_enrollments_admin_delete" ON setter_ramp_enrollments
  FOR DELETE USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

-- Reuses update_updated_at_column(), the existing generic trigger function
-- (see 202506090001_444_program.sql) — not redefined here.
DROP TRIGGER IF EXISTS update_setter_ramp_enrollments_updated_at ON setter_ramp_enrollments;
CREATE TRIGGER update_setter_ramp_enrollments_updated_at
  BEFORE UPDATE ON setter_ramp_enrollments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── Weekly ledger (one row per enrollment per tenure week, open-ended) ───────
-- Unlike 444 (fixed 2-week program with dedicated columns), the ramp continues
-- indefinitely from week 3 onward, so weeks are rows, not columns.
CREATE TABLE IF NOT EXISTS setter_ramp_weekly_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  enrollment_id UUID NOT NULL REFERENCES setter_ramp_enrollments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_number INT NOT NULL CHECK (week_number >= 1),
  week_starts_at TIMESTAMPTZ NOT NULL,
  week_ends_at TIMESTAMPTZ NOT NULL, -- exclusive boundary, same convention as 444
  doors_knocked INT NOT NULL DEFAULT 0,
  appointments_set INT NOT NULL DEFAULT 0,
  -- Only populated for week_number >= 3: trailing average across
  -- orgs.setter_ramp_avg_window_weeks weeks (including this one).
  rolling_avg_appointments NUMERIC(6,2),
  gate_passed BOOLEAN NOT NULL DEFAULT false,
  gate_passed_at TIMESTAMPTZ,
  -- Snapshot of the floor-vs-commission comparison once the setter's period
  -- commission is known (post payroll-period-lock). Null until evaluated.
  commission_total NUMERIC(12,2),
  floor_amount NUMERIC(10,2),
  payout_source TEXT CHECK (payout_source IN ('floor', 'commission')),
  payroll_period_id UUID REFERENCES payroll_periods(id) ON DELETE SET NULL,
  bonus_registered BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (enrollment_id, week_number)
);

CREATE INDEX IF NOT EXISTS idx_setter_ramp_weekly_status_org ON setter_ramp_weekly_status(org_id, user_id);
CREATE INDEX IF NOT EXISTS idx_setter_ramp_weekly_status_enrollment ON setter_ramp_weekly_status(enrollment_id, week_number);
CREATE INDEX IF NOT EXISTS idx_setter_ramp_weekly_status_period ON setter_ramp_weekly_status(payroll_period_id);

ALTER TABLE setter_ramp_weekly_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "setter_ramp_weekly_status_org_select" ON setter_ramp_weekly_status
  FOR SELECT USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

CREATE POLICY "setter_ramp_weekly_status_admin_insert" ON setter_ramp_weekly_status
  FOR INSERT WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

CREATE POLICY "setter_ramp_weekly_status_admin_update" ON setter_ramp_weekly_status
  FOR UPDATE USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP TRIGGER IF EXISTS update_setter_ramp_weekly_status_updated_at ON setter_ramp_weekly_status;
CREATE TRIGGER update_setter_ramp_weekly_status_updated_at
  BEFORE UPDATE ON setter_ramp_weekly_status
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── payroll_bonus_lines: register the new bonus type ─────────────────────────
-- bonus_type was hard-constrained to 444's two week types + 'manual'. Widen it
-- so the floor top-up can be written through the exact same approval pipeline
-- (payroll_bonus_lines -> pending_approval -> Bonus Approval UI -> lock guard)
-- that 444 already uses, with no new admin UI needed for approval.
ALTER TABLE payroll_bonus_lines DROP CONSTRAINT IF EXISTS payroll_bonus_lines_bonus_type_check;
ALTER TABLE payroll_bonus_lines ADD CONSTRAINT payroll_bonus_lines_bonus_type_check
  CHECK (bonus_type IN ('444_week1', '444_week2', 'setter_weekly_floor', 'manual'));

COMMENT ON COLUMN payroll_bonus_lines.source_id IS
  'Soft ref (no FK, kept flexible): program_444_enrollments.id for 444 bonuses, '
  'setter_ramp_weekly_status.id for setter_weekly_floor top-ups.';
