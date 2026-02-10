-- Inspection Status Updates and Notifications System
-- Migration: 015_inspection_status_notifications.sql

-- Create inspection_outcome enum
CREATE TYPE inspection_outcome AS ENUM (
  'not_home',
  'said_no', 
  'failed_credit',
  'rescheduled',
  'sale'
);

-- Create inspection_status_updates table
CREATE TABLE inspection_status_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  appointment_id UUID NOT NULL REFERENCES scheduled_appointments(id) ON DELETE CASCADE,
  opportunity_id UUID REFERENCES opportunities(id) ON DELETE SET NULL,
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  closer_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  setter_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  outcome inspection_outcome NOT NULL,
  notes TEXT,
  setter_feedback TEXT, -- Feedback specifically for the setter to see
  prompted_at TIMESTAMPTZ, -- When the system prompted for update
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_inspection_status_appointment ON inspection_status_updates(appointment_id);
CREATE INDEX idx_inspection_status_opportunity ON inspection_status_updates(opportunity_id);
CREATE INDEX idx_inspection_status_closer ON inspection_status_updates(closer_user_id);
CREATE INDEX idx_inspection_status_setter ON inspection_status_updates(setter_user_id);
CREATE INDEX idx_inspection_status_outcome ON inspection_status_updates(outcome);

-- Create notifications table
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL, -- 'inspection_outcome', 'status_prompt', 'reschedule', etc.
  title TEXT NOT NULL,
  body TEXT,
  data JSONB, -- Additional data like appointment_id, outcome, etc.
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_user ON notifications(user_id, created_at DESC);
CREATE INDEX idx_notifications_unread ON notifications(user_id) WHERE read_at IS NULL;

-- Create pending_status_prompts table (for tracking 30-min prompts)
CREATE TABLE pending_status_prompts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  appointment_id UUID NOT NULL REFERENCES scheduled_appointments(id) ON DELETE CASCADE,
  closer_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prompt_at TIMESTAMPTZ NOT NULL, -- When to show the prompt (appointment time + 30 min)
  dismissed BOOLEAN NOT NULL DEFAULT false,
  completed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(appointment_id)
);

CREATE INDEX idx_pending_prompts_closer ON pending_status_prompts(closer_user_id) WHERE NOT completed AND NOT dismissed;
CREATE INDEX idx_pending_prompts_time ON pending_status_prompts(prompt_at) WHERE NOT completed AND NOT dismissed;

-- Create dashboard_settings table for regional customization
CREATE TABLE dashboard_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  region_id UUID REFERENCES regions(id) ON DELETE CASCADE,
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE, -- NULL = org-wide default
  settings JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Only one setting per scope
  UNIQUE(org_id, region_id, team_id, user_id)
);

CREATE INDEX idx_dashboard_settings_org ON dashboard_settings(org_id);
CREATE INDEX idx_dashboard_settings_region ON dashboard_settings(region_id);
CREATE INDEX idx_dashboard_settings_team ON dashboard_settings(team_id);
CREATE INDEX idx_dashboard_settings_user ON dashboard_settings(user_id);

-- Add setter_user_id to scheduled_appointments if not exists
ALTER TABLE scheduled_appointments 
  ADD COLUMN IF NOT EXISTS setter_feedback_read BOOLEAN DEFAULT false;

-- Add outcome tracking to opportunities
ALTER TABLE opportunities 
  ADD COLUMN IF NOT EXISTS inspection_outcome inspection_outcome,
  ADD COLUMN IF NOT EXISTS inspection_outcome_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS inspection_notes TEXT;

-- Triggers
CREATE TRIGGER update_inspection_status_updates_updated_at 
  BEFORE UPDATE ON inspection_status_updates 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_dashboard_settings_updated_at 
  BEFORE UPDATE ON dashboard_settings 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS Policies for inspection_status_updates
ALTER TABLE inspection_status_updates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view status updates in their org"
  ON inspection_status_updates FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

CREATE POLICY "Closers can create their own status updates"
  ON inspection_status_updates FOR INSERT
  WITH CHECK (
    org_id = get_user_org_id(auth.uid()) 
    AND closer_user_id = auth.uid()
  );

CREATE POLICY "Closers can update their own status updates"
  ON inspection_status_updates FOR UPDATE
  USING (closer_user_id = auth.uid());

-- RLS Policies for notifications
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own notifications"
  ON notifications FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "System can create notifications"
  ON notifications FOR INSERT
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

CREATE POLICY "Users can update their own notifications"
  ON notifications FOR UPDATE
  USING (user_id = auth.uid());

-- RLS Policies for pending_status_prompts
ALTER TABLE pending_status_prompts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own prompts"
  ON pending_status_prompts FOR SELECT
  USING (closer_user_id = auth.uid());

CREATE POLICY "System can manage prompts"
  ON pending_status_prompts FOR ALL
  USING (org_id = get_user_org_id(auth.uid()));

-- RLS Policies for dashboard_settings
ALTER TABLE dashboard_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view dashboard settings in their org"
  ON dashboard_settings FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

CREATE POLICY "Admins and managers can manage dashboard settings"
  ON dashboard_settings FOR ALL
  USING (
    org_id = get_user_org_id(auth.uid()) 
    AND EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() 
      AND role IN ('admin', 'regional_manager', 'sales_manager')
    )
  );

-- Function to create status prompt after appointment
CREATE OR REPLACE FUNCTION create_inspection_status_prompt()
RETURNS TRIGGER AS $$
BEGIN
  -- Only create prompt for new appointments
  IF TG_OP = 'INSERT' THEN
    INSERT INTO pending_status_prompts (
      org_id,
      appointment_id,
      closer_user_id,
      prompt_at
    ) VALUES (
      NEW.org_id,
      NEW.id,
      NEW.closer_user_id,
      NEW.scheduled_for + INTERVAL '30 minutes'
    )
    ON CONFLICT (appointment_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER create_status_prompt_on_appointment
  AFTER INSERT ON scheduled_appointments
  FOR EACH ROW
  EXECUTE FUNCTION create_inspection_status_prompt();
