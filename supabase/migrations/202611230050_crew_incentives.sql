-- Crew incentives (2026-11-23): automatic crew bonus rules that FEED the existing bonus approval (payroll_bonus_lines,
-- pending_approval -> approved -> paid). Additive only. Nothing is read unless a lawn_landscape company turns on
-- orgs.settings.crewIncentives.enabled, so applying this changes nothing for anyone (ARX included).
--
-- 1. payroll_bonus_lines.source_key (nullable) + unique (org_id, source_key): a bonus is proposed ONCE per rule and visit
--    (or crew-week) and person, ever (a rejected line keeps its key, so it is never proposed again).
-- 2. bonus_type check widened with the five crew rule types.
-- 3. amount check: negative only for the crew deduction (a callback takes money back through the same approval).
-- 4. crew_visit_marks: staff marks on a visit / work order ("review named the crew", "callback or redo"). Service role only.
-- 5. crew_deduction_cap (owner decision, 2026-11): a crew deduction takes back BONUS money only. Within a pay week a person's
--    crew deductions can bring their crew-bonus total down to $0 and no lower; what is left over is dropped, not carried, and
--    the line says "Deduction limited to bonuses earned this week". Enforced HERE, on the stored line, so every reader of a
--    week's total (composeWeek, payroll_week_person_totals, the fake mirror, the ADP/Gusto export, statements) sees the same
--    amount and no total path needs to know about it. BEFORE trigger: any insert / approve / week move of a deduction is capped
--    against the person's crew bonuses (pending + approved + paid) in that week minus their other deductions. AFTER trigger:
--    when a crew bonus is rejected, moved or deleted, that person's deductions in the week it left are re-capped.
--    (The app also caps at proposal time to write the reason; this is the backstop. Known Redundancy 46.)
-- Apply BEFORE the code. Rollback (no rows yet): DROP TRIGGER crew_deduction_recap_trg ON payroll_bonus_lines; DROP TRIGGER crew_deduction_cap_trg ON payroll_bonus_lines; DROP FUNCTION crew_deduction_recap(); DROP FUNCTION crew_deduction_cap(); DROP TABLE crew_visit_marks; DROP INDEX payroll_bonus_lines_source_key_uniq;
--   ALTER TABLE payroll_bonus_lines DROP COLUMN source_key; restore the two checks from 202607140001 / 202506090001.

SET LOCAL lock_timeout = '5s';

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

-- 5. The deduction cap ------------------------------------------------------------------------------------------------------
-- crew-deduction-cap:begin (the payroll SQL test loads exactly this section)
CREATE OR REPLACE FUNCTION public.crew_deduction_cap() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_pos numeric; v_other numeric; v_room numeric; v_want numeric;
BEGIN
  IF NEW.bonus_type <> 'crew_deduction' OR NEW.status NOT IN ('pending_approval', 'approved', 'paid') THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('crew_deduction_cap:' || NEW.payroll_period_id::text || ':' || NEW.user_id::text));
  SELECT COALESCE(sum(amount), 0) INTO v_pos FROM public.payroll_bonus_lines
   WHERE org_id = NEW.org_id AND payroll_period_id = NEW.payroll_period_id AND user_id = NEW.user_id
     AND bonus_type IN ('crew_done_right', 'crew_beat_time', 'crew_review', 'crew_weekly_target')
     AND status IN ('pending_approval', 'approved', 'paid');
  SELECT COALESCE(-sum(amount), 0) INTO v_other FROM public.payroll_bonus_lines
   WHERE org_id = NEW.org_id AND payroll_period_id = NEW.payroll_period_id AND user_id = NEW.user_id
     AND bonus_type = 'crew_deduction' AND status IN ('pending_approval', 'approved', 'paid') AND id IS DISTINCT FROM NEW.id;
  v_room := GREATEST(v_pos - v_other, 0);
  v_want := -NEW.amount;
  IF v_want > v_room THEN
    NEW.amount := -v_room;
    IF COALESCE(NEW.description, '') NOT LIKE '%Deduction limited to bonuses earned this week%' THEN
      NEW.description := COALESCE(NEW.description, 'Callback or redo') || ' — Deduction limited to bonuses earned this week';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS crew_deduction_cap_trg ON public.payroll_bonus_lines;
CREATE TRIGGER crew_deduction_cap_trg BEFORE INSERT OR UPDATE OF status, payroll_period_id, amount ON public.payroll_bonus_lines
  FOR EACH ROW WHEN (NEW.bonus_type = 'crew_deduction') EXECUTE FUNCTION public.crew_deduction_cap();

CREATE OR REPLACE FUNCTION public.crew_deduction_recap() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- A crew bonus left (rejected / moved to another week / deleted): touch that person's deductions in the week it left so
  -- the BEFORE trigger caps them again (it only ever lowers an amount).
  IF TG_OP = 'DELETE' OR NEW.status IS DISTINCT FROM OLD.status OR NEW.payroll_period_id IS DISTINCT FROM OLD.payroll_period_id THEN
    UPDATE public.payroll_bonus_lines SET amount = amount
     WHERE org_id = OLD.org_id AND payroll_period_id = OLD.payroll_period_id AND user_id = OLD.user_id
       AND bonus_type = 'crew_deduction' AND status IN ('pending_approval', 'approved', 'paid');
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS crew_deduction_recap_trg ON public.payroll_bonus_lines;
CREATE TRIGGER crew_deduction_recap_trg AFTER UPDATE OF status, payroll_period_id OR DELETE ON public.payroll_bonus_lines
  FOR EACH ROW WHEN (OLD.bonus_type IN ('crew_done_right', 'crew_beat_time', 'crew_review', 'crew_weekly_target')) EXECUTE FUNCTION public.crew_deduction_recap();
-- crew-deduction-cap:end
