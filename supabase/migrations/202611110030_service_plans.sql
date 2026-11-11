-- Recurring service: service plans + their visits (Phase 2, 2026-11-11). Additive / nullable only.
--
-- 1. service_plans: one recurring agreement for a customer's property (weekly lawn care, monthly pool, ...). The
--    schedule is a list of seasons (`seasons` jsonb: [{ "from": "MM-DD", "to": "MM-DD", "frequency": "weekly" }, ...];
--    a season may wrap the new year, e.g. 12-01 → 02-28), a preferred weekday and a default crew. Never hard-deleted:
--    "ended" is a status. Paused = status 'paused' with an optional resume date (`paused_until`).
--    Pricing: `price_tier` 'standard' (the company's standard price, only when the home fits its rule — stories /
--    pitch, orgs.settings.servicePlans.standardTier, lib/service-plans.ts standardTierCheck) or 'custom' (any price).
--    `taxable`: whether the plan's charge carries sales tax (NC roof cleaning labor: yes; FL lawn care: no). Billing
--    basis per visit / month / year. Optional follow-on step after each visit (`follow_up` 'inspection', N days later,
--    by one staff person) — e.g. ARX Care: a sub's gutter/roof cleaning, then an inspector's green/yellow/red visit.
-- 2. Visits are work_orders rows: work_order_type 'service_visit', service_plan_id, service_planned_date (the slot the
--    generator planned; scheduled_date is where the visit actually sits after a move). ONE generator creates them
--    (lib/service-plans-db.ts ensureServiceVisits), idempotent on (org_id, service_plan_id, service_planned_date).
--    A visit always carries the plan's trade, so the browser RLS rule "only trade IS NULL rows are browser-writable"
--    (202609150002) keeps visits server-write-only. Visits are never scheduled_appointments.
--    Status: 'scheduled' → 'completed' (done) | 'skipped' (skip_reason) | 'cancelled'. 'skipped' is new.
--    service_price = the plan price per visit at the time the visit was planned (NULL for per-month plans); the later
--    invoicing builder reads completed visits + this snapshot, so a price change never rewrites history.
-- 3. photos.job_id becomes nullable so a visit (no job) can hold its photos (work_order_id set). Every existing reader
--    filters photos by job_id or by a trade's work_order_id, so a job-less photo is invisible to them.
-- 4. crew_day_links: a crew's phone link to "today's visits" (/crew/day/<token>), one per crew, rotated by ops. Its own
--    service-role-only table, NOT a sub_contractors column: every signed-in company member can SELECT sub_contractors
--    (policy "Users can view sub_contractors in their org"), and the link shows gate codes.
--
-- Deploy: apply AFTER 202611110010 (properties) and BEFORE the code. The code only reads these when the company has
-- the servicePlans feature switch on (default OFF), so applying it changes nothing for anyone.
-- Rollback (no visit rows yet): DROP TABLE public.service_plans CASCADE; ALTER TABLE public.work_orders DROP COLUMN
--   service_plan_id, service_planned_date, service_price, service_taxable, skip_reason, skipped_at, visit_step,
--   parent_visit_id, health_result (DROP COLUMN each); restore the two CHECKs below to their previous lists; DROP TABLE public.crew_day_links;
--   (photos.job_id NOT NULL only once no row has a NULL job_id).

BEGIN;

CREATE TABLE IF NOT EXISTS public.service_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES public.properties(id), -- NO ACTION: checked at statement end, so a customer delete cascading both works
  trade text NOT NULL,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  description text NULL CHECK (description IS NULL OR char_length(description) <= 2000),
  price numeric(10, 2) NULL CHECK (price IS NULL OR (price >= 0 AND price <= 1000000)),
  billing_basis text NOT NULL DEFAULT 'per_visit' CHECK (billing_basis IN ('per_visit', 'per_month', 'per_year')),
  price_tier text NOT NULL DEFAULT 'custom' CHECK (price_tier IN ('standard', 'custom')),
  taxable boolean NOT NULL DEFAULT false,
  -- What the standard-tier rule was checked against (both NULL = not recorded; a custom price needs neither).
  stories smallint NULL CHECK (stories IS NULL OR stories BETWEEN 1 AND 10),
  pitch_rise numeric(4, 1) NULL CHECK (pitch_rise IS NULL OR pitch_rise BETWEEN 0 AND 24),
  follow_up text NULL CHECK (follow_up IS NULL OR follow_up IN ('inspection')),
  follow_up_days smallint NULL CHECK (follow_up_days IS NULL OR follow_up_days BETWEEN 0 AND 30),
  follow_up_user_id uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,
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
  CONSTRAINT service_plans_follow_up_shape CHECK (follow_up IS NULL OR follow_up_days IS NOT NULL),
  CONSTRAINT service_plans_trade_fkey FOREIGN KEY (org_id, trade) REFERENCES public.org_trades(org_id, slug)
);

CREATE INDEX IF NOT EXISTS service_plans_org_status_idx ON public.service_plans (org_id, status);
CREATE INDEX IF NOT EXISTS service_plans_customer_idx ON public.service_plans (org_id, customer_id);
CREATE INDEX IF NOT EXISTS service_plans_property_idx ON public.service_plans (property_id);

-- Service role only (lib/service-plans-db.ts, behind the job-board / jobs:edit checks). Prices are money.
ALTER TABLE public.service_plans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.service_plans FROM anon, authenticated;

-- Same company, and the property is this customer's; the crew is this company's. A real bug if not, so it raises.
CREATE OR REPLACE FUNCTION public.service_plans_before_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.updated_at := now();
    IF NEW.org_id IS DISTINCT FROM OLD.org_id OR NEW.customer_id IS DISTINCT FROM OLD.customer_id THEN
      RAISE EXCEPTION 'a service plan cannot move to another company or customer' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.properties p WHERE p.id = NEW.property_id AND p.org_id = NEW.org_id AND p.customer_id = NEW.customer_id) THEN
    RAISE EXCEPTION 'service plan property is not this customer''s' USING ERRCODE = '42501';
  END IF;
  IF NEW.default_sub_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.sub_contractors s WHERE s.id = NEW.default_sub_id AND s.org_id = NEW.org_id) THEN
    RAISE EXCEPTION 'service plan crew is not in this company' USING ERRCODE = '42501';
  END IF;
  IF NEW.follow_up_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = NEW.follow_up_user_id AND u.org_id = NEW.org_id) THEN
    RAISE EXCEPTION 'service plan follow-up person is not in this company' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS service_plans_before_write ON public.service_plans;
CREATE TRIGGER service_plans_before_write BEFORE INSERT OR UPDATE ON public.service_plans
  FOR EACH ROW EXECUTE FUNCTION public.service_plans_before_write();

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
-- 'service' = the plan's own visit (made by the generator); 'inspection' = the follow-on made when a service visit is done.
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS visit_step text NULL;
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS parent_visit_id uuid NULL REFERENCES public.work_orders(id) ON DELETE SET NULL;
-- Green / yellow / red, the same vocabulary as job_checkups.result (lib/health-result.ts).
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS health_result text NULL;

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
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_orders_health_result_check') THEN
    ALTER TABLE public.work_orders ADD CONSTRAINT work_orders_health_result_check
      CHECK (health_result IS NULL OR health_result IN ('green', 'yellow', 'red'));
  END IF;
  -- A visit is a plan's, carries a trade (server-write-only under RLS) and a planned slot; only visits may be skipped.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_orders_service_visit_shape') THEN
    ALTER TABLE public.work_orders ADD CONSTRAINT work_orders_service_visit_shape CHECK (
      (work_order_type <> 'service_visit' AND service_plan_id IS NULL AND status <> 'skipped')
      OR (work_order_type = 'service_visit' AND service_plan_id IS NOT NULL AND trade IS NOT NULL
          AND service_planned_date IS NOT NULL AND job_id IS NULL
          AND visit_step IN ('service', 'inspection')
          AND (status <> 'skipped' OR skip_reason IS NOT NULL)
          -- An inspection is only done with a result; a service visit never carries one.
          AND (visit_step = 'inspection' OR health_result IS NULL)
          AND (visit_step <> 'inspection' OR status <> 'completed' OR health_result IS NOT NULL))
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
