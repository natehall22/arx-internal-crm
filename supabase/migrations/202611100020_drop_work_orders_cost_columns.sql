-- APPLY ONE RELEASE AFTER THIS CODE SHIPS.
--
-- work_orders.estimated_cost / actual_cost were never used: 0 non-null rows in prod (checked 2026-11-06,
-- 21 rows), no view or function depends on them, and the only code reference was the WorkOrder type
-- (lib/types/database.ts), removed in the same change. Job cost lives in job_cost_lines (one ledger).
--
-- Applying this BEFORE the code ships is also safe (nothing selects or writes these columns), but the
-- rule is one release of soak so a stray reader shows up in logs first.

ALTER TABLE public.work_orders DROP COLUMN IF EXISTS estimated_cost;
ALTER TABLE public.work_orders DROP COLUMN IF EXISTS actual_cost;
