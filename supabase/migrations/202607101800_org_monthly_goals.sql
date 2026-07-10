-- Org-level monthly goals (C-suite scorecard targets). Separate from Sisu user_incentive_goals.

CREATE TABLE org_monthly_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  month date NOT NULL,
  doors_target integer,
  sets_target integer,
  sits_target integer,
  sales_target integer,
  revenue_target numeric(12,2),
  notes text,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, month)
);

CREATE INDEX idx_org_monthly_goals_org_month ON org_monthly_goals(org_id, month DESC);

CREATE TRIGGER update_org_monthly_goals_updated_at
  BEFORE UPDATE ON org_monthly_goals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE org_monthly_goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view monthly goals"
  ON org_monthly_goals FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

CREATE POLICY "Admins can manage monthly goals"
  ON org_monthly_goals FOR ALL
  USING (
    org_id = get_user_org_id(auth.uid())
    AND get_user_role(auth.uid()) IN ('admin', 'owner')
  );

-- Sisu user_incentive_goals_history is per-rep; use a dedicated audit table here.
CREATE TABLE org_monthly_goal_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id uuid NOT NULL REFERENCES org_monthly_goals(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  changed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  changes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_org_monthly_goal_audit_goal ON org_monthly_goal_audit(goal_id, created_at DESC);

ALTER TABLE org_monthly_goal_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view monthly goal audit"
  ON org_monthly_goal_audit FOR SELECT
  USING (
    org_id = get_user_org_id(auth.uid())
    AND get_user_role(auth.uid()) IN ('admin', 'owner')
  );

SELECT pg_notify('pgrst', 'reload schema');
