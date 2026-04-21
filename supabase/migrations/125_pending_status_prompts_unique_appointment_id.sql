-- create_inspection_status_prompt() inserts into pending_status_prompts with
-- ON CONFLICT (appointment_id) DO NOTHING, which requires a UNIQUE constraint on appointment_id.
-- Some DBs (e.g. from RUN_THIS_MISSING_TABLES.sql) created the table without it, causing:
-- "there is no unique or exclusion constraint matching the ON CONFLICT specification"
-- on every scheduled_appointments INSERT.

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY appointment_id
      ORDER BY created_at ASC NULLS LAST, id ASC
    ) AS rn
  FROM pending_status_prompts
)
DELETE FROM pending_status_prompts p
WHERE p.id IN (SELECT id FROM ranked WHERE rn > 1);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'pending_status_prompts'
      AND indexdef LIKE '%UNIQUE%'
      AND indexdef LIKE '%(appointment_id)%'
  ) THEN
    CREATE UNIQUE INDEX idx_pending_status_prompts_appointment_id_unique
      ON public.pending_status_prompts (appointment_id);
  END IF;
END $$;
