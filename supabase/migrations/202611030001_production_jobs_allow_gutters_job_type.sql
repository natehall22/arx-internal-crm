-- Allow 'gutters' as a production job type.
-- Gutters-only contracts set job_type = 'gutters' at signing (app/api/contracts/sign/route.ts),
-- which the old check rejected, so the job was never auto-created (e.g. Carann Brown, 11/2026).
-- Additive only: existing values are unchanged. Already applied to production on 2026-11-03.
alter table public.production_jobs drop constraint if exists production_jobs_job_type_check;
alter table public.production_jobs add constraint production_jobs_job_type_check
  check (job_type = any (array['roofing'::text, 'siding'::text, 'windows'::text, 'mixed'::text, 'gutters'::text]));
