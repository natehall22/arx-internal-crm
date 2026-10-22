-- Payroll: real unique indexes so a job (and a job/rep/role) can exist in only ONE
-- payroll period, as a hard constraint rather than only a trigger.
--
-- ORDER: migration 202610210002 -> supabase/data-fixes/20261021_remove_cross_period_duplicate_payouts.sql
--        -> THIS FILE -> deploy app.
-- This fails to build until the data fix has removed the 15 pre-existing duplicate jobs;
-- the check below says so explicitly instead of a bare 23505.
-- Verified read-only on prod 2026-10-21: after the data fix, 0 (org_id, job_id) and
-- 0 (job_id, user_id, participant_role) duplicates would remain (no other duplicates).
--
-- 0002's triggers stay: they serialize concurrent writers on one job (advisory lock),
-- enforce "new pay only in an OPEN period", and raise the payroll_already_paid message
-- the materializer turns into an `already_paid_by_race` skip. Because they run BEFORE
-- INSERT under the advisory lock, a cross-period write hits the trigger first and the
-- index is the backstop (e.g. if the triggers are ever disabled or dropped).
--
-- Tables are small (tens of rows), so a plain CREATE INDEX is fine inside the migration
-- transaction (CONCURRENTLY can't run in one).

DO $$
DECLARE snap_dups bigint; line_dups bigint;
BEGIN
  SELECT count(*) INTO snap_dups FROM (
    SELECT 1 FROM public.payroll_job_snapshots GROUP BY org_id, job_id HAVING count(*) > 1) x;
  SELECT count(*) INTO line_dups FROM (
    SELECT 1 FROM public.payroll_payout_lines GROUP BY job_id, user_id, participant_role HAVING count(*) > 1) x;
  IF snap_dups > 0 OR line_dups > 0 THEN
    RAISE EXCEPTION 'payroll unique indexes: % job(s) / % job-user-role key(s) still in more than one period', snap_dups, line_dups
      USING HINT = 'Run supabase/data-fixes/20261021_remove_cross_period_duplicate_payouts.sql first.';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS payroll_job_snapshots_one_period_per_job
  ON public.payroll_job_snapshots (org_id, job_id);

CREATE UNIQUE INDEX IF NOT EXISTS payroll_payout_lines_one_period_per_job_user_role
  ON public.payroll_payout_lines (job_id, user_id, participant_role);

-- Rollback (touches no data):
--   DROP INDEX IF EXISTS public.payroll_job_snapshots_one_period_per_job;
--   DROP INDEX IF EXISTS public.payroll_payout_lines_one_period_per_job_user_role;
