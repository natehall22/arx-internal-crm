-- Org-level rates for the two remaining derived commission lines in the published
-- ladder: the manager override (1% of a job's commission base) and the
-- self-generated line (6%).
--
-- Both default to 0 = OFF, following the orgs.inspection_commission_rate precedent
-- (migration 202608010002). Payroll is live and in daily use; a non-zero default
-- would silently start paying new lines on the very next period lock. Set these
-- deliberately when ownership signs off on the comp plan going into effect.
--
-- Per-job overrides still win: an explicit deal_commission_roles row (field_manager /
-- senior_manager for the override, self_gen for the self-generated line) takes
-- precedence over these rates for that job, including a deliberate $0.

ALTER TABLE orgs
  ADD COLUMN IF NOT EXISTS manager_override_commission_rate NUMERIC(5, 2) NOT NULL DEFAULT 0;

ALTER TABLE orgs
  ADD COLUMN IF NOT EXISTS self_gen_commission_rate NUMERIC(5, 2) NOT NULL DEFAULT 0;

-- Version rates by sale date. Existing values begin today; later edits take effect
-- tomorrow so changing a rate cannot rewrite jobs already sold earlier that day.
CREATE TABLE IF NOT EXISTS org_derived_commission_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  inspection_commission_rate NUMERIC(5, 2) NOT NULL DEFAULT 0,
  manager_override_commission_rate NUMERIC(5, 2) NOT NULL DEFAULT 0,
  self_gen_commission_rate NUMERIC(5, 2) NOT NULL DEFAULT 0,
  effective_from DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, effective_from)
);

ALTER TABLE org_derived_commission_rates ENABLE ROW LEVEL SECURITY;

INSERT INTO org_derived_commission_rates (
  org_id,
  inspection_commission_rate,
  manager_override_commission_rate,
  self_gen_commission_rate,
  effective_from
)
SELECT
  id,
  COALESCE(inspection_commission_rate, 0),
  manager_override_commission_rate,
  self_gen_commission_rate,
  (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::date
FROM orgs
ON CONFLICT (org_id, effective_from) DO NOTHING;

CREATE OR REPLACE FUNCTION record_org_derived_commission_rates()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.inspection_commission_rate IS DISTINCT FROM OLD.inspection_commission_rate
    OR NEW.manager_override_commission_rate IS DISTINCT FROM OLD.manager_override_commission_rate
    OR NEW.self_gen_commission_rate IS DISTINCT FROM OLD.self_gen_commission_rate THEN
    INSERT INTO org_derived_commission_rates (
      org_id,
      inspection_commission_rate,
      manager_override_commission_rate,
      self_gen_commission_rate,
      effective_from
    ) VALUES (
      NEW.id,
      COALESCE(NEW.inspection_commission_rate, 0),
      NEW.manager_override_commission_rate,
      NEW.self_gen_commission_rate,
      (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::date + 1
    )
    ON CONFLICT (org_id, effective_from) DO UPDATE SET
      inspection_commission_rate = EXCLUDED.inspection_commission_rate,
      manager_override_commission_rate = EXCLUDED.manager_override_commission_rate,
      self_gen_commission_rate = EXCLUDED.self_gen_commission_rate,
      created_at = NOW();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_record_org_derived_commission_rates ON orgs;
CREATE TRIGGER trg_record_org_derived_commission_rates
AFTER UPDATE OF inspection_commission_rate, manager_override_commission_rate, self_gen_commission_rate ON orgs
FOR EACH ROW EXECUTE FUNCTION record_org_derived_commission_rates();

-- Effective-dated reporting lines. Existing manager relationships begin today;
-- there is deliberately no historical backfill because the prior assignment cannot
-- be proven. A missing row for a sale date therefore means no manager override.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_org_id_id ON users (org_id, id);

CREATE TABLE IF NOT EXISTS user_payroll_active_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  is_active BOOLEAN NOT NULL,
  effective_from DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, effective_from),
  FOREIGN KEY (org_id, user_id) REFERENCES users(org_id, id) ON DELETE RESTRICT
);

ALTER TABLE user_payroll_active_history ENABLE ROW LEVEL SECURITY;

INSERT INTO user_payroll_active_history (org_id, user_id, is_active, effective_from)
SELECT org_id, id, active,
  (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::date
FROM users
ON CONFLICT (user_id, effective_from) DO NOTHING;

CREATE OR REPLACE FUNCTION record_user_payroll_active_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.active IS DISTINCT FROM OLD.active THEN
    INSERT INTO user_payroll_active_history (
      org_id, user_id, is_active, effective_from
    ) VALUES (
      NEW.org_id,
      NEW.id,
      NEW.active,
      (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::date + 1
    )
    ON CONFLICT (user_id, effective_from) DO UPDATE SET
      is_active = EXCLUDED.is_active,
      created_at = NOW();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_record_user_payroll_active_history ON users;
CREATE TRIGGER trg_record_user_payroll_active_history
AFTER UPDATE OF active ON users
FOR EACH ROW EXECUTE FUNCTION record_user_payroll_active_history();

CREATE TABLE IF NOT EXISTS user_manager_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  manager_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  effective_from DATE NOT NULL,
  effective_to DATE NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (user_id <> manager_user_id),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  UNIQUE (user_id, effective_from),
  FOREIGN KEY (org_id, user_id) REFERENCES users(org_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, manager_user_id) REFERENCES users(org_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_user_manager_assignments_org_dates
  ON user_manager_assignments (org_id, user_id, effective_from, effective_to);

CREATE INDEX IF NOT EXISTS idx_user_manager_assignments_manager
  ON user_manager_assignments (manager_user_id);

ALTER TABLE user_manager_assignments ENABLE ROW LEVEL SECURITY;

INSERT INTO user_manager_assignments (org_id, user_id, manager_user_id, effective_from)
SELECT u.org_id, u.id, u.manager_user_id,
  (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::date
FROM users u
JOIN users m ON m.id = u.manager_user_id AND m.org_id = u.org_id
WHERE u.manager_user_id IS NOT NULL
ON CONFLICT (user_id, effective_from) DO NOTHING;

CREATE OR REPLACE FUNCTION record_user_manager_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.manager_user_id IS DISTINCT FROM OLD.manager_user_id THEN
    DELETE FROM user_manager_assignments
    WHERE user_id = NEW.id
      AND effective_from = (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::date + 1;

    UPDATE user_manager_assignments
    SET effective_to = (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::date
    WHERE user_id = NEW.id
      AND effective_to IS NULL
      AND effective_from <= (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::date;

    IF NEW.manager_user_id IS NOT NULL AND NEW.manager_user_id <> NEW.id THEN
      INSERT INTO user_manager_assignments (
        org_id, user_id, manager_user_id, effective_from
      ) VALUES (
        NEW.org_id, NEW.id, NEW.manager_user_id,
        (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::date + 1
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_record_user_manager_assignment ON users;
CREATE TRIGGER trg_record_user_manager_assignment
AFTER INSERT OR UPDATE OF manager_user_id ON users
FOR EACH ROW EXECUTE FUNCTION record_user_manager_assignment();

COMMENT ON COLUMN orgs.manager_override_commission_rate IS
  'Percent of a job''s commission base paid as a manager override, derived from '
  'effective-dated user_manager_assignments on the job sale date. One line per manager '
  'per job. Applied only when the manager had a manager comp-plan assignment on the '
  'sale date and no '
  'explicit deal_commission_roles field_manager/senior_manager row exists for that job. '
  '0 disables the derived override entirely. Counts inside the sales commission pool cap.';

COMMENT ON COLUMN orgs.self_gen_commission_rate IS
  'Percent of a job''s commission base paid to the closer on a self-generated deal '
  '(opportunities.is_self_generated = true), on top of their normal close commission. '
  'Suppressed when the opportunity also carries a different setter — that combination '
  'is contradictory and would breach the 18 percent pool cap. Applied only when no explicit '
  'deal_commission_roles self_gen row exists for that job. 0 disables the derived line '
  'entirely. Counts inside the sales commission pool cap.';

COMMENT ON TABLE org_derived_commission_rates IS
  'Immutable-by-date derived commission rates. Payroll resolves the latest row on or '
  'before the job sale date so later rate changes never rewrite historical pay.';

COMMENT ON TABLE user_manager_assignments IS
  'Effective-dated manager attribution used for sale-date payroll. No row means no '
  'verified assignment for that timeframe; current users.manager_user_id is never '
  'used to rewrite historical pay.';

COMMENT ON TABLE user_payroll_active_history IS
  'Sale-date active status for manager override eligibility. Deactivation takes '
  'effect on the next Eastern business date and never rewrites earlier sales.';

SELECT pg_notify('pgrst', 'reload schema');
