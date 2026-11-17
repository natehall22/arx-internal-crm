-- Recurring service lines on an online quote (quoteApproval + servicePlans). Additive / nullable only.
--
-- 1. proposal_line_items: a quote line can be tied to a service plan template. `service_plan_template_id` marks the line
--    as RECURRING (it carries no one-time amount: line_total stays 0, unit_price is the plan price), `plan_start_date` is
--    the first day the plan may have a visit and `plan_weekday` (0 = Sunday .. 6) an optional visit day. Seasons,
--    frequency and billing basis always come from the template. NULL on every existing line, so roofing quotes are unchanged.
-- 2. service_plans.quote_line_id: the quote line a plan was made from. Unique, so approving a quote twice (a retry) can
--    never make a second plan for the same line. No foreign key on purpose: the plan must outlive its quote line.
--
-- Deploy: apply BEFORE the code if possible; the code falls back to the old column list when these are missing.
-- Rollback: remove the index and the four columns by hand if ever needed (nothing reads them without the feature switches).

BEGIN;

ALTER TABLE public.proposal_line_items
  ADD COLUMN IF NOT EXISTS service_plan_template_id uuid NULL REFERENCES public.service_plan_templates(id),
  ADD COLUMN IF NOT EXISTS plan_start_date date NULL,
  ADD COLUMN IF NOT EXISTS plan_weekday smallint NULL CHECK (plan_weekday IS NULL OR plan_weekday BETWEEN 0 AND 6);

ALTER TABLE public.service_plans
  ADD COLUMN IF NOT EXISTS quote_line_id uuid NULL;

CREATE UNIQUE INDEX IF NOT EXISTS service_plans_quote_line_id_uniq
  ON public.service_plans (quote_line_id)
  WHERE quote_line_id IS NOT NULL;

COMMIT;
