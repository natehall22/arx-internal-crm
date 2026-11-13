-- Crew day v2 (2026-11-24): what was sold becomes a checklist, the crew can collect cash / checks at the door, and a pay link
-- can be texted. Additive / nullable only; nothing reads any of it until a company has the servicePlans switch on.
--
-- 1. service_plan_templates.service_lines / service_plans.service_lines: the services sold ("Mow", "Edge", "Blow", "Beds"),
--    a jsonb array of short strings. A plan COPIES its template's lines at sale (like seasons and steps) and may then be
--    edited on its own. Read live by the crew page: a plan edit shows on its future visits.
-- 2. work_orders.visit_checklist: what the crew has checked on THIS visit: [{ "label": "Mow", "done": true }]. Written only
--    by the crew link / office through lib/visit-checklist.ts; null until someone taps. Not secret (no price).
-- 3. visit_collections: cash / check a crew took at the door. PENDING until the office confirms; only the confirm writes real
--    payments (through the existing invoice payment writer), so a pending row is never money: not in a balance, not in
--    payroll, not in the QuickBooks outbox. Service role only (no policy), like service_visit_charges.
-- 4. customer_messages.kind gains 'pay_link' (a pay link texted by a crew lead or office person).
--
-- Deploy: apply after 202611110030 (service plans), 202611110060 (customer invoices) and 202611170010 (texting); before the code.
-- Rollback: DROP TABLE visit_collections; ALTER TABLE work_orders DROP COLUMN visit_checklist; ALTER TABLE service_plans /
--   service_plan_templates DROP COLUMN service_lines; restore the kind CHECK without 'pay_link' (no 'pay_link' rows may exist then).

BEGIN;

ALTER TABLE public.service_plan_templates
  ADD COLUMN IF NOT EXISTS service_lines jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(service_lines) = 'array' AND jsonb_array_length(service_lines) <= 30);
ALTER TABLE public.service_plans
  ADD COLUMN IF NOT EXISTS service_lines jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(service_lines) = 'array' AND jsonb_array_length(service_lines) <= 30);

ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS visit_checklist jsonb NULL
  CHECK (visit_checklist IS NULL OR (jsonb_typeof(visit_checklist) = 'array' AND jsonb_array_length(visit_checklist) <= 40));

CREATE TABLE IF NOT EXISTS public.visit_collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  -- SET NULL: a plan edit may delete an unstarted visit; the money record must outlive it.
  work_order_id uuid NULL REFERENCES public.work_orders(id) ON DELETE SET NULL,
  customer_id uuid NOT NULL REFERENCES public.customers(id),
  amount_cents integer NOT NULL CHECK (amount_cents > 0 AND amount_cents <= 100000000),
  method text NOT NULL CHECK (method IN ('cash', 'check')),
  check_number text NULL CHECK (check_number IS NULL OR char_length(check_number) <= 40),
  note text NULL CHECK (note IS NULL OR char_length(note) <= 500),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'rejected')),
  collected_by_sub_id uuid NULL REFERENCES public.sub_contractors(id) ON DELETE SET NULL,
  collected_at timestamptz NOT NULL DEFAULT now(),
  -- A phone that resends after a dropped signal must not make a second row.
  client_tap_id text NULL CHECK (client_tap_id IS NULL OR char_length(client_tap_id) <= 64),
  decided_by uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,
  decided_at timestamptz NULL,
  reject_reason text NULL CHECK (reject_reason IS NULL OR char_length(reject_reason) <= 500),
  -- The job_payments rows a confirm wrote: [{ "invoice_id": "...", "payment_id": "...", "cents": 4500 }]
  payments jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(payments) = 'array'),
  CONSTRAINT visit_collections_decided CHECK ((status = 'pending') = (decided_at IS NULL))
);
CREATE INDEX IF NOT EXISTS visit_collections_open_idx ON public.visit_collections (org_id, collected_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS visit_collections_customer_idx ON public.visit_collections (org_id, customer_id);
CREATE INDEX IF NOT EXISTS visit_collections_visit_idx ON public.visit_collections (work_order_id) WHERE work_order_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS visit_collections_tap_key ON public.visit_collections (org_id, client_tap_id) WHERE client_tap_id IS NOT NULL;
ALTER TABLE public.visit_collections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.visit_collections FROM anon, authenticated;

-- One company's own references only (the FKs alone do not check the company).
CREATE OR REPLACE FUNCTION public.visit_collections_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.org_id IS DISTINCT FROM OLD.org_id THEN
    RAISE EXCEPTION 'a row cannot move to another company' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status <> 'pending' AND (NEW.amount_cents IS DISTINCT FROM OLD.amount_cents OR NEW.status IS DISTINCT FROM OLD.status) THEN
    RAISE EXCEPTION 'a decided collection cannot change' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM public.customers c WHERE c.id = NEW.customer_id AND c.org_id = NEW.org_id) THEN
      RAISE EXCEPTION 'collection customer is not in this company' USING ERRCODE = '42501';
    END IF;
    IF NEW.work_order_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.work_orders w WHERE w.id = NEW.work_order_id AND w.org_id = NEW.org_id) THEN
      RAISE EXCEPTION 'collection visit is not in this company' USING ERRCODE = '42501';
    END IF;
    IF NEW.collected_by_sub_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.sub_contractors s WHERE s.id = NEW.collected_by_sub_id AND s.org_id = NEW.org_id) THEN
      RAISE EXCEPTION 'collection crew is not in this company' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS visit_collections_guard ON public.visit_collections;
CREATE TRIGGER visit_collections_guard BEFORE INSERT OR UPDATE ON public.visit_collections
  FOR EACH ROW EXECUTE FUNCTION public.visit_collections_guard();

ALTER TABLE public.customer_messages DROP CONSTRAINT IF EXISTS customer_messages_kind_check;
ALTER TABLE public.customer_messages ADD CONSTRAINT customer_messages_kind_check
  CHECK (kind IN ('visit_reminder', 'visit_on_the_way', 'visit_done', 'quote_follow_up', 'invoice_reminder', 'staff_reply', 'sms_compliance', 'pay_link'));

COMMIT;
