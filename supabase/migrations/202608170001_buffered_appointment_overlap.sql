-- Make the double-booking guard respect each appointment's own trailing buffer.
--
-- Migration 077 compared raw [scheduled_for, scheduled_for + duration) ranges, so two
-- back-to-back appointments were always accepted no matter what "buffer after slot" was
-- configured in Admin → Scheduling. That let the app layer's buffer be bypassed entirely
-- by anything booking outside the canvass routes (ops screens, admin edits, direct SQL).
--
-- New rule: each appointment reserves [start, end + COALESCE(buffer_after_minutes, 0)).
-- Overlapping those padded ranges is equivalent to requiring
--   gap between consecutive appointments >= the EARLIER one's buffer_after_minutes
-- which is deliberately weaker than the application rule in lib/scheduling-buffer.ts
-- (that one also honors the closer's personal "buffer before"). Keeping the DB check the
-- looser of the two means it can only ever catch what the app missed — it can never
-- reject a slot the picker legitimately offered.
--
-- Legacy rows store NULL buffer_after_minutes and are treated as 0 here, so this cannot
-- retroactively invalidate historical data.

CREATE OR REPLACE FUNCTION prevent_overlapping_scheduled_appointments()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  new_start TIMESTAMPTZ;
  new_end TIMESTAMPTZ;
  conflict_exists BOOLEAN;
  rapid_duplicate_exists BOOLEAN;
  conflict_gap_required INT;
  -- Adjuster meetings resolve to ADJUSTER_MEETING_SCHEDULING_POLICY (rejectOnConflict:
  -- false) in lib/adjuster-meeting.ts — inside sales books them around an adjuster's
  -- availability, not the rep's, and gets a soft conflict_warning instead of a failure.
  -- They already set closer_user_id, so they already reach this trigger; padding their
  -- neighbours would start REJECTING meetings that migration 077 accepted. Buffers are
  -- therefore skipped when the adjuster meeting is the row BEING WRITTEN, so a meeting
  -- itself is never blocked by a neighbour's buffer.
  --
  -- Note this exemption is one-directional: apply_buffers is derived from NEW only, so a
  -- normal appointment written next to an EXISTING adjuster meeting still pads both sides
  -- and can now be rejected where 077 accepted it. That is intended (the rep cannot be in
  -- two places, and the app-layer check blocks it too), and is inert today because the
  -- adjuster-meeting insert path never sets buffer_after_minutes.
  apply_buffers BOOLEAN;
BEGIN
  IF NEW.status NOT IN ('scheduled', 'confirmed') THEN
    RETURN NEW;
  END IF;

  apply_buffers := COALESCE(NEW.appointment_type, '') <> 'adjuster_meeting';

  -- Short server-side throttle for rapid duplicate submits.
  -- Applies only to INSERT and only when lead_id is present.
  IF TG_OP = 'INSERT' AND NEW.lead_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM scheduled_appointments sa
      WHERE sa.lead_id = NEW.lead_id
        AND sa.scheduled_for = NEW.scheduled_for
        AND sa.status IN ('scheduled', 'confirmed')
        AND sa.created_at >= (NOW() - INTERVAL '3 seconds')
    )
    INTO rapid_duplicate_exists;

    IF rapid_duplicate_exists THEN
      RAISE EXCEPTION
        'Rapid duplicate submit blocked: matching appointment was just created'
        USING ERRCODE = '23505';
    END IF;
  END IF;

  new_start := NEW.scheduled_for;
  new_end := NEW.scheduled_for
    + make_interval(mins => COALESCE(NEW.duration_minutes, 60))
    + make_interval(mins => CASE WHEN apply_buffers THEN COALESCE(NEW.buffer_after_minutes, 0) ELSE 0 END);

  SELECT
    TRUE,
    -- The gap is owed by whichever appointment comes first.
    CASE
      WHEN new_start >= sa.scheduled_for + make_interval(mins => COALESCE(sa.duration_minutes, 60))
        THEN COALESCE(sa.buffer_after_minutes, 0)
      ELSE COALESCE(NEW.buffer_after_minutes, 0)
    END
  INTO conflict_exists, conflict_gap_required
  FROM scheduled_appointments sa
  WHERE sa.closer_user_id = NEW.closer_user_id
    AND sa.id <> NEW.id
    AND sa.status IN ('scheduled', 'confirmed')
    AND tstzrange(
      sa.scheduled_for,
      sa.scheduled_for
        + make_interval(mins => COALESCE(sa.duration_minutes, 60))
        + make_interval(mins => CASE WHEN apply_buffers THEN COALESCE(sa.buffer_after_minutes, 0) ELSE 0 END),
      '[)'
    ) && tstzrange(new_start, new_end, '[)')
  LIMIT 1;

  -- Wording keeps the 'Scheduling conflict' / 'overlapping appointment' substrings that
  -- app/api/appointments/[id] and app/api/canvass/lead match on to return a 409.
  IF COALESCE(conflict_exists, FALSE) THEN
    IF COALESCE(conflict_gap_required, 0) > 0 THEN
      RAISE EXCEPTION
        'Scheduling conflict: closer already has an appointment within the required % minute gap',
        conflict_gap_required
        USING ERRCODE = '23P01';
    ELSE
      RAISE EXCEPTION
        'Scheduling conflict: closer already has an overlapping appointment'
        USING ERRCODE = '23P01';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Re-create the trigger so buffer_after_minutes edits also re-run the check.
DROP TRIGGER IF EXISTS trg_prevent_overlapping_scheduled_appointments ON scheduled_appointments;

CREATE TRIGGER trg_prevent_overlapping_scheduled_appointments
BEFORE INSERT OR UPDATE OF
  closer_user_id, scheduled_for, duration_minutes, buffer_after_minutes, status
ON scheduled_appointments
FOR EACH ROW
EXECUTE FUNCTION prevent_overlapping_scheduled_appointments();
