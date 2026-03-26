-- Close appointment tracking (separate from inspection flow). Linked to opportunities.
-- Populated when a close is scheduled via /api/inspections/schedule-close and updated from /appointments/close-feedback.

CREATE TABLE IF NOT EXISTS close_appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  opportunity_id UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  scheduled_appointment_id UUID REFERENCES scheduled_appointments(id) ON DELETE SET NULL,
  scheduled_for TIMESTAMPTZ NOT NULL,
  outcome TEXT,
  notes TEXT,
  submitted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  outcome_submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_close_appointments_org ON close_appointments(org_id);
CREATE INDEX IF NOT EXISTS idx_close_appointments_opportunity ON close_appointments(opportunity_id);

ALTER TABLE close_appointments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view close_appointments in org" ON close_appointments;
DROP POLICY IF EXISTS "Users can insert close_appointments in org" ON close_appointments;
DROP POLICY IF EXISTS "Users can update close_appointments in org" ON close_appointments;

CREATE POLICY "Users can view close_appointments in org"
  ON close_appointments FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

CREATE POLICY "Users can insert close_appointments in org"
  ON close_appointments FOR INSERT
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

CREATE POLICY "Users can update close_appointments in org"
  ON close_appointments FOR UPDATE
  USING (org_id = get_user_org_id(auth.uid()));

DROP TRIGGER IF EXISTS update_close_appointments_updated_at ON close_appointments;
CREATE TRIGGER update_close_appointments_updated_at
  BEFORE UPDATE ON close_appointments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
