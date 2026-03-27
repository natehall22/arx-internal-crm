-- When an appointment's closer changes, keep pending inspection feedback prompts on the new closer
-- and clear dismissal so the assignee who should submit feedback can see the prompt.
CREATE OR REPLACE FUNCTION sync_pending_prompt_closer_on_reassignment()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.closer_user_id IS NOT NULL
     AND NEW.closer_user_id IS DISTINCT FROM OLD.closer_user_id
  THEN
    UPDATE pending_status_prompts
    SET
      closer_user_id = NEW.closer_user_id,
      dismissed = false
    WHERE appointment_id = NEW.id
      AND completed = false;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_sync_pending_prompt_closer_on_reassignment ON scheduled_appointments;
CREATE TRIGGER trg_sync_pending_prompt_closer_on_reassignment
  AFTER UPDATE OF closer_user_id ON scheduled_appointments
  FOR EACH ROW
  EXECUTE FUNCTION sync_pending_prompt_closer_on_reassignment();
