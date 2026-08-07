-- Retryable record of a failed Google Calendar push.
--
-- Every existing flow treats a Google failure as either fatal (the inspection
-- scheduler deletes the appointment and returns 409) or as an ephemeral warning in
-- the HTTP response that is lost the moment the page reloads. Neither works for an
-- insurance adjuster meeting:
--
--   * The adjuster dictates the time and cannot simply be re-asked, so refusing or
--     deleting a confirmed booking is far worse than a missing calendar entry.
--   * Field reps work out of Google Calendar. A meeting that never reaches their
--     phone is a missed meeting, which delays the claim.
--
-- So the appointment is always persisted, the push is attempted afterwards, and a
-- failure is recorded here so the inside-sales UI can show it and offer a retry
-- instead of it vanishing silently.
--
-- Additive and nullable — payroll and scheduling are live and in daily use. NULL
-- means "no known sync problem", which is the correct reading for every existing row.

ALTER TABLE scheduled_appointments
  ADD COLUMN IF NOT EXISTS google_sync_failed_at TIMESTAMPTZ NULL;

ALTER TABLE scheduled_appointments
  ADD COLUMN IF NOT EXISTS google_sync_error TEXT NULL;

COMMENT ON COLUMN scheduled_appointments.google_sync_failed_at IS
  'When the most recent Google Calendar push for this appointment failed. NULL once '
  'a push succeeds. Drives the "not on the calendar yet" warning and retry action in '
  'the inside-sales queue.';

COMMENT ON COLUMN scheduled_appointments.google_sync_error IS
  'Human-readable reason the last Google Calendar push failed (e.g. the attending rep '
  'has not connected Google). Cleared on a successful push.';

CREATE INDEX IF NOT EXISTS scheduled_appointments_google_sync_failed_idx
  ON scheduled_appointments (org_id, google_sync_failed_at)
  WHERE google_sync_failed_at IS NOT NULL;

SELECT pg_notify('pgrst', 'reload schema');
