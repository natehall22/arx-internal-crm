DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'program_444_qualified'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'badge_criteria_type')
  ) THEN
    ALTER TYPE badge_criteria_type ADD VALUE 'program_444_qualified';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS program_444_enrollments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  enrolled_by UUID REFERENCES users(id) ON DELETE SET NULL,
  -- Start date is the rep's first day. Week 1 begins the following Sunday.
  -- If they start on a Sunday, Week 1 begins that same day.
  start_date DATE NOT NULL,
  -- Computed week windows (set at enrollment time, never change)
  week1_starts_at TIMESTAMPTZ NOT NULL,  -- following Sunday 00:00:00 ET
  week1_ends_at   TIMESTAMPTZ NOT NULL,  -- 6 days later, 23:59:59 ET
  week2_starts_at TIMESTAMPTZ NOT NULL,
  week2_ends_at   TIMESTAMPTZ NOT NULL,
  -- Week 1 progress (synced periodically)
  week1_doors        INTEGER NOT NULL DEFAULT 0,
  week1_inspections  INTEGER NOT NULL DEFAULT 0,
  week1_qualified    BOOLEAN NOT NULL DEFAULT false,
  week1_paid_at      TIMESTAMPTZ,
  week1_payroll_period_id UUID REFERENCES payroll_periods(id) ON DELETE SET NULL,
  -- Week 2 progress
  week2_doors        INTEGER NOT NULL DEFAULT 0,
  week2_inspections  INTEGER NOT NULL DEFAULT 0,
  week2_qualified    BOOLEAN NOT NULL DEFAULT false,
  week2_paid_at      TIMESTAMPTZ,
  week2_payroll_period_id UUID REFERENCES payroll_periods(id) ON DELETE SET NULL,
  -- Status
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, user_id, start_date)
);

CREATE INDEX IF NOT EXISTS idx_444_enrollments_org ON program_444_enrollments(org_id, status);
CREATE INDEX IF NOT EXISTS idx_444_enrollments_user ON program_444_enrollments(user_id, status);
CREATE INDEX IF NOT EXISTS idx_444_enrollments_weeks ON program_444_enrollments(week1_starts_at, week2_ends_at);

ALTER TABLE program_444_enrollments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "program_444_enrollments_org_select" ON program_444_enrollments
  FOR SELECT USING (org_id = get_user_org_id(auth.uid()));

CREATE POLICY "program_444_enrollments_admin_insert" ON program_444_enrollments
  FOR INSERT WITH CHECK (org_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

CREATE POLICY "program_444_enrollments_admin_update" ON program_444_enrollments
  FOR UPDATE USING (org_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

CREATE POLICY "program_444_enrollments_admin_delete" ON program_444_enrollments
  FOR DELETE USING (org_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

DROP TRIGGER IF EXISTS update_program_444_enrollments_updated_at ON program_444_enrollments;
CREATE TRIGGER update_program_444_enrollments_updated_at
  BEFORE UPDATE ON program_444_enrollments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS payroll_bonus_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  payroll_period_id UUID NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bonus_type TEXT NOT NULL CHECK (bonus_type IN ('444_week1', '444_week2', 'manual')),
  amount NUMERIC(14, 2) NOT NULL CHECK (amount >= 0),
  description TEXT,
  source_id UUID,  -- references program_444_enrollments.id (soft ref, no FK to keep it flexible)
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- For 444 bonuses: one per week per enrollment per period
  UNIQUE (payroll_period_id, user_id, bonus_type, source_id),
  -- For manual bonuses (source_id IS NULL): one per period/user/type
  -- Enforced via partial unique index below (PostgreSQL UNIQUE ignores NULLs)
);

CREATE INDEX IF NOT EXISTS idx_payroll_bonus_lines_period ON payroll_bonus_lines(payroll_period_id, user_id);
CREATE INDEX IF NOT EXISTS idx_payroll_bonus_lines_org ON payroll_bonus_lines(org_id, user_id);
-- Prevent duplicate manual bonuses where source_id IS NULL
CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_bonus_lines_manual_unique
  ON payroll_bonus_lines(payroll_period_id, user_id, bonus_type)
  WHERE source_id IS NULL;

ALTER TABLE payroll_bonus_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payroll_bonus_lines_select" ON payroll_bonus_lines
  FOR SELECT USING (
    org_id = get_user_org_id(auth.uid())
    AND (user_id = auth.uid() OR is_admin_or_manager(auth.uid()))
  );

CREATE POLICY "payroll_bonus_lines_admin_insert" ON payroll_bonus_lines
  FOR INSERT WITH CHECK (org_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

CREATE POLICY "payroll_bonus_lines_admin_update" ON payroll_bonus_lines
  FOR UPDATE USING (org_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

CREATE POLICY "payroll_bonus_lines_admin_delete" ON payroll_bonus_lines
  FOR DELETE USING (org_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

SELECT pg_notify('pgrst', 'reload schema');
