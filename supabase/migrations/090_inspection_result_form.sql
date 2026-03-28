-- Inspection result form: structured post-inspection debrief tied to an opportunity (1:1).
-- Separate from inspection_briefings (089) which are pre-inspection notes per appointment.
-- Tenant alignment: org_id must match opportunities / close_appointments for referenced rows (composite FKs).

CREATE UNIQUE INDEX IF NOT EXISTS idx_opportunities_org_id_id ON opportunities(org_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_close_appointments_org_id_id ON close_appointments(org_id, id);

CREATE TABLE IF NOT EXISTS inspection_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  opportunity_id UUID NOT NULL,
  submitted_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  submitted_at TIMESTAMPTZ,

  -- Step 1: Outcome
  outcome TEXT NOT NULL CHECK (outcome IN ('approved', 'denied', 'follow_up', 'not_home', 'cancelled', 'other')),

  -- Step 2: Briefing fields (populated when outcome = 'approved' or 'follow_up')
  both_dms_present BOOLEAN,
  absent_dm_name TEXT,
  damage_found TEXT,
  roof_slopes TEXT,
  photos_confirmed BOOLEAN,
  homeowner_emotional_state TEXT,
  consequence_questions_asked BOOLEAN,
  insurance_mentioned BOOLEAN,
  urgency_level TEXT CHECK (urgency_level IN ('low', 'medium', 'high') OR urgency_level IS NULL),
  notes TEXT,

  -- Step 3: Close appointment linked after scheduling
  close_appointment_id UUID,

  -- Email delivery tracking
  briefing_email_sent_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT inspection_results_opportunity_id_unique UNIQUE (opportunity_id),
  CONSTRAINT inspection_results_org_opportunity_fk FOREIGN KEY (org_id, opportunity_id) REFERENCES opportunities(org_id, id) ON DELETE CASCADE,
  CONSTRAINT inspection_results_org_close_fk FOREIGN KEY (org_id, close_appointment_id) REFERENCES close_appointments(org_id, id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_inspection_results_org ON inspection_results(org_id);

COMMENT ON TABLE inspection_results IS
  'One post-inspection result per opportunity; captures outcome, briefing details, linked close appointment, and email delivery status.';

COMMENT ON COLUMN inspection_results.submitted_at IS
  'Set by the application when the user submits the form; NULL until submission (drafts).';

ALTER TABLE inspection_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view inspection_results in org" ON inspection_results;
DROP POLICY IF EXISTS "Users can insert inspection_results in org" ON inspection_results;
DROP POLICY IF EXISTS "Users can update inspection_results in org" ON inspection_results;

CREATE POLICY "Users can view inspection_results in org"
  ON inspection_results FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

CREATE POLICY "Users can insert inspection_results in org"
  ON inspection_results FOR INSERT
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

CREATE POLICY "Users can update inspection_results in org"
  ON inspection_results FOR UPDATE
  USING (org_id = get_user_org_id(auth.uid()));

DROP TRIGGER IF EXISTS update_inspection_results_updated_at ON inspection_results;
CREATE TRIGGER update_inspection_results_updated_at
  BEFORE UPDATE ON inspection_results
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
