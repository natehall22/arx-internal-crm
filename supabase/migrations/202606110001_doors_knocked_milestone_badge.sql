-- Weekly doors milestone badge (e.g. 400 doors in the current Sisu week)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'doors_knocked_milestone'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'badge_criteria_type')
  ) THEN
    ALTER TYPE badge_criteria_type ADD VALUE 'doors_knocked_milestone';
  END IF;
END $$;
