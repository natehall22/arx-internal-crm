-- Append-only audit history for user_incentive_goals changes
CREATE TABLE user_incentive_goals_history (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  changed_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  changed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  weekly_doors_target        INTEGER,
  weekly_inspections_target  INTEGER,
  weekly_sales_target        INTEGER,
  weekly_revenue_target      NUMERIC(10,2),
  effective_from  DATE NOT NULL,
  effective_to    DATE,
  change_note     TEXT
);

CREATE INDEX idx_goal_history_user_id ON user_incentive_goals_history(user_id);
CREATE INDEX idx_goal_history_org_id  ON user_incentive_goals_history(org_id);

-- Lock to service role only — audit data, no direct client reads
ALTER TABLE user_incentive_goals_history ENABLE ROW LEVEL SECURITY;
