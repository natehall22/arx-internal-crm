-- Org-level defaults for feedback timing and scheduling gaps (editable in Admin → Appointment settings)
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS inspection_feedback_buffer_minutes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS default_scheduling_gap_minutes INTEGER NOT NULL DEFAULT 15;

COMMENT ON COLUMN orgs.inspection_feedback_buffer_minutes IS 'Extra minutes after appointment end before the closer feedback prompt becomes due (added to duration + per-appointment buffer).';
COMMENT ON COLUMN orgs.default_scheduling_gap_minutes IS 'Default gap between appointments when closer-specific buffers are not set (round-robin / DB conflict checks).';

-- Optional per-appointment buffer (from appointment type "buffer after" or org default)
ALTER TABLE scheduled_appointments ADD COLUMN IF NOT EXISTS buffer_after_minutes INTEGER NULL;

COMMENT ON COLUMN scheduled_appointments.buffer_after_minutes IS 'Minutes after slot end toward feedback prompt timing; NULL treated as 0 in trigger.';

-- Prompt fires after: scheduled_for + duration + buffer_after + org.inspection_feedback_buffer
CREATE OR REPLACE FUNCTION create_inspection_status_prompt()
RETURNS TRIGGER AS $$
DECLARE
  v_dur int;
  v_row_buf int;
  v_org_fb int;
  v_total int;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.closer_user_id IS NULL THEN
      RETURN NEW;
    END IF;

    v_dur := COALESCE(NEW.duration_minutes, 60);
    v_row_buf := COALESCE(NEW.buffer_after_minutes, 0);

    SELECT COALESCE(
      (SELECT o.inspection_feedback_buffer_minutes FROM orgs o WHERE o.id = NEW.org_id),
      0
    ) INTO v_org_fb;

    v_total := v_dur + v_row_buf + v_org_fb;

    INSERT INTO pending_status_prompts (
      org_id,
      appointment_id,
      closer_user_id,
      prompt_at
    ) VALUES (
      NEW.org_id,
      NEW.id,
      NEW.closer_user_id,
      NEW.scheduled_for + (v_total * INTERVAL '1 minute')
    )
    ON CONFLICT (appointment_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
