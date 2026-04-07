-- Migration 098: coaching_goals table
-- Stores rep income goals for coaching/1:1 use. Manager can edit on behalf of rep.

CREATE TABLE IF NOT EXISTS coaching_goals (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  annual_income_goal DECIMAL(12,2),
  avg_deal_value DECIMAL(12,2),
  working_days_per_week INTEGER DEFAULT 5,
  working_weeks_per_year INTEGER DEFAULT 50,
  close_rate_override DECIMAL(5,2),   -- null = use live data
  stick_rate_override DECIMAL(5,2),   -- null = use live data
  updated_by UUID REFERENCES users(id), -- null = self; set when manager edits
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_coaching_goals_org_id ON coaching_goals(org_id);
CREATE INDEX IF NOT EXISTS idx_coaching_goals_user_id ON coaching_goals(user_id);

ALTER TABLE coaching_goals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read coaching goals in their org" ON coaching_goals;
DROP POLICY IF EXISTS "Users can insert coaching goals in their org" ON coaching_goals;
DROP POLICY IF EXISTS "Users can update coaching goals in their org" ON coaching_goals;

-- Users can read their own; managers/admins can read all in their org
CREATE POLICY "Users can read coaching goals in their org"
  ON coaching_goals FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

-- Any org member can insert (for self or manager inserting for rep)
CREATE POLICY "Users can insert coaching goals in their org"
  ON coaching_goals FOR INSERT
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

-- Any org member can update (service role enforces manager-only for other users)
CREATE POLICY "Users can update coaching goals in their org"
  ON coaching_goals FOR UPDATE
  USING (org_id = get_user_org_id(auth.uid()));
