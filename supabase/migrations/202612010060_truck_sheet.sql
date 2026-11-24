-- Truck sheet (the crew's "Today's sheet" PDF gets a load list, machines and the office's note for the day).
-- Additive and nullable only; nothing existing changes. Apply BEFORE the code (the code tolerates the columns / table being absent
-- and shows nothing for them, but a save of machines or a note says "needs a database update" until this is applied).
--  1. service_plans.equipment_item_ids: price-book items (unit 'hour', the same set the time clock offers) a plan's visits use by default.
--  2. work_orders.equipment_item_ids: one visit's own list. NULL = use the plan's; an empty array = "no machines for this visit".
--  3. crew_day_notes: the office's note to a crew for one day. Crew-visible by design. Service role only (RLS on, no policies).
-- Rollback (nothing depends on them): DROP TABLE public.crew_day_notes; ALTER TABLE public.work_orders DROP COLUMN equipment_item_ids;
--   ALTER TABLE public.service_plans DROP COLUMN equipment_item_ids;

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.service_plans ADD COLUMN IF NOT EXISTS equipment_item_ids uuid[] NULL;
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS equipment_item_ids uuid[] NULL;

CREATE TABLE IF NOT EXISTS public.crew_day_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  sub_id uuid NOT NULL REFERENCES public.sub_contractors(id) ON DELETE CASCADE,
  day date NOT NULL,
  note text NOT NULL CHECK (char_length(note) BETWEEN 1 AND 1000),
  updated_by uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crew_day_notes_once UNIQUE (org_id, sub_id, day)
);
ALTER TABLE public.crew_day_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crew_day_notes FROM anon, authenticated;
