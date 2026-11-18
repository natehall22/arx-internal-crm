-- Day clock (2026-11-17): remember WHEN an approval began. `lock_claimed_at` is cleared when the week commits, so the time
-- clock could not tell which time was recorded before vs after the approval (late-recorded ends carry into the next open week).
-- A trigger copies each new claim time into a new nullable column; payroll_commit_week and the claim code are untouched.
--
-- APPLY VIA THE SQL EDITOR — Nathan clicks Run. Additive: one nullable column + one trigger. Until applied, the code falls
-- back to the lock time. Rollback: DROP TRIGGER payroll_periods_keep_claim_time ON public.payroll_periods;
--   DROP FUNCTION public.payroll_periods_keep_claim_time(); ALTER TABLE public.payroll_periods DROP COLUMN approval_claimed_at;

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.payroll_periods ADD COLUMN IF NOT EXISTS approval_claimed_at timestamptz;

CREATE OR REPLACE FUNCTION public.payroll_periods_keep_claim_time() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.lock_claimed_at IS NOT NULL AND NEW.lock_claimed_at IS DISTINCT FROM OLD.lock_claimed_at THEN
    NEW.approval_claimed_at := NEW.lock_claimed_at;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS payroll_periods_keep_claim_time ON public.payroll_periods;
CREATE TRIGGER payroll_periods_keep_claim_time
  BEFORE UPDATE OF lock_claimed_at ON public.payroll_periods
  FOR EACH ROW EXECUTE FUNCTION public.payroll_periods_keep_claim_time();

COMMIT;
