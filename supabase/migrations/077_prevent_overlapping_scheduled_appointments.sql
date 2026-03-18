-- Prevent double/triple-booking caused by overlapping or duplicate inserts.
-- Trigger enforces overlap prevention; unique index enforces idempotency
-- for same lead + same slot active appointments.

CREATE OR REPLACE FUNCTION prevent_overlapping_scheduled_appointments()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  new_start TIMESTAMPTZ;
  new_end TIMESTAMPTZ;
  conflict_exists BOOLEAN;
  rapid_duplicate_exists BOOLEAN;
BEGIN
  IF NEW.status NOT IN ('scheduled', 'confirmed') THEN
    RETURN NEW;
  END IF;

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
  new_end := NEW.scheduled_for + make_interval(mins => COALESCE(NEW.duration_minutes, 60));

  SELECT EXISTS (
    SELECT 1
    FROM scheduled_appointments sa
    WHERE sa.closer_user_id = NEW.closer_user_id
      AND sa.id <> NEW.id
      AND sa.status IN ('scheduled', 'confirmed')
      AND tstzrange(
        sa.scheduled_for,
        sa.scheduled_for + make_interval(mins => COALESCE(sa.duration_minutes, 60)),
        '[)'
      ) && tstzrange(new_start, new_end, '[)')
  )
  INTO conflict_exists;

  IF conflict_exists THEN
    RAISE EXCEPTION
      'Scheduling conflict: closer already has an overlapping appointment'
      USING ERRCODE = '23P01';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_overlapping_scheduled_appointments ON scheduled_appointments;

CREATE TRIGGER trg_prevent_overlapping_scheduled_appointments
BEFORE INSERT OR UPDATE OF closer_user_id, scheduled_for, duration_minutes, status
ON scheduled_appointments
FOR EACH ROW
EXECUTE FUNCTION prevent_overlapping_scheduled_appointments();

-- One-time cleanup for existing duplicate active appointments so unique index can be created.
-- Keep the best candidate (prefer one with a Google event), cancel the rest.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY lead_id, scheduled_for
      ORDER BY (google_event_id IS NOT NULL) DESC, created_at ASC, id ASC
    ) AS rn
  FROM scheduled_appointments
  WHERE lead_id IS NOT NULL
    AND status IN ('scheduled', 'confirmed')
),
duplicates AS (
  SELECT id
  FROM ranked
  WHERE rn > 1
)
UPDATE scheduled_appointments sa
SET
  status = 'cancelled',
  notes = TRIM(BOTH ' ' FROM CONCAT('[Auto-cancelled duplicate during migration 077] ', COALESCE(sa.notes, ''))),
  updated_at = NOW()
FROM duplicates d
WHERE sa.id = d.id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sched_appt_unique_active_lead_slot
ON scheduled_appointments (lead_id, scheduled_for)
WHERE lead_id IS NOT NULL AND status IN ('scheduled', 'confirmed');
