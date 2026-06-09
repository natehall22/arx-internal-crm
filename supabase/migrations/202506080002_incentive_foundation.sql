-- Incentive / SPIFF module — Phase 1 data foundation.
-- Fully additive: no existing tables, columns, or RLS policies are modified.
-- All metrics are read from existing RPCs (dashboard_*, scheduled_appointments, order_form_contracts).

-- ============================================================
-- ENUMS
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'spiff_trigger_metric') THEN
    CREATE TYPE spiff_trigger_metric AS ENUM (
      'inspections_set',    -- scheduled_appointments created by canvasser_user_id
      'inspections_sat',    -- scheduled_appointments with status = 'completed'
      'closed_sales',       -- order_form_contracts signed (installation type)
      'closed_revenue',     -- sum of project_cost on signed contracts
      'doors_knocked',      -- leads with door-knock source created by user
      'close_rate',         -- percentage: closed_sales / inspections_sat
      'upgrade_attached'    -- contracts with non-roof scope attached
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'spiff_reward_type') THEN
    CREATE TYPE spiff_reward_type AS ENUM (
      'cash',         -- paid via payroll queue
      'gift_card',    -- noted for manual fulfillment
      'recognition'   -- public callout only, no cash
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'spiff_status') THEN
    CREATE TYPE spiff_status AS ENUM (
      'draft',
      'active',
      'completed',
      'cancelled'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'incentive_cycle_cadence') THEN
    CREATE TYPE incentive_cycle_cadence AS ENUM (
      'weekly',
      'monthly'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'badge_criteria_type') THEN
    CREATE TYPE badge_criteria_type AS ENUM (
      'first_inspection_set',
      'first_closed_sale',
      'inspections_set_milestone',   -- e.g. 10, 25, 50, 100 cumulative
      'closed_sales_milestone',
      'streak_weekly_inspections',   -- N consecutive weeks hitting goal
      'streak_weekly_sales',
      'close_rate_threshold',        -- e.g. 30%+ in a month
      'spiff_winner',                -- won any spiff
      'top_leaderboard'              -- #1 for a cycle
    );
  END IF;
END $$;

-- ============================================================
-- INCENTIVE CYCLES
-- Weekly or monthly periods; mirrors payroll_periods concept
-- but is independent so payroll and incentives can diverge.
-- ============================================================

CREATE TABLE IF NOT EXISTS incentive_cycles (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  cadence         incentive_cycle_cadence NOT NULL,
  label           TEXT NOT NULL,                      -- e.g. "Week of 2026-06-08" or "June 2026"
  starts_at       TIMESTAMPTZ NOT NULL,
  ends_at         TIMESTAMPTZ NOT NULL,
  locked_at       TIMESTAMPTZ,                        -- set when admin locks for payout
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, cadence, label)
);

CREATE INDEX IF NOT EXISTS idx_incentive_cycles_org_starts ON incentive_cycles(org_id, starts_at DESC);

ALTER TABLE incentive_cycles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "incentive_cycles_org_select" ON incentive_cycles
  FOR SELECT USING (org_id = get_user_org_id(auth.uid()));

CREATE POLICY "incentive_cycles_admin_insert" ON incentive_cycles
  FOR INSERT WITH CHECK (org_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

CREATE POLICY "incentive_cycles_admin_update" ON incentive_cycles
  FOR UPDATE USING (org_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

CREATE POLICY "incentive_cycles_admin_delete" ON incentive_cycles
  FOR DELETE USING (org_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

DROP TRIGGER IF EXISTS update_incentive_cycles_updated_at ON incentive_cycles;
CREATE TRIGGER update_incentive_cycles_updated_at
  BEFORE UPDATE ON incentive_cycles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- SPIFF PROGRAMS
-- Admin-defined, time-boxed incentive programs.
-- ============================================================

CREATE TABLE IF NOT EXISTS spiff_programs (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id              UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  created_by          UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  name                TEXT NOT NULL,
  description         TEXT,
  trigger_metric      spiff_trigger_metric NOT NULL,
  -- Threshold: numeric target (count or dollar amount depending on trigger_metric)
  threshold           NUMERIC(14, 2) NOT NULL,
  reward_type         spiff_reward_type NOT NULL DEFAULT 'cash',
  reward_amount       NUMERIC(10, 2),                 -- null for recognition-only
  reward_note         TEXT,                           -- e.g. "Amazon gift card — see manager"
  -- Eligibility
  eligible_roles      TEXT[] NOT NULL DEFAULT '{}',   -- empty = all roles
  -- Visibility
  is_public           BOOLEAN NOT NULL DEFAULT true,  -- show on leaderboard
  -- Timing
  starts_at           TIMESTAMPTZ NOT NULL,
  ends_at             TIMESTAMPTZ NOT NULL,
  status              spiff_status NOT NULL DEFAULT 'draft',
  -- Payout tracking
  payroll_cycle_id    UUID REFERENCES incentive_cycles(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_spiff_programs_org_status ON spiff_programs(org_id, status);
CREATE INDEX IF NOT EXISTS idx_spiff_programs_org_dates ON spiff_programs(org_id, starts_at, ends_at);

ALTER TABLE spiff_programs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "spiff_programs_org_select" ON spiff_programs
  FOR SELECT USING (org_id = get_user_org_id(auth.uid()));

CREATE POLICY "spiff_programs_admin_insert" ON spiff_programs
  FOR INSERT WITH CHECK (org_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

CREATE POLICY "spiff_programs_admin_update" ON spiff_programs
  FOR UPDATE USING (org_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

CREATE POLICY "spiff_programs_admin_delete" ON spiff_programs
  FOR DELETE USING (org_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

DROP TRIGGER IF EXISTS update_spiff_programs_updated_at ON spiff_programs;
CREATE TRIGGER update_spiff_programs_updated_at
  BEFORE UPDATE ON spiff_programs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- SPIFF ACHIEVEMENTS
-- Written when a user qualifies for a spiff (threshold met).
-- One row per user per spiff — updated if progress changes.
-- ============================================================

CREATE TABLE IF NOT EXISTS spiff_achievements (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id              UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  spiff_program_id    UUID NOT NULL REFERENCES spiff_programs(id) ON DELETE CASCADE,
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Progress snapshot (updated periodically as data refreshes)
  current_value       NUMERIC(14, 2) NOT NULL DEFAULT 0,  -- current count/amount toward threshold
  qualified           BOOLEAN NOT NULL DEFAULT false,      -- threshold crossed
  qualified_at        TIMESTAMPTZ,                         -- when threshold was first crossed
  -- Payout
  payout_amount       NUMERIC(10, 2),                      -- copied from spiff at qualification time
  paid_at             TIMESTAMPTZ,                         -- set when included in payroll run
  payroll_period_id   UUID,                                -- references payroll_periods if paid via payroll
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (spiff_program_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_spiff_achievements_org ON spiff_achievements(org_id);
CREATE INDEX IF NOT EXISTS idx_spiff_achievements_user ON spiff_achievements(user_id, qualified);
CREATE INDEX IF NOT EXISTS idx_spiff_achievements_program ON spiff_achievements(spiff_program_id, qualified);

ALTER TABLE spiff_achievements ENABLE ROW LEVEL SECURITY;

-- Reps see their own; managers see the full org
CREATE POLICY "spiff_achievements_select" ON spiff_achievements
  FOR SELECT USING (
    org_id = get_user_org_id(auth.uid())
    AND (user_id = auth.uid() OR is_admin_or_manager(auth.uid()))
  );

CREATE POLICY "spiff_achievements_admin_insert" ON spiff_achievements
  FOR INSERT WITH CHECK (org_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

CREATE POLICY "spiff_achievements_admin_update" ON spiff_achievements
  FOR UPDATE USING (org_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

-- DELETE intentionally omitted: achievements are append-only for audit trail integrity.

DROP TRIGGER IF EXISTS update_spiff_achievements_updated_at ON spiff_achievements;
CREATE TRIGGER update_spiff_achievements_updated_at
  BEFORE UPDATE ON spiff_achievements
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- INCENTIVE BADGES
-- Badge definitions (org-scoped so orgs can customize names/icons).
-- ============================================================

CREATE TABLE IF NOT EXISTS incentive_badges (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT,
  icon_key        TEXT NOT NULL DEFAULT 'star',   -- maps to icon set in frontend
  color_hex       TEXT NOT NULL DEFAULT '#F59E0B',
  criteria_type   badge_criteria_type NOT NULL,
  criteria_value  NUMERIC,                        -- e.g. 50 for "50 inspections milestone"
  is_active       BOOLEAN NOT NULL DEFAULT true,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_incentive_badges_org ON incentive_badges(org_id, is_active);

ALTER TABLE incentive_badges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "incentive_badges_org_select" ON incentive_badges
  FOR SELECT USING (org_id = get_user_org_id(auth.uid()));

CREATE POLICY "incentive_badges_admin_manage" ON incentive_badges
  FOR ALL USING (org_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

DROP TRIGGER IF EXISTS update_incentive_badges_updated_at ON incentive_badges;
CREATE TRIGGER update_incentive_badges_updated_at
  BEFORE UPDATE ON incentive_badges
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- USER BADGES
-- Which badges a user has earned and when.
-- ============================================================

CREATE TABLE IF NOT EXISTS user_badges (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_id        UUID NOT NULL REFERENCES incentive_badges(id) ON DELETE CASCADE,
  awarded_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  awarded_by      UUID REFERENCES users(id) ON DELETE SET NULL, -- null = auto-awarded
  note            TEXT,
  UNIQUE (user_id, badge_id)   -- one badge per user; re-earning not tracked here
);

CREATE INDEX IF NOT EXISTS idx_user_badges_user ON user_badges(user_id, awarded_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_badges_org ON user_badges(org_id, awarded_at DESC);

ALTER TABLE user_badges ENABLE ROW LEVEL SECURITY;

-- Badges are visible org-wide (public recognition is the point of the leaderboard).
-- If badge privacy is needed in the future, narrow to the spiff_achievements pattern.
CREATE POLICY "user_badges_select" ON user_badges
  FOR SELECT USING (org_id = get_user_org_id(auth.uid()));

CREATE POLICY "user_badges_admin_insert" ON user_badges
  FOR INSERT WITH CHECK (org_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

CREATE POLICY "user_badges_admin_delete" ON user_badges
  FOR DELETE USING (org_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

-- ============================================================
-- USER INCENTIVE GOALS
-- Per-user weekly activity targets set by admin or self.
-- Separate from coaching_goals (income-planning tool).
-- ============================================================

CREATE TABLE IF NOT EXISTS user_incentive_goals (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id                  UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id                 UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Weekly activity targets
  weekly_doors_target     INTEGER,
  weekly_inspections_target INTEGER,
  weekly_sales_target     INTEGER,
  weekly_revenue_target   NUMERIC(12, 2),
  -- Effective window; null end = indefinite
  effective_from          DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to            DATE,
  set_by                  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, effective_from)
);

CREATE INDEX IF NOT EXISTS idx_user_incentive_goals_user ON user_incentive_goals(user_id, effective_from DESC);

ALTER TABLE user_incentive_goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_incentive_goals_select" ON user_incentive_goals
  FOR SELECT USING (
    org_id = get_user_org_id(auth.uid())
    AND (user_id = auth.uid() OR is_admin_or_manager(auth.uid()))
  );

CREATE POLICY "user_incentive_goals_admin_manage" ON user_incentive_goals
  FOR ALL USING (org_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

DROP TRIGGER IF EXISTS update_user_incentive_goals_updated_at ON user_incentive_goals;
CREATE TRIGGER update_user_incentive_goals_updated_at
  BEFORE UPDATE ON user_incentive_goals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- SEED: DEFAULT BADGES
-- Inserted only if the org has none yet — run per-org via app
-- at org setup. This migration creates no rows (no org_id known here).
-- Badge seeding happens in the onboarding API route.
-- ============================================================

-- Notify PostgREST to reload schema.
SELECT pg_notify('pgrst', 'reload schema');
