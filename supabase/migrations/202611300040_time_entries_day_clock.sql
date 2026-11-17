-- Day clock (2026-11-17): a new time entry kind 'shift' — the whole workday, Start day → End day, with NO job / stop
-- (lawn crews are paid for driving, loading, fuel and dump runs, not only time at a stop). Paid time becomes
-- (shift ∪ work ∪ travel) − breaks (lib/time-tracking.ts paidTime).
--
-- APPLY VIA THE SQL EDITOR — Nathan clicks Run. Not applied by anything else; nothing here is read until the company's
-- `timeTracking` switch is on and a crew uses Start day. Until it is applied the code answers a Start day tap with
-- "The day clock turns on once its database update is applied" (a 'shift' row is refused by the old checks) and every
-- other clock tap works as before.
--
-- Why its own file / how it avoids a long lock: a CHECK can't be edited, only dropped and re-added. Each is re-added
-- NOT VALID (instant: new rows are checked, old rows are not scanned under the lock) and then VALIDATEd afterwards
-- (a scan that only takes a SHARE UPDATE EXCLUSIVE lock, so taps keep working). The one-open-shift index is built in the
-- same short transaction — time_entries is small and the day clock has never been used.
--
-- Additive: old rows already satisfy both new checks (every old row is work / break / equipment with a place).
-- Rollback: (no shift rows may exist) re-run this with the old lists: kind IN ('work','break','equipment') and
--   kind = 'break' OR work_order_id IS NOT NULL OR production_job_id IS NOT NULL; DROP INDEX time_entries_one_open_shift.

BEGIN;
SET LOCAL lock_timeout = '5s';

-- 1. kind: also 'shift'. The inline column check is auto-named time_entries_kind_check; the loop also catches a differently
--    named one (a check that lists the kinds), never the person / equipment-item / order / where checks.
ALTER TABLE public.time_entries DROP CONSTRAINT IF EXISTS time_entries_kind_check;
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.time_entries'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ~ '^CHECK \(\(?kind = ANY'
  LOOP
    EXECUTE format('ALTER TABLE public.time_entries DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE public.time_entries
  ADD CONSTRAINT time_entries_kind_check CHECK (kind IN ('work', 'break', 'equipment', 'shift')) NOT VALID;

-- 2. where: work still needs its stop or job; a break or the day clock does not.
ALTER TABLE public.time_entries DROP CONSTRAINT IF EXISTS time_entries_where;
ALTER TABLE public.time_entries
  ADD CONSTRAINT time_entries_where CHECK (kind IN ('break', 'shift') OR work_order_id IS NOT NULL OR production_job_id IS NOT NULL) NOT VALID;

-- 3. One open day per person: a second phone, a double tap or a replayed offline queue can't start the day twice.
CREATE UNIQUE INDEX IF NOT EXISTS time_entries_one_open_shift ON public.time_entries (org_id, user_id)
  WHERE kind = 'shift' AND ended_at IS NULL AND removed_at IS NULL;

COMMIT;

-- 4. Check the rows that were already there (cheap; run after the block above).
ALTER TABLE public.time_entries VALIDATE CONSTRAINT time_entries_kind_check;
ALTER TABLE public.time_entries VALIDATE CONSTRAINT time_entries_where;
