-- production_jobs.job_type: allow 'gutters'.
-- The code has always written 'gutters' for a gutters-only contract (and lib/job-trades.ts maps it to the gutters crew), but the CHECK
-- only allowed roofing | siding | windows | mixed, so the insert failed silently and the signed contract got no job (26-10-21 Carann Brown).
-- Widening only: every existing row still satisfies it.
ALTER TABLE public.production_jobs DROP CONSTRAINT IF EXISTS production_jobs_job_type_check;
ALTER TABLE public.production_jobs
  ADD CONSTRAINT production_jobs_job_type_check
  CHECK (job_type = ANY (ARRAY['roofing'::text, 'siding'::text, 'gutters'::text, 'windows'::text, 'mixed'::text]));
