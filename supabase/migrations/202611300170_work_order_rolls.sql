-- "Not ready — roll" (2026-11-30): the move log of scheduled work.
--   work_order_moves         one row per date change of an already-scheduled work order (service visit or trade work order):
--                            from, to, why, who, when. It is the ONLY source of "Rolled N×": a roll is a row with kind = 'roll'
--                            (the one-tap "Not ready" button). Rain shifts ('shift'), office drags and Move-sheet moves ('move')
--                            stay here as history and are NOT counted. There is no counter column to drift or to write from a browser.
--   record_work_order_moves  the ONE writer (service role only). The app's existing move writers (applyVisitAction 'move',
--                            bulkShiftVisits, the install-schedule assign writer) call it after the date write succeeded.
-- Additive only: one new table, one new function. No existing row, view or policy is touched.
-- RLS is on with NO policies and no grants to anon / authenticated: only the server (service role) reads or writes it.
--
-- APPLY VIA THE SQL EDITOR before the code is deployed (the code tolerates a missing table/function: it shows no counts and
-- logs nothing, it never fails a move). Rollback: DROP FUNCTION public.record_work_order_moves(uuid, jsonb); DROP TABLE public.work_order_moves;

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.work_order_moves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  work_order_id uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  from_date date,
  to_date date,
  reason text CHECK (reason IS NULL OR reason IN ('site_not_ready', 'weather', 'builder_asked', 'other')),
  -- 'roll' = the one-tap "Not ready" button (counted), 'shift' = the rain / hurricane bulk move, 'move' = any other date change
  kind text NOT NULL DEFAULT 'move' CHECK (kind IN ('roll', 'shift', 'move')),
  moved_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  moved_by_sub_id uuid REFERENCES public.sub_contractors(id) ON DELETE SET NULL,
  moved_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS work_order_moves_work_order_idx ON public.work_order_moves (work_order_id, moved_at DESC);
CREATE INDEX IF NOT EXISTS work_order_moves_org_idx ON public.work_order_moves (org_id, moved_at DESC);
CREATE INDEX IF NOT EXISTS work_order_moves_rolls_idx ON public.work_order_moves (work_order_id) WHERE kind = 'roll';

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
    RETURNING 1
  )
  SELECT count(*) INTO logged FROM ins;
  RETURN COALESCE(logged, 0);
END $$;

REVOKE ALL ON FUNCTION public.record_work_order_moves(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_work_order_moves(uuid, jsonb) TO service_role;

COMMIT;
