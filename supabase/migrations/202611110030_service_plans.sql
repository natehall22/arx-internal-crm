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
--    (checked by the app against the plan's own options).
--    The price / tax snapshot of each visit (for invoicing) is NOT on work_orders — logged-in subs and every company
--    member can SELECT work_orders — but in service-role-only `service_visit_charges`.
-- 4. service_plan_changes: who changed a plan or template, when, what (same shape as supplier_audit_log:
--    changes = [{ field, label, old, new }]) and what it did to visits ({ removed, added, updated }).
-- 5. photos.job_id becomes nullable so a visit (no job) can hold photos (work_order_id set; CHECK one of the two).
-- 6. crew_day_links: a crew's phone link (/crew/day/<token>), service-role only — NOT a sub_contractors column, because
--    every signed-in company member can SELECT sub_contractors and the page shows gate codes. Expires (expires_at).
--
-- Deploy: apply AFTER 202611110010 (properties) and BEFORE the code. Nothing reads these unless the company turns on the
-- servicePlans switch (default OFF), so applying it changes nothing for anyone.
-- Rollback (no rows yet): DROP TABLE service_plan_changes, crew_day_links; ALTER TABLE work_orders DROP COLUMN
--   service_plan_id, service_planned_date, skip_reason, skipped_at, visit_step,
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
    NEW.updated_at := clock_timestamp(); -- per write, not per transaction: it is the optimistic-lock version
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
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS skip_reason text NULL;
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS skipped_at timestamptz NULL;
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

-- ---- Visit charges (price snapshot; service role only) -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.service_visit_charges (
  work_order_id uuid PRIMARY KEY REFERENCES public.work_orders(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  -- Per-visit plans: the plan price when the visit was planned (NULL for per-month / per-year plans: bill the plan).
  price numeric(10, 2) NULL CHECK (price IS NULL OR price >= 0),
  taxable boolean NOT NULL DEFAULT false
);
ALTER TABLE public.service_visit_charges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.service_visit_charges FROM anon, authenticated;

-- ---- Writes that must not interleave: one plan at a time (pg_advisory_xact_lock on the plan id) ----------------------
-- (1) A plan save and its visit changes are ONE transaction; whether a removed visit is deleted or cancelled is decided
--     here, at write time, from its photos (a crew may be uploading). (2) The generator adds visits through
--     service_plan_add_visits, which takes the same lock and refuses rows planned from a plan version that has since
--     changed — so a board load computing slots from the OLD plan can never put back visits a save just removed.
CREATE OR REPLACE FUNCTION public.service_plan_save(
  p_org_id uuid, p_plan_id uuid, p_expected_updated_at timestamptz, p_patch jsonb, p_remove uuid[], p_updates jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_plan public.service_plans;
  v_new public.service_plans;
  v_removed int := 0;
  v_cancelled int := 0;
  v_updated int := 0;
  v_group jsonb;
  v_ids uuid[];
  v_n int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('service_plan:' || p_plan_id::text));
  SELECT * INTO v_plan FROM public.service_plans WHERE id = p_plan_id AND org_id = p_org_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'service plan not found' USING ERRCODE = 'P0002'; END IF;
  IF p_expected_updated_at IS NOT NULL AND v_plan.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'service plan changed' USING ERRCODE = '40001';
  END IF;

  v_new := jsonb_populate_record(v_plan, COALESCE(p_patch, '{}'::jsonb) - 'id' - 'org_id' - 'customer_id' - 'created_by' - 'created_at' - 'updated_at');
  UPDATE public.service_plans SET
    name = v_new.name, description = v_new.description, property_id = v_new.property_id, trade = v_new.trade,
    price = v_new.price, billing_basis = v_new.billing_basis, taxable = v_new.taxable, pricing = v_new.pricing,
    pricing_inputs = v_new.pricing_inputs, tier_key = v_new.tier_key, steps = v_new.steps, status = v_new.status,
    start_date = v_new.start_date, end_date = v_new.end_date, paused_until = v_new.paused_until, seasons = v_new.seasons,
    preferred_weekday = v_new.preferred_weekday, default_sub_id = v_new.default_sub_id, route_position = v_new.route_position,
    ended_at = v_new.ended_at, template_version = v_new.template_version, updated_by = v_new.updated_by
  WHERE id = p_plan_id
  RETURNING * INTO v_new;

  -- Removed slots: only visits of THIS plan still unstarted right now. With a live photo → cancelled (kept), else deleted.
  WITH target AS (
    SELECT w.id, EXISTS (SELECT 1 FROM public.photos ph WHERE ph.work_order_id = w.id AND ph.deleted_at IS NULL) AS has_photo
      FROM public.work_orders w
     WHERE w.id = ANY (COALESCE(p_remove, '{}')) AND w.org_id = p_org_id AND w.service_plan_id = p_plan_id
       AND w.status = 'scheduled' AND w.completed_at IS NULL
  ), cancelled AS (
    UPDATE public.work_orders w SET status = 'cancelled' FROM target t WHERE w.id = t.id AND t.has_photo RETURNING w.id
  )
  SELECT count(*) INTO v_cancelled FROM cancelled;
  DELETE FROM public.work_orders w
   WHERE w.id = ANY (COALESCE(p_remove, '{}')) AND w.org_id = p_org_id AND w.service_plan_id = p_plan_id
     AND w.status = 'scheduled' AND w.completed_at IS NULL;
  GET DIAGNOSTICS v_removed = ROW_COUNT;

  -- Kept slots: groups of { ids, set: {work_orders columns}, charge: { price, taxable } }; only still-scheduled visits.
  FOR v_group IN SELECT * FROM jsonb_array_elements(COALESCE(p_updates, '[]'::jsonb)) LOOP
    SELECT array_agg(x::uuid) INTO v_ids FROM jsonb_array_elements_text(v_group->'ids') x;
    UPDATE public.work_orders w SET
      title = COALESCE(v_group->'set'->>'title', w.title),
      description = CASE WHEN v_group->'set' ? 'description' THEN v_group->'set'->>'description' ELSE w.description END,
      trade = COALESCE(v_group->'set'->>'trade', w.trade),
      property_id = COALESCE((v_group->'set'->>'property_id')::uuid, w.property_id),
      address = CASE WHEN v_group->'set' ? 'address' THEN v_group->'set'->>'address' ELSE w.address END,
      city = CASE WHEN v_group->'set' ? 'city' THEN v_group->'set'->>'city' ELSE w.city END,
      state = CASE WHEN v_group->'set' ? 'state' THEN v_group->'set'->>'state' ELSE w.state END,
      zip = CASE WHEN v_group->'set' ? 'zip' THEN v_group->'set'->>'zip' ELSE w.zip END,
      assigned_sub_id = CASE WHEN v_group->'set' ? 'assigned_sub_id' THEN (v_group->'set'->>'assigned_sub_id')::uuid ELSE w.assigned_sub_id END
     WHERE w.id = ANY (v_ids) AND w.org_id = p_org_id AND w.service_plan_id = p_plan_id AND w.status = 'scheduled';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_updated := v_updated + v_n;
    IF v_group ? 'charge' THEN
      INSERT INTO public.service_visit_charges (work_order_id, org_id, price, taxable)
      SELECT w.id, p_org_id, (v_group->'charge'->>'price')::numeric, COALESCE((v_group->'charge'->>'taxable')::boolean, false)
        FROM public.work_orders w
       WHERE w.id = ANY (v_ids) AND w.org_id = p_org_id AND w.service_plan_id = p_plan_id AND w.status = 'scheduled'
      ON CONFLICT (work_order_id) DO UPDATE SET price = EXCLUDED.price, taxable = EXCLUDED.taxable;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('plan', to_jsonb(v_new), 'removed', v_removed, 'cancelled', v_cancelled, 'updated', v_updated);
END;
$$;
REVOKE ALL ON FUNCTION public.service_plan_save(uuid, uuid, timestamptz, jsonb, uuid[], jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_plan_save(uuid, uuid, timestamptz, jsonb, uuid[], jsonb) TO service_role;

-- Add visits for one plan (the generator, and follow-on steps). p_plan_updated_at = the plan version the rows were
-- planned from; NULL = no check (follow-on steps). Returns the number inserted, or -1 when the plan changed / ended
-- since (the caller drops its rows; the save that changed it runs its own generator).
CREATE OR REPLACE FUNCTION public.service_plan_add_visits(p_org_id uuid, p_plan_id uuid, p_plan_updated_at timestamptz, p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_plan public.service_plans;
  v_n int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('service_plan:' || p_plan_id::text));
  SELECT * INTO v_plan FROM public.service_plans WHERE id = p_plan_id AND org_id = p_org_id;
  IF NOT FOUND OR v_plan.status = 'ended' THEN RETURN -1; END IF;
  IF p_plan_updated_at IS NOT NULL AND v_plan.updated_at IS DISTINCT FROM p_plan_updated_at THEN RETURN -1; END IF;
  WITH src AS (
    SELECT * FROM jsonb_to_recordset(COALESCE(p_rows, '[]'::jsonb)) AS x(
      visit_step text, service_planned_date date, scheduled_date date, parent_visit_id uuid, assigned_sub_id uuid,
      assigned_user_id uuid, title text, description text, address text, city text, state text, zip text, price numeric, taxable boolean)
  ), ins AS (
    INSERT INTO public.work_orders (org_id, work_order_type, visit_step, status, priority, service_plan_id, service_planned_date,
      scheduled_date, parent_visit_id, customer_id, property_id, trade, assigned_sub_id, assigned_user_id, title, description,
      created_by, address, city, state, zip)
    SELECT p_org_id, 'service_visit', COALESCE(s.visit_step, 'service'), 'scheduled', 'normal', p_plan_id, s.service_planned_date,
      s.scheduled_date, s.parent_visit_id, v_plan.customer_id, v_plan.property_id, v_plan.trade, s.assigned_sub_id, s.assigned_user_id,
      COALESCE(s.title, v_plan.name), s.description, v_plan.created_by, s.address, s.city, s.state, s.zip
      FROM src s
    ON CONFLICT (org_id, service_plan_id, service_planned_date, visit_step) DO NOTHING
    RETURNING id, service_planned_date, visit_step
  ), charged AS (
    INSERT INTO public.service_visit_charges (work_order_id, org_id, price, taxable)
    SELECT i.id, p_org_id, s.price, COALESCE(s.taxable, false)
      FROM ins i JOIN src s ON s.service_planned_date = i.service_planned_date AND COALESCE(s.visit_step, 'service') = i.visit_step
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM ins;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.service_plan_add_visits(uuid, uuid, timestamptz, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_plan_add_visits(uuid, uuid, timestamptz, jsonb) TO service_role;

-- ---- Work order numbers: a per-company counter (no full-table scan per insert), never truncated --------------------
-- Before: MAX() over every work order of the company on each insert, and lpad(n, 5) — which TRUNCATES past 99,999
-- ('123456' → '12345', then a unique-key failure). Now one counter row per company (row lock serializes inserts), seeded
-- once from today's highest WO-<n>, and numbers past 99,999 are written in full (WO-100000). Same format below that.
CREATE TABLE IF NOT EXISTS public.work_order_number_counters (
  org_id uuid PRIMARY KEY REFERENCES public.orgs(id) ON DELETE CASCADE,
  last_number bigint NOT NULL
);
ALTER TABLE public.work_order_number_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.work_order_number_counters FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.generate_work_order_number()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  next_num bigint;
BEGIN
  UPDATE public.work_order_number_counters SET last_number = last_number + 1 WHERE org_id = NEW.org_id RETURNING last_number INTO next_num;
  IF NOT FOUND THEN
    -- First number for this company under the counter: one scan, under the same per-company lock the old code used.
    PERFORM pg_advisory_xact_lock(hashtext('work_order_number:' || NEW.org_id::text));
    UPDATE public.work_order_number_counters SET last_number = last_number + 1 WHERE org_id = NEW.org_id RETURNING last_number INTO next_num;
    IF NOT FOUND THEN
      SELECT COALESCE(MAX(SUBSTRING(work_order_number FROM 4)::bigint), 0) + 1 INTO next_num
        FROM public.work_orders WHERE org_id = NEW.org_id AND work_order_number ~ '^WO-[0-9]{1,18}$';
      INSERT INTO public.work_order_number_counters (org_id, last_number) VALUES (NEW.org_id, next_num);
    END IF;
  END IF;
  NEW.work_order_number := 'WO-' || CASE WHEN next_num < 100000 THEN lpad(next_num::text, 5, '0') ELSE next_num::text END;
  RETURN NEW;
END;
$function$;

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
