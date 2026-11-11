-- Recurring service: plan templates, service plans, their visits and their change history (Phase 2, 2026-11-11).
-- Additive / nullable only on existing tables.
--
-- 1. service_plan_templates: what a company sells, owner-managed in Settings (nothing about a plan is in code): name,
--    trade, default seasons, billing basis, tax flag, price rules (generic: `pricing` jsonb = the questions asked about a
--    home + tiers with conditions on them + whether a custom price is allowed) and follow-on steps with their own result
--    options (`steps` jsonb; green / yellow / red is only the default). `version` goes up on every save.
-- 2. service_plans: one plan sold to a customer for one property. It COPIES the template at sale (template_id +
--    template_version + its own seasons / pricing / steps / billing / tax), so editing a template never changes a plan
--    already sold; an owner may push a template's changes to its plans on purpose (with a preview). Never hard-deleted:
--    "ended" is a status; paused = status 'paused' + optional resume date.
-- 3. Visits are work_orders rows: work_order_type 'service_visit', visit_step ('service' = the plan's own visit, else a
--    follow-on step's key), service_plan_id, service_planned_date (the generator's slot; scheduled_date = where it sits
--    now). ONE generator (lib/service-plans-db.ts ensureServiceVisits), idempotent on
--    (org_id, service_plan_id, service_planned_date, visit_step). A visit always carries the plan's trade, so the browser
--    RLS rule "only trade IS NULL rows are browser-writable" (202609150002) keeps visits server-write-only. Never
--    scheduled_appointments. New status 'skipped' (needs skip_reason). step_result = a follow-on step's result key
--    (checked by the app against the plan's own options). service_price / service_taxable = snapshots for invoicing.
-- 4. service_plan_changes: who changed a plan or template, when, what (same shape as supplier_audit_log:
--    changes = [{ field, label, old, new }]) and what it did to visits ({ removed, added, updated }).
-- 5. photos.job_id becomes nullable so a visit (no job) can hold photos (work_order_id set; CHECK one of the two).
-- 6. crew_day_links: a crew's phone link (/crew/day/<token>), service-role only — NOT a sub_contractors column, because
--    every signed-in company member can SELECT sub_contractors and the page shows gate codes. Expires (expires_at).
--
-- Deploy: apply AFTER 202611110010 (properties) and BEFORE the code. Nothing reads these unless the company turns on the
-- servicePlans switch (default OFF), so applying it changes nothing for anyone.
-- Rollback (no rows yet): DROP TABLE service_plan_changes, crew_day_links; ALTER TABLE work_orders DROP COLUMN
--   service_plan_id, service_planned_date, service_price, service_taxable, skip_reason, skipped_at, visit_step,
--   parent_visit_id, step_result; DROP TABLE service_plans, service_plan_templates; restore the two CHECKs below to their
--   previous lists; (photos.job_id NOT NULL only once no row has a NULL job_id).

BEGIN;

-- ---- Templates ------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.service_plan_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  trade text NOT NULL,
  description text NULL CHECK (description IS NULL OR char_length(description) <= 2000),
  seasons jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(seasons) = 'array' AND jsonb_array_length(seasons) <= 12),
  billing_basis text NOT NULL DEFAULT 'per_visit' CHECK (billing_basis IN ('per_visit', 'per_month', 'per_year')),
  taxable boolean NOT NULL DEFAULT false,
  pricing jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(pricing) = 'object'),
  steps jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(steps) = 'array' AND jsonb_array_length(steps) <= 5),
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_plan_templates_trade_fkey FOREIGN KEY (org_id, trade) REFERENCES public.org_trades(org_id, slug)
);
CREATE INDEX IF NOT EXISTS service_plan_templates_org_idx ON public.service_plan_templates (org_id, active);
ALTER TABLE public.service_plan_templates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.service_plan_templates FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.service_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES public.properties(id), -- NO ACTION: checked at statement end, so a customer delete cascading both works
  template_id uuid NULL REFERENCES public.service_plan_templates(id) ON DELETE SET NULL,
  template_version integer NULL,
  trade text NOT NULL,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  description text NULL CHECK (description IS NULL OR char_length(description) <= 2000),
  price numeric(10, 2) NULL CHECK (price IS NULL OR (price >= 0 AND price <= 1000000)),
  billing_basis text NOT NULL DEFAULT 'per_visit' CHECK (billing_basis IN ('per_visit', 'per_month', 'per_year')),
  taxable boolean NOT NULL DEFAULT false,
  -- The price rules copied from the template, the answers for this home, and the tier they matched (NULL = custom price).
  pricing jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(pricing) = 'object'),
  pricing_inputs jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(pricing_inputs) = 'object'),
  tier_key text NULL CHECK (tier_key IS NULL OR char_length(tier_key) <= 40),
  -- Follow-on steps copied from the template (e.g. cleaning -> inspection), each with its own result options.
  steps jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(steps) = 'array' AND jsonb_array_length(steps) <= 5),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'ended')),
  start_date date NOT NULL,
  end_date date NULL,
  paused_until date NULL,
  seasons jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(seasons) = 'array' AND jsonb_array_length(seasons) <= 12),
  preferred_weekday smallint NULL CHECK (preferred_weekday IS NULL OR preferred_weekday BETWEEN 0 AND 6),
  default_sub_id uuid NULL REFERENCES public.sub_contractors(id) ON DELETE SET NULL,
  -- Stop number on the crew's day (1 = first). NULL = after the numbered stops, by address.
  route_position integer NULL CHECK (route_position IS NULL OR route_position BETWEEN 1 AND 999),
  ended_at timestamptz NULL,
  created_by uuid NOT NULL REFERENCES public.users(id),
  updated_by uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_plans_dates CHECK (end_date IS NULL OR end_date >= start_date),
  CONSTRAINT service_plans_trade_fkey FOREIGN KEY (org_id, trade) REFERENCES public.org_trades(org_id, slug)
);

CREATE INDEX IF NOT EXISTS service_plans_org_status_idx ON public.service_plans (org_id, status);
CREATE INDEX IF NOT EXISTS service_plans_customer_idx ON public.service_plans (org_id, customer_id);
CREATE INDEX IF NOT EXISTS service_plans_property_idx ON public.service_plans (property_id);
CREATE INDEX IF NOT EXISTS service_plans_template_idx ON public.service_plans (template_id) WHERE template_id IS NOT NULL;

-- Service role only (lib/service-plans-db.ts, behind the job-board / jobs:edit checks). Prices are money.
ALTER TABLE public.service_plans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.service_plans FROM anon, authenticated;

-- Templates and plans: one company's own references only. A real bug if not, so it raises.
CREATE OR REPLACE FUNCTION public.service_plans_before_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.updated_at := now();
    IF NEW.org_id IS DISTINCT FROM OLD.org_id THEN
      RAISE EXCEPTION 'a row cannot move to another company' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'service_plans' THEN
    IF TG_OP = 'UPDATE' AND NEW.customer_id IS DISTINCT FROM OLD.customer_id THEN
      RAISE EXCEPTION 'a service plan cannot move to another customer' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.properties p WHERE p.id = NEW.property_id AND p.org_id = NEW.org_id AND p.customer_id = NEW.customer_id) THEN
      RAISE EXCEPTION 'service plan property is not this customer''s' USING ERRCODE = '42501';
    END IF;
    IF NEW.default_sub_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.sub_contractors s WHERE s.id = NEW.default_sub_id AND s.org_id = NEW.org_id) THEN
      RAISE EXCEPTION 'service plan crew is not in this company' USING ERRCODE = '42501';
    END IF;
    IF NEW.template_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.service_plan_templates t WHERE t.id = NEW.template_id AND t.org_id = NEW.org_id) THEN
      RAISE EXCEPTION 'service plan template is not in this company' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS service_plans_before_write ON public.service_plans;
CREATE TRIGGER service_plans_before_write BEFORE INSERT OR UPDATE ON public.service_plans
  FOR EACH ROW EXECUTE FUNCTION public.service_plans_before_write();
DROP TRIGGER IF EXISTS service_plan_templates_before_write ON public.service_plan_templates;
CREATE TRIGGER service_plan_templates_before_write BEFORE INSERT OR UPDATE ON public.service_plan_templates
  FOR EACH ROW EXECUTE FUNCTION public.service_plans_before_write();

-- ---- Change history (who / when / what; same shape as supplier_audit_log) -------------------------------------------
CREATE TABLE IF NOT EXISTS public.service_plan_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  plan_id uuid NULL REFERENCES public.service_plans(id) ON DELETE CASCADE,
  template_id uuid NULL REFERENCES public.service_plan_templates(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('created', 'updated', 'paused', 'resumed', 'ended', 'template_applied', 'auto_resumed', 'auto_ended')),
  changed_by uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changes jsonb NOT NULL DEFAULT '[]'::jsonb,      -- [{ "field": "price", "label": "Price", "old": 45, "new": 50 }]
  visit_effect jsonb NULL,                         -- { "removed": 2, "added": 3, "updated": 4 }
  CONSTRAINT service_plan_changes_subject CHECK (plan_id IS NOT NULL OR template_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS service_plan_changes_plan_idx ON public.service_plan_changes (plan_id, changed_at DESC) WHERE plan_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS service_plan_changes_template_idx ON public.service_plan_changes (template_id, changed_at DESC) WHERE template_id IS NOT NULL;
ALTER TABLE public.service_plan_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.service_plan_changes FROM anon, authenticated;

-- ---- Visits on work_orders ------------------------------------------------------------------------------------------
-- NO ACTION on delete: plans are never deleted (ended is a status), so a delete that would orphan visit history fails
-- loudly instead (SET NULL would break work_orders_service_visit_shape; CASCADE would erase visits and their photos).
-- The only cascading path is a hard customer delete, which the app never does for a customer with a plan.
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS service_plan_id uuid NULL REFERENCES public.service_plans(id);
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS service_planned_date date NULL;
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS service_price numeric(10, 2) NULL;
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS skip_reason text NULL;
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS skipped_at timestamptz NULL;
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS service_taxable boolean NULL;
-- 'service' = the plan's own visit (made by the generator); otherwise a follow-on step's key from the plan's `steps`.
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS visit_step text NULL;
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS parent_visit_id uuid NULL REFERENCES public.work_orders(id) ON DELETE SET NULL;
-- A follow-on step's result key (the plan's own options; green / yellow / red by default — lib/health-result.ts).
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS step_result text NULL;

-- Widen (never narrow) the two lists. Prod today (checked 2026-11-11): text columns with these CHECKs.
ALTER TABLE public.work_orders DROP CONSTRAINT IF EXISTS work_orders_work_order_type_check;
ALTER TABLE public.work_orders ADD CONSTRAINT work_orders_work_order_type_check CHECK (work_order_type IN
  ('go_back', 'repair', 'warranty', 'punch_list', 'inspection', 'install', 'service_call', 'service_visit'));
ALTER TABLE public.work_orders DROP CONSTRAINT IF EXISTS work_orders_status_check;
ALTER TABLE public.work_orders ADD CONSTRAINT work_orders_status_check CHECK (status IN
  ('pending', 'assigned', 'scheduled', 'in_progress', 'completed', 'cancelled', 'on_hold', 'skipped'));

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_orders_skip_reason_check') THEN
    ALTER TABLE public.work_orders ADD CONSTRAINT work_orders_skip_reason_check
      CHECK (skip_reason IS NULL OR skip_reason IN ('rain', 'customer', 'holiday', 'other'));
  END IF;
  -- A visit is a plan's, carries a trade (server-write-only under RLS), a planned slot and a step; only visits may be
  -- skipped; the plan's own visit never carries a result (follow-on results are checked by the app against the plan).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_orders_service_visit_shape') THEN
    ALTER TABLE public.work_orders ADD CONSTRAINT work_orders_service_visit_shape CHECK (
      (work_order_type <> 'service_visit' AND service_plan_id IS NULL AND status <> 'skipped' AND visit_step IS NULL AND step_result IS NULL)
      OR (work_order_type = 'service_visit' AND service_plan_id IS NOT NULL AND trade IS NOT NULL
          AND service_planned_date IS NOT NULL AND job_id IS NULL
          AND visit_step ~ '^[a-z][a-z0-9_]{0,39}$'
          AND (status <> 'skipped' OR skip_reason IS NOT NULL)
          AND (visit_step <> 'service' OR step_result IS NULL)
          AND (step_result IS NULL OR char_length(step_result) <= 40))
    );
  END IF;
END $$;

-- The generator's idempotency key (one service visit and at most one follow-on per planned slot). org_id first so the
-- org-scope rule (upserts carry org_id) holds; NULL plan ids (every non-visit row) never conflict.
CREATE UNIQUE INDEX IF NOT EXISTS work_orders_service_slot_key
  ON public.work_orders (org_id, service_plan_id, service_planned_date, visit_step);
CREATE INDEX IF NOT EXISTS work_orders_service_visits_day_idx
  ON public.work_orders (org_id, scheduled_date) WHERE work_order_type = 'service_visit';

-- A visit's plan is this company's (the FK alone does not check the company).
CREATE OR REPLACE FUNCTION public.work_orders_service_plan_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.service_plan_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.service_plan_id IS DISTINCT FROM OLD.service_plan_id)
     AND NOT EXISTS (SELECT 1 FROM public.service_plans sp WHERE sp.id = NEW.service_plan_id AND sp.org_id = NEW.org_id) THEN
    RAISE EXCEPTION 'service plan % is not in this company', NEW.service_plan_id USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS work_orders_service_plan_guard ON public.work_orders;
CREATE TRIGGER work_orders_service_plan_guard BEFORE INSERT OR UPDATE OF service_plan_id ON public.work_orders
  FOR EACH ROW EXECUTE FUNCTION public.work_orders_service_plan_guard();

-- ---- Visit photos -----------------------------------------------------------------------------------------------------
ALTER TABLE public.photos ALTER COLUMN job_id DROP NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'photos_job_or_work_order') THEN
    ALTER TABLE public.photos ADD CONSTRAINT photos_job_or_work_order CHECK (job_id IS NOT NULL OR work_order_id IS NOT NULL);
  END IF;
END $$;

-- ---- Crew phone link ------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.crew_day_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  sub_id uuid NOT NULL REFERENCES public.sub_contractors(id) ON DELETE CASCADE,
  token text NOT NULL CHECK (char_length(token) BETWEEN 32 AND 64),
  created_by uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- A link stops working on its own after this (the app sets it; replacing the link sets a new one).
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 days',
  CONSTRAINT crew_day_links_sub_key UNIQUE (org_id, sub_id),
  CONSTRAINT crew_day_links_token_key UNIQUE (token)
);
ALTER TABLE public.crew_day_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crew_day_links FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.crew_day_links_same_org() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.sub_contractors s WHERE s.id = NEW.sub_id AND s.org_id = NEW.org_id) THEN
    RAISE EXCEPTION 'crew is not in this company' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS crew_day_links_same_org ON public.crew_day_links;
CREATE TRIGGER crew_day_links_same_org BEFORE INSERT OR UPDATE ON public.crew_day_links
  FOR EACH ROW EXECUTE FUNCTION public.crew_day_links_same_org();

COMMIT;
