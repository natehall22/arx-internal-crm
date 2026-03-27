-- Link each close booking to the inspection visit that triggered it (audit + UI).

ALTER TABLE close_appointments
  ADD COLUMN IF NOT EXISTS source_inspection_appointment_id UUID REFERENCES scheduled_appointments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_close_appointments_source_inspection
  ON close_appointments(source_inspection_appointment_id);

COMMENT ON COLUMN close_appointments.source_inspection_appointment_id IS
  'Inspection appointment that preceded this close; scheduled_appointment_id remains the close slot.';
