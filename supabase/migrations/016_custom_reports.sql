-- Custom Reports System
-- Migration: 016_custom_reports.sql

-- Report type enum
CREATE TYPE report_type AS ENUM (
  'table',
  'bar_chart',
  'line_chart',
  'pie_chart',
  'metric_card',
  'funnel'
);

-- Report data source enum
CREATE TYPE report_data_source AS ENUM (
  'leads',
  'opportunities',
  'projects',
  'appointments',
  'users',
  'activities',
  'inspection_outcomes'
);

-- Custom reports table
CREATE TABLE custom_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  report_type report_type NOT NULL DEFAULT 'table',
  data_source report_data_source NOT NULL,
  config JSONB NOT NULL DEFAULT '{}', -- Stores filters, groupings, columns, etc.
  is_public BOOLEAN NOT NULL DEFAULT false, -- Visible to all in org
  is_dashboard_widget BOOLEAN NOT NULL DEFAULT false, -- Show on dashboard
  dashboard_position INTEGER, -- Order on dashboard
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_custom_reports_org ON custom_reports(org_id);
CREATE INDEX idx_custom_reports_creator ON custom_reports(created_by);
CREATE INDEX idx_custom_reports_dashboard ON custom_reports(org_id) WHERE is_dashboard_widget = true;

-- Report visibility/permissions table
-- Controls which roles can see which reports
CREATE TABLE report_role_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES custom_reports(id) ON DELETE CASCADE,
  role TEXT NOT NULL, -- Legacy role name
  custom_role_id UUID REFERENCES custom_roles(id) ON DELETE CASCADE,
  can_view BOOLEAN NOT NULL DEFAULT true,
  can_edit BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(report_id, role),
  UNIQUE(report_id, custom_role_id)
);

CREATE INDEX idx_report_access_report ON report_role_access(report_id);
CREATE INDEX idx_report_access_role ON report_role_access(role);

-- Report schedules for automated delivery
CREATE TABLE report_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  report_id UUID NOT NULL REFERENCES custom_reports(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  frequency TEXT NOT NULL, -- 'daily', 'weekly', 'monthly'
  day_of_week INTEGER, -- 0-6 for weekly
  day_of_month INTEGER, -- 1-31 for monthly
  time_of_day TIME NOT NULL DEFAULT '08:00',
  recipients JSONB NOT NULL DEFAULT '[]', -- Array of user IDs or emails
  last_sent_at TIMESTAMPTZ,
  next_send_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_report_schedules_report ON report_schedules(report_id);
CREATE INDEX idx_report_schedules_next ON report_schedules(next_send_at) WHERE active = true;

-- Saved report filters (for quick access)
CREATE TABLE saved_report_filters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  report_id UUID NOT NULL REFERENCES custom_reports(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  filters JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, report_id, name)
);

-- Triggers
CREATE TRIGGER update_custom_reports_updated_at 
  BEFORE UPDATE ON custom_reports 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_report_schedules_updated_at 
  BEFORE UPDATE ON report_schedules 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS Policies
ALTER TABLE custom_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_role_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_report_filters ENABLE ROW LEVEL SECURITY;

-- Custom reports: users can see reports they created, public reports, or reports they have access to
CREATE POLICY "Users can view accessible reports"
  ON custom_reports FOR SELECT
  USING (
    org_id = get_user_org_id(auth.uid())
    AND (
      created_by = auth.uid()
      OR is_public = true
      OR EXISTS (
        SELECT 1 FROM report_role_access ra
        JOIN users u ON u.id = auth.uid()
        WHERE ra.report_id = custom_reports.id
        AND ra.can_view = true
        AND (ra.role = u.role OR ra.custom_role_id = u.custom_role_id)
      )
    )
  );

CREATE POLICY "Users can create reports with permission"
  ON custom_reports FOR INSERT
  WITH CHECK (
    org_id = get_user_org_id(auth.uid())
    AND created_by = auth.uid()
  );

CREATE POLICY "Users can update their own reports"
  ON custom_reports FOR UPDATE
  USING (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM report_role_access ra
      JOIN users u ON u.id = auth.uid()
      WHERE ra.report_id = custom_reports.id
      AND ra.can_edit = true
      AND (ra.role = u.role OR ra.custom_role_id = u.custom_role_id)
    )
  );

CREATE POLICY "Users can delete their own reports"
  ON custom_reports FOR DELETE
  USING (created_by = auth.uid());

-- Report role access policies
CREATE POLICY "Users can view report access for their reports"
  ON report_role_access FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM custom_reports cr
      WHERE cr.id = report_role_access.report_id
      AND cr.org_id = get_user_org_id(auth.uid())
    )
  );

CREATE POLICY "Report creators can manage access"
  ON report_role_access FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM custom_reports cr
      WHERE cr.id = report_role_access.report_id
      AND cr.created_by = auth.uid()
    )
  );

-- Report schedules policies
CREATE POLICY "Users can view schedules for accessible reports"
  ON report_schedules FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

CREATE POLICY "Users can manage their own schedules"
  ON report_schedules FOR ALL
  USING (created_by = auth.uid());

-- Saved filters policies
CREATE POLICY "Users can manage their own saved filters"
  ON saved_report_filters FOR ALL
  USING (user_id = auth.uid());

-- Function to check if user can access a report
CREATE OR REPLACE FUNCTION can_access_report(report_uuid UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_user_id UUID;
  v_user_role TEXT;
  v_custom_role_id UUID;
  v_report RECORD;
BEGIN
  v_user_id := auth.uid();
  
  SELECT role, custom_role_id INTO v_user_role, v_custom_role_id
  FROM users WHERE id = v_user_id;
  
  SELECT * INTO v_report FROM custom_reports WHERE id = report_uuid;
  
  IF v_report IS NULL THEN
    RETURN false;
  END IF;
  
  -- Creator always has access
  IF v_report.created_by = v_user_id THEN
    RETURN true;
  END IF;
  
  -- Public reports are accessible
  IF v_report.is_public THEN
    RETURN true;
  END IF;
  
  -- Check role-based access
  RETURN EXISTS (
    SELECT 1 FROM report_role_access ra
    WHERE ra.report_id = report_uuid
    AND ra.can_view = true
    AND (ra.role = v_user_role OR ra.custom_role_id = v_custom_role_id)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
