-- Inspection feedback dashboard popup: fire at appointment *start* (scheduled_for), not after slot end + buffers.
-- prompt_at is stored as timestamptz (absolute instant); UI compares with now() in UTC.

CREATE OR REPLACE FUNCTION create_inspection_status_prompt()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.closer_user_id IS NULL THEN
      RETURN NEW;
    END IF;

    INSERT INTO pending_status_prompts (
      org_id,
      appointment_id,
      closer_user_id,
      prompt_at
    ) VALUES (
      NEW.org_id,
      NEW.id,
      NEW.closer_user_id,
      NEW.scheduled_for
    )
    ON CONFLICT (appointment_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION create_inspection_status_prompt() IS 'Queues pending_status_prompts.prompt_at at appointment start (scheduled_for).';

COMMENT ON COLUMN orgs.inspection_feedback_buffer_minutes IS 'Legacy: was added after slot end for prompt timing; app now prompts at appointment start. May be reused later.';

COMMENT ON COLUMN scheduled_appointments.buffer_after_minutes IS 'Minutes after slot end for scheduling / conflict checks; not used for feedback prompt time (prompt is at scheduled_for).';

COMMENT ON COLUMN appointment_types.buffer_after_minutes IS 'Default buffer after slot end for new appointments (scheduling gaps); not used for feedback prompt time.';

-- Align open prompts with current appointment start (fixes rows created under old trigger)
UPDATE pending_status_prompts p
SET prompt_at = s.scheduled_for
FROM scheduled_appointments s
WHERE s.id = p.appointment_id
  AND p.completed = false
  AND p.dismissed = false;
