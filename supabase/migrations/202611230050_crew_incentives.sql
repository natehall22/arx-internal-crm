-- Crew incentives (2026-11-23): automatic crew bonus rules that FEED the existing bonus approval (payroll_bonus_lines,
-- pending_approval -> approved -> paid). Additive only. Nothing is read unless a lawn_landscape company turns on
-- orgs.settings.crewIncentives.enabled, so applying this changes nothing for anyone (ARX included).
--
-- 1. payroll_bonus_lines.source_key (nullable) + unique (org_id, source_key): a bonus is proposed ONCE per rule and visit
--    (or crew-week) and person, ever (a rejected line keeps its key, so it is never proposed again).
-- 2. bonus_type check widened with the five crew rule types.
-- 3. amount check: negative only for the crew deduction (a callback takes money back through the same approval).
-- 4. crew_visit_marks: staff marks on a visit / work order ("review named the crew", "callback or redo"). Service role only.
-- Apply BEFORE the code. Rollback (no rows yet): DROP TABLE crew_visit_marks; DROP INDEX payroll_bonus_lines_source_key_uniq;
--   ALTER TABLE payroll_bonus_lines DROP COLUMN source_key; restore the two checks from 202607140001 / 202506090001.

ALTER TABLE public.payroll_bonus_lines ADD COLUMN IF NOT EXISTS source_key text NULL;
CREATE UNIQUE INDEX IF NOT EXISTS payroll_bonus_lines_source_key_uniq
  ON public.payroll_bonus_lines (org_id, source_key) WHERE source_key IS NOT NULL;

ALTER TABLE public.payroll_bonus_lines DROP CONSTRAINT IF EXISTS payroll_bonus_lines_bonus_type_check;
ALTER TABLE public.payroll_bonus_lines ADD CONSTRAINT payroll_bonus_lines_bonus_type_check
  CHECK (bonus_type IN ('444_week1', '444_week2', 'setter_weekly_floor', 'manual',
    'crew_done_right', 'crew_beat_time', 'crew_review', 'crew_weekly_target', 'crew_deduction'));

ALTER TABLE public.payroll_bonus_lines DROP CONSTRAINT IF EXISTS payroll_bonus_lines_amount_check;
ALTER TABLE public.payroll_bonus_lines ADD CONSTRAINT payroll_bonus_lines_amount_check
  CHECK (amount >= 0 OR bonus_type = 'crew_deduction');

CREATE TABLE IF NOT EXISTS public.crew_visit_marks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  work_order_id uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('review', 'callback')),
  marked_by uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,
  marked_at timestamptz NOT NULL DEFAULT now(),
  -- Set when the rules have turned this mark into lines; an un-mark is refused after that (reject the line instead).
  proposed_at timestamptz NULL,
  CONSTRAINT crew_visit_marks_once UNIQUE (org_id, work_order_id, kind)
);
CREATE INDEX IF NOT EXISTS crew_visit_marks_recent_idx ON public.crew_visit_marks (org_id, marked_at DESC);
ALTER TABLE public.crew_visit_marks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crew_visit_marks FROM anon, authenticated;
