-- Make every scheduled inspection/follow-up visit create a closer feedback prompt.

DROP TRIGGER IF EXISTS create_status_prompt_on_appointment ON scheduled_appointments;
CREATE TRIGGER create_status_prompt_on_appointment
  AFTER INSERT ON scheduled_appointments
  FOR EACH ROW
  EXECUTE FUNCTION create_inspection_status_prompt();
