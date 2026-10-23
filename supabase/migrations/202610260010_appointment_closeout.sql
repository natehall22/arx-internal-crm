-- "Close out old appointments": past appointments nobody logged an outcome for are marked "outcome not recorded" (owner
-- action, reversible, audited). Reports exclude them from the efficiency denominator. Additive/nullable.
ALTER TABLE scheduled_appointments ADD COLUMN IF NOT EXISTS outcome_not_recorded_at TIMESTAMPTZ;
ALTER TABLE scheduled_appointments ADD COLUMN IF NOT EXISTS outcome_not_recorded_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE scheduled_appointments ADD COLUMN IF NOT EXISTS outcome_not_recorded_batch UUID;
CREATE INDEX IF NOT EXISTS idx_scheduled_appointments_closeout_batch ON scheduled_appointments(outcome_not_recorded_batch) WHERE outcome_not_recorded_batch IS NOT NULL;

-- One audit row per closed-out appointment; `reverted_at` is set when a batch is undone.
CREATE TABLE IF NOT EXISTS appointment_closeouts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  batch_id       UUID NOT NULL,
  appointment_id UUID NOT NULL REFERENCES scheduled_appointments(id) ON DELETE CASCADE,
  actor_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reverted_at    TIMESTAMPTZ,
  reverted_by    UUID REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_appointment_closeouts_batch ON appointment_closeouts(org_id, batch_id);
ALTER TABLE appointment_closeouts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON appointment_closeouts FROM anon, authenticated;

-- Reporting: expose the flag (appended column) so period-metrics can drop these from the calendar denominator.
CREATE OR REPLACE VIEW rpt_appointments WITH (security_invoker = true) AS
 SELECT a.org_id,
    a.id AS appointment_id,
    a.scheduled_for,
    COALESCE(a.appointment_type, 'inspection'::text) AS appointment_type,
    a.status,
    a.closer_user_id,
    cl.full_name AS closer,
    a.canvasser_user_id AS setter_user_id,
    st.full_name AS setter,
    (a.status = 'completed'::text) AS was_completed,
    (a.status = 'cancelled'::text) AS was_cancelled,
    a.opportunity_id,
    a.lead_id,
    a.outcome_not_recorded_at
   FROM ((scheduled_appointments a
     LEFT JOIN users cl ON ((cl.id = a.closer_user_id)))
     LEFT JOIN users st ON ((st.id = a.canvasser_user_id)));
-- Rollback: DROP TABLE appointment_closeouts; ALTER TABLE scheduled_appointments DROP COLUMN outcome_not_recorded_at, DROP COLUMN outcome_not_recorded_by, DROP COLUMN outcome_not_recorded_batch; (re-create rpt_appointments without the last column first)
