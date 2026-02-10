-- Commissions, AI Settings, and User Preferences
-- Migration: 017_commissions_ai_settings.sql

-- Comp plan types
CREATE TYPE comp_plan_type AS ENUM (
  'flat_rate',
  'percentage',
  'tiered',
  'hybrid'
);

-- Commission status
CREATE TYPE commission_status AS ENUM (
  'pending',
  'approved',
  'paid',
  'disputed'
);

-- Comp plans table (admin configurable)
CREATE TABLE comp_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  plan_type comp_plan_type NOT NULL DEFAULT 'percentage',
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_default BOOLEAN NOT NULL DEFAULT false,
  
  -- For flat rate
  flat_amount NUMERIC(10, 2),
  
  -- For percentage
  base_percentage NUMERIC(5, 2),
  
  -- For tiered (JSON array of tiers)
  -- Example: [{"min": 0, "max": 10000, "rate": 5}, {"min": 10001, "max": 25000, "rate": 7}]
  tiers JSONB,
  
  -- Bonus structure
  bonuses JSONB, -- [{"type": "monthly_target", "target": 50000, "bonus": 500}]
  
  -- Role restrictions (which roles can be assigned this plan)
  applicable_roles TEXT[] DEFAULT ARRAY['sales_rep', 'canvasser'],
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_comp_plans_org ON comp_plans(org_id);
CREATE INDEX idx_comp_plans_active ON comp_plans(org_id) WHERE is_active = true;

-- User comp plan assignments
CREATE TABLE user_comp_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  comp_plan_id UUID NOT NULL REFERENCES comp_plans(id) ON DELETE CASCADE,
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to DATE,
  override_percentage NUMERIC(5, 2), -- Optional override for this user
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, comp_plan_id, effective_from)
);

CREATE INDEX idx_user_comp_plans_user ON user_comp_plans(user_id);

-- Commissions table (tracks actual commissions)
CREATE TABLE commissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  opportunity_id UUID REFERENCES opportunities(id) ON DELETE SET NULL,
  comp_plan_id UUID REFERENCES comp_plans(id) ON DELETE SET NULL,
  
  -- Commission details
  sale_amount NUMERIC(12, 2) NOT NULL,
  commission_rate NUMERIC(5, 2) NOT NULL,
  commission_amount NUMERIC(10, 2) NOT NULL,
  bonus_amount NUMERIC(10, 2) DEFAULT 0,
  total_amount NUMERIC(10, 2) NOT NULL,
  
  -- Status tracking
  status commission_status NOT NULL DEFAULT 'pending',
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  
  -- Period tracking
  commission_period DATE NOT NULL, -- Month/period this commission belongs to
  
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_commissions_user ON commissions(user_id);
CREATE INDEX idx_commissions_period ON commissions(user_id, commission_period);
CREATE INDEX idx_commissions_status ON commissions(status);

-- User settings/preferences
CREATE TABLE user_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  
  -- Notification preferences
  notifications_enabled BOOLEAN NOT NULL DEFAULT true,
  email_notifications BOOLEAN NOT NULL DEFAULT true,
  push_notifications BOOLEAN NOT NULL DEFAULT true,
  notification_types JSONB DEFAULT '{"inspection_outcome": true, "appointment_reminder": true, "commission_update": true, "team_updates": true}',
  
  -- Calendar preferences
  google_calendar_connected BOOLEAN NOT NULL DEFAULT false,
  default_appointment_duration INTEGER DEFAULT 60,
  appointment_buffer_minutes INTEGER DEFAULT 30,
  working_hours_start TIME DEFAULT '08:00',
  working_hours_end TIME DEFAULT '18:00',
  working_days INTEGER[] DEFAULT ARRAY[1,2,3,4,5], -- 0=Sun, 1=Mon, etc.
  
  -- AI preferences
  ai_enabled BOOLEAN NOT NULL DEFAULT false,
  ai_suggestions_enabled BOOLEAN NOT NULL DEFAULT true,
  ai_auto_notes BOOLEAN NOT NULL DEFAULT false,
  
  -- Display preferences
  theme TEXT DEFAULT 'light',
  dashboard_layout JSONB,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_settings_user ON user_settings(user_id);

-- AI conversation history (for context)
CREATE TABLE ai_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  context_type TEXT, -- 'lead', 'opportunity', 'project', 'general'
  context_id UUID, -- ID of the related record
  messages JSONB NOT NULL DEFAULT '[]', -- Array of {role, content, timestamp}
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ai_conversations_user ON ai_conversations(user_id);
CREATE INDEX idx_ai_conversations_context ON ai_conversations(context_type, context_id);

-- AI suggestions log
CREATE TABLE ai_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  suggestion_type TEXT NOT NULL, -- 'follow_up', 'next_step', 'pricing', 'scheduling'
  context_type TEXT,
  context_id UUID,
  suggestion TEXT NOT NULL,
  was_accepted BOOLEAN,
  feedback TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ai_suggestions_user ON ai_suggestions(user_id);

-- Triggers
CREATE TRIGGER update_comp_plans_updated_at 
  BEFORE UPDATE ON comp_plans 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_commissions_updated_at 
  BEFORE UPDATE ON commissions 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_settings_updated_at 
  BEFORE UPDATE ON user_settings 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_ai_conversations_updated_at 
  BEFORE UPDATE ON ai_conversations 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS Policies
ALTER TABLE comp_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_comp_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE commissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_suggestions ENABLE ROW LEVEL SECURITY;

-- Comp plans: admins can manage, others can view
CREATE POLICY "Users can view comp plans"
  ON comp_plans FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

CREATE POLICY "Admins can manage comp plans"
  ON comp_plans FOR ALL
  USING (
    org_id = get_user_org_id(auth.uid())
    AND get_user_role(auth.uid()) IN ('admin', 'regional_manager')
  );

-- User comp plans: users see their own, admins see all
CREATE POLICY "Users can view their comp plan assignments"
  ON user_comp_plans FOR SELECT
  USING (
    org_id = get_user_org_id(auth.uid())
    AND (
      user_id = auth.uid()
      OR get_user_role(auth.uid()) IN ('admin', 'regional_manager', 'sales_manager')
    )
  );

CREATE POLICY "Admins can manage comp plan assignments"
  ON user_comp_plans FOR ALL
  USING (
    org_id = get_user_org_id(auth.uid())
    AND get_user_role(auth.uid()) IN ('admin', 'regional_manager')
  );

-- Commissions: users see their own, managers see team
CREATE POLICY "Users can view their commissions"
  ON commissions FOR SELECT
  USING (
    org_id = get_user_org_id(auth.uid())
    AND (
      user_id = auth.uid()
      OR get_user_role(auth.uid()) IN ('admin', 'regional_manager', 'sales_manager')
    )
  );

CREATE POLICY "Admins can manage commissions"
  ON commissions FOR ALL
  USING (
    org_id = get_user_org_id(auth.uid())
    AND get_user_role(auth.uid()) IN ('admin', 'regional_manager')
  );

-- User settings: users manage their own
CREATE POLICY "Users can manage their settings"
  ON user_settings FOR ALL
  USING (user_id = auth.uid());

-- AI conversations: users see their own
CREATE POLICY "Users can manage their AI conversations"
  ON ai_conversations FOR ALL
  USING (user_id = auth.uid());

-- AI suggestions: users see their own
CREATE POLICY "Users can manage their AI suggestions"
  ON ai_suggestions FOR ALL
  USING (user_id = auth.uid());

-- Function to calculate commission for a sale
CREATE OR REPLACE FUNCTION calculate_commission(
  p_user_id UUID,
  p_sale_amount NUMERIC,
  p_sale_date DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  comp_plan_id UUID,
  commission_rate NUMERIC,
  commission_amount NUMERIC,
  bonus_amount NUMERIC,
  total_amount NUMERIC
) AS $$
DECLARE
  v_plan RECORD;
  v_rate NUMERIC;
  v_commission NUMERIC;
  v_bonus NUMERIC := 0;
BEGIN
  -- Get user's active comp plan
  SELECT cp.* INTO v_plan
  FROM user_comp_plans ucp
  JOIN comp_plans cp ON cp.id = ucp.comp_plan_id
  WHERE ucp.user_id = p_user_id
    AND ucp.effective_from <= p_sale_date
    AND (ucp.effective_to IS NULL OR ucp.effective_to >= p_sale_date)
    AND cp.is_active = true
  ORDER BY ucp.effective_from DESC
  LIMIT 1;
  
  IF v_plan IS NULL THEN
    -- Fall back to default plan
    SELECT * INTO v_plan
    FROM comp_plans
    WHERE org_id = get_user_org_id(p_user_id)
      AND is_default = true
      AND is_active = true
    LIMIT 1;
  END IF;
  
  IF v_plan IS NULL THEN
    RETURN;
  END IF;
  
  -- Calculate rate based on plan type
  CASE v_plan.plan_type
    WHEN 'flat_rate' THEN
      v_rate := 0;
      v_commission := COALESCE(v_plan.flat_amount, 0);
    WHEN 'percentage' THEN
      v_rate := COALESCE(v_plan.base_percentage, 0);
      v_commission := p_sale_amount * (v_rate / 100);
    WHEN 'tiered' THEN
      -- Find applicable tier
      SELECT (tier->>'rate')::NUMERIC INTO v_rate
      FROM jsonb_array_elements(v_plan.tiers) AS tier
      WHERE (tier->>'min')::NUMERIC <= p_sale_amount
        AND ((tier->>'max')::NUMERIC >= p_sale_amount OR tier->>'max' IS NULL)
      LIMIT 1;
      v_rate := COALESCE(v_rate, v_plan.base_percentage, 0);
      v_commission := p_sale_amount * (v_rate / 100);
    ELSE
      v_rate := COALESCE(v_plan.base_percentage, 0);
      v_commission := p_sale_amount * (v_rate / 100);
  END CASE;
  
  RETURN QUERY SELECT 
    v_plan.id,
    v_rate,
    v_commission,
    v_bonus,
    v_commission + v_bonus;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
