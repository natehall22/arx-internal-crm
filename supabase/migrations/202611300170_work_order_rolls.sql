-- "Not ready — roll" (2026-11-30): how many times a piece of scheduled work has been pushed to a later day, and every move.
--   work_orders.roll_count   nullable int, default 0: later-day moves of this work order (a service visit OR a trade work order).
--   work_order_moves         one row per date change of an already-scheduled work order: from, to, why, who, when.
--   record_work_order_moves  the ONE writer (service role only). The app's existing move writers (applyVisitAction 'move',
--                            bulkShiftVisits, the install-schedule assign writer) call it after the date write; it inserts the log
--                            rows and bumps roll_count in one statement. A move to an EARLIER day is logged but not counted.
-- Additive only: one nullable column, one new table, one new function. No existing row, view or policy is touched.
-- work_order_moves has RLS on and NO policies: only the server (service role) reads or writes it.
--
-- APPLY VIA THE SQL EDITOR before the code is deployed (the code tolerates a missing table/function: it shows no counts and
-- logs nothing, it never fails a move). Rollback: DROP FUNCTION public.record_work_order_moves(uuid, jsonb);
--   DROP TABLE public.work_order_moves; ALTER TABLE public.work_orders DROP COLUMN roll_count;

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS roll_count integer DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.work_order_moves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  work_order_id uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  from_date date,
  to_date date,
  -- 'site_not_ready' | 'weather' | 'builder_asked' | 'other' | NULL (no reason given)
  reason text,
  -- 'roll' = the one-tap button, 'shift' = the rain / hurricane bulk move, 'move' = any other date change
  kind text NOT NULL DEFAULT 'move',
  moved_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  moved_by_sub_id uuid REFERENCES public.sub_contractors(id) ON DELETE SET NULL,
  moved_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS work_order_moves_work_order_idx ON public.work_order_moves (work_order_id, moved_at DESC);
CREATE INDEX IF NOT EXISTS work_order_moves_org_idx ON public.work_order_moves (org_id, moved_at DESC);

ALTER TABLE public.work_order_moves ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.work_order_moves FROM anon, authenticated;

-- p_moves: [{ work_order_id, from_date, to_date, reason, kind, moved_by, moved_by_sub_id }]. Rows whose work order is not in
-- p_org_id are dropped (org scoping lives here too). Returns how many moves were logged.
CREATE OR REPLACE FUNCTION public.record_work_order_moves(p_org_id uuid, p_moves jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  logged integer;
BEGIN
  WITH ins AS (
    INSERT INTO public.work_order_moves (org_id, work_order_id, from_date, to_date, reason, kind, moved_by, moved_by_sub_id)
    SELECT p_org_id, m.work_order_id, m.from_date, m.to_date, m.reason, COALESCE(m.kind, 'move'), m.moved_by, m.moved_by_sub_id
    FROM jsonb_to_recordset(COALESCE(p_moves, '[]'::jsonb)) AS m(
      work_order_id uuid, from_date date, to_date date, reason text, kind text, moved_by uuid, moved_by_sub_id uuid
    )
    JOIN public.work_orders w ON w.id = m.work_order_id AND w.org_id = p_org_id
    RETURNING work_order_id, from_date, to_date
  ), bump AS (
    SELECT work_order_id, count(*)::integer AS n FROM ins WHERE from_date IS NOT NULL AND to_date > from_date GROUP BY work_order_id
  ), upd AS (
    UPDATE public.work_orders w SET roll_count = COALESCE(w.roll_count, 0) + b.n
    FROM bump b WHERE w.id = b.work_order_id AND w.org_id = p_org_id
    RETURNING w.id
  )
  SELECT count(*) INTO logged FROM ins;
  RETURN COALESCE(logged, 0);
END $$;

REVOKE ALL ON FUNCTION public.record_work_order_moves(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_work_order_moves(uuid, jsonb) TO service_role;

COMMIT;
