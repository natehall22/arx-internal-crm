-- Pre-inspection briefings tied to a scheduled appointment (closer-facing notes and optional structured bullets).
-- Tenant alignment: org_id must match scheduled_appointments.org_id for the referenced appointment (composite FK).

-- Enables FOREIGN KEY (org_id, appointment_id) REFERENCES scheduled_appointments(org_id, id)
CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduled_appointments_org_id_id ON scheduled_appointments(org_id, id);

CREATE TABLE IF NOT EXISTS inspection_briefings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  appointment_id UUID NOT NULL,
  body TEXT,
  bullets JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT inspection_briefings_bullets_is_array CHECK (jsonb_typeof(bullets) = 'array'),
  CONSTRAINT inspection_briefings_org_appointment_fk FOREIGN KEY (org_id, appointment_id) REFERENCES scheduled_appointments(org_id, id) ON DELETE CASCADE,
  UNIQUE (org_id, appointment_id)
);

CREATE INDEX IF NOT EXISTS idx_inspection_briefings_org ON inspection_briefings(org_id);
CREATE INDEX IF NOT EXISTS idx_inspection_briefings_appointment ON inspection_briefings(appointment_id);

COMMENT ON TABLE inspection_briefings IS
  'One briefing per inspection appointment; body is freeform, bullets holds optional list (e.g. AI or checklist).';

COMMENT ON COLUMN inspection_briefings.bullets IS
  'JSON array of strings, e.g. ["Check drip edge", "Photo all elevations"].';

ALTER TABLE inspection_briefings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view inspection_briefings in org" ON inspection_briefings;
DROP POLICY IF EXISTS "Users can insert inspection_briefings in org" ON inspection_briefings;
DROP POLICY IF EXISTS "Users can update inspection_briefings in org" ON inspection_briefings;

CREATE POLICY "Users can view inspection_briefings in org"
  ON inspection_briefings FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

CREATE POLICY "Users can insert inspection_briefings in org"
  ON inspection_briefings FOR INSERT
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

CREATE POLICY "Users can update inspection_briefings in org"
  ON inspection_briefings FOR UPDATE
  USING (org_id = get_user_org_id(auth.uid()));

DROP TRIGGER IF EXISTS update_inspection_briefings_updated_at ON inspection_briefings;
CREATE TRIGGER update_inspection_briefings_updated_at
  BEFORE UPDATE ON inspection_briefings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
