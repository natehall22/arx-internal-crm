-- An appointment closed out as "outcome not recorded" is only that while it stays as it was: if it is rescheduled or its
-- status changes (an outcome is logged, it is cancelled…), the mark is cleared automatically, in one place, whoever writes.
CREATE OR REPLACE FUNCTION clear_closeout_mark_on_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.outcome_not_recorded_at IS NOT NULL
     AND OLD.outcome_not_recorded_at IS NOT DISTINCT FROM NEW.outcome_not_recorded_at
     AND (NEW.scheduled_for IS DISTINCT FROM OLD.scheduled_for OR NEW.status IS DISTINCT FROM OLD.status) THEN
    NEW.outcome_not_recorded_at := NULL;
    NEW.outcome_not_recorded_by := NULL;
    NEW.outcome_not_recorded_batch := NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_clear_closeout_mark_on_change ON scheduled_appointments;
CREATE TRIGGER trg_clear_closeout_mark_on_change
BEFORE UPDATE OF scheduled_for, status ON scheduled_appointments
FOR EACH ROW EXECUTE FUNCTION clear_closeout_mark_on_change();
-- Rollback: DROP TRIGGER trg_clear_closeout_mark_on_change ON scheduled_appointments; DROP FUNCTION clear_closeout_mark_on_change();
