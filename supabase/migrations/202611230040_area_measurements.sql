-- Measure yard: saved lawn / bed / cut-out / edging measurements (lawn & landscape companies).
-- Additive only. NOT applied by the builder — apply by hand, BEFORE the code that reads it.
--
-- Why a new table: `roof_measurements` is roof-specific (squares, ridges, hips, valleys, pitch, facets ...) and the roof
-- measuring tool is off limits. This is a small separate table.
--
-- One row per SAVE. "Re-measure" adds a row; nothing is overwritten, so the newest row of a property / customer is the
-- current measurement and the older ones are its history. The app never UPDATEs these rows.
--
-- The plain columns lawn_sqft / bed_sqft / cutout_sqft / line_feet are what a price-book "size option" (e.g. mowing
-- Small / Medium / Large lot) would read — no JSON parsing needed. They are always computed by the app from `shapes`.
--
-- RLS on, no policies: service role only (all reads and writes go through /api/area-measure), like `properties`.
-- Rollback (nothing else depends on it):
--   DROP TRIGGER area_measurements_lead_deleted ON public.leads; DROP TRIGGER area_measurements_opportunity_deleted ON public.opportunities;
--   DROP TRIGGER area_measurements_property_deleted ON public.properties;
--   DROP TABLE public.area_measurements; DROP FUNCTION public.area_measurements_check(); DROP FUNCTION public.area_measurements_parent_deleted();

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.area_measurements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  -- A customer's measurements are never silently wiped: deleting a customer that still has any is refused (RESTRICT).
  customer_id uuid NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  -- property / opportunity / lead are plain ids with NO foreign key: when one of them is deleted a trigger (below) either
  -- clears the id (the row still has another parent) or deletes the row (it has none). A plain ON DELETE SET NULL cannot do
  -- that: it would break area_measurements_has_owner for a row that only hung off the deleted lead. Existence and company
  -- are checked on INSERT by area_measurements_check (which also locks the parent row against a concurrent delete).
  property_id uuid NULL,
  opportunity_id uuid NULL,
  lead_id uuid NULL,
  -- The address the map was opened on (the property / deal / lead address or a typed one).
  address_text text NULL CHECK (address_text IS NULL OR char_length(address_text) <= 500),
  lat numeric(10, 7) NULL CHECK (lat IS NULL OR lat BETWEEN -90 AND 90),
  lng numeric(10, 7) NULL CHECK (lng IS NULL OR lng BETWEEN -180 AND 180),
  -- [{ id, type: lawn|bed|cutout|line, name, points:[{lat,lng}], sqft | feet, takesFrom }]
  shapes jsonb NOT NULL CHECK (jsonb_typeof(shapes) = 'array' AND jsonb_array_length(shapes) BETWEEN 1 AND 200),
  -- Net of cut-outs (lib/area-measure.ts computeTotals). Never negative.
  lawn_sqft numeric(14, 1) NOT NULL DEFAULT 0 CHECK (lawn_sqft >= 0),
  bed_sqft numeric(14, 1) NOT NULL DEFAULT 0 CHECK (bed_sqft >= 0),
  cutout_sqft numeric(14, 1) NOT NULL DEFAULT 0 CHECK (cutout_sqft >= 0),
  line_feet numeric(14, 1) NOT NULL DEFAULT 0 CHECK (line_feet >= 0),
  -- Everything computeTotals returned, including the mulch / pine straw estimate ("est."), as it was when saved.
  totals jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- The company's mulch depth / sq ft per bale at the time of saving, so an old estimate can be read as it was.
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- A measurement belongs to something: a customer, a property, a deal or a lead.
  CONSTRAINT area_measurements_has_owner CHECK (customer_id IS NOT NULL OR property_id IS NOT NULL OR opportunity_id IS NOT NULL OR lead_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS area_measurements_org_customer_idx ON public.area_measurements (org_id, customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS area_measurements_org_property_idx ON public.area_measurements (org_id, property_id, created_at DESC) WHERE property_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS area_measurements_org_opportunity_idx ON public.area_measurements (org_id, opportunity_id, created_at DESC) WHERE opportunity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS area_measurements_org_lead_idx ON public.area_measurements (org_id, lead_id, created_at DESC) WHERE lead_id IS NOT NULL;

ALTER TABLE public.area_measurements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.area_measurements FROM anon, authenticated;

-- Company check (raises): every reference on the row must be this company's, and a property must be the customer's.
CREATE OR REPLACE FUNCTION public.area_measurements_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.customer_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.customers c WHERE c.id = NEW.customer_id AND c.org_id = NEW.org_id FOR KEY SHARE) THEN
    RAISE EXCEPTION 'measurement customer is not in this company' USING ERRCODE = '42501';
  END IF;
  IF NEW.property_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.properties p WHERE p.id = NEW.property_id AND p.org_id = NEW.org_id AND (NEW.customer_id IS NULL OR p.customer_id = NEW.customer_id) FOR KEY SHARE
  ) THEN
    RAISE EXCEPTION 'measurement property is not in this company or not this customer''s' USING ERRCODE = '42501';
  END IF;
  IF NEW.opportunity_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.opportunities o WHERE o.id = NEW.opportunity_id AND o.org_id = NEW.org_id FOR KEY SHARE) THEN
    RAISE EXCEPTION 'measurement deal is not in this company' USING ERRCODE = '42501';
  END IF;
  IF NEW.lead_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.leads l WHERE l.id = NEW.lead_id AND l.org_id = NEW.org_id FOR KEY SHARE) THEN
    RAISE EXCEPTION 'measurement lead is not in this company' USING ERRCODE = '42501';
  END IF;
  IF NEW.created_by IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = NEW.created_by AND u.org_id = NEW.org_id) THEN
    RAISE EXCEPTION 'measurement author is not in this company' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS area_measurements_check ON public.area_measurements;
CREATE TRIGGER area_measurements_check BEFORE INSERT ON public.area_measurements
  FOR EACH ROW EXECUTE FUNCTION public.area_measurements_check();

-- When a lead, deal or property is deleted: a measurement that hangs off ANOTHER parent keeps that parent (the id is cleared);
-- one that hung off nothing else is deleted with it (it would have no owner, which the CHECK above forbids). Each trigger
-- looks at the row as it is NOW, so a lead and its deal deleted in one statement end the same way in either order.
CREATE OR REPLACE FUNCTION public.area_measurements_parent_deleted() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_ARGV[0] = 'lead_id' THEN
    DELETE FROM public.area_measurements WHERE lead_id = OLD.id AND customer_id IS NULL AND property_id IS NULL AND opportunity_id IS NULL;
    UPDATE public.area_measurements SET lead_id = NULL WHERE lead_id = OLD.id;
  ELSIF TG_ARGV[0] = 'opportunity_id' THEN
    DELETE FROM public.area_measurements WHERE opportunity_id = OLD.id AND customer_id IS NULL AND property_id IS NULL AND lead_id IS NULL;
    UPDATE public.area_measurements SET opportunity_id = NULL WHERE opportunity_id = OLD.id;
  ELSIF TG_ARGV[0] = 'property_id' THEN
    DELETE FROM public.area_measurements WHERE property_id = OLD.id AND customer_id IS NULL AND opportunity_id IS NULL AND lead_id IS NULL;
    UPDATE public.area_measurements SET property_id = NULL WHERE property_id = OLD.id;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS area_measurements_lead_deleted ON public.leads;
CREATE TRIGGER area_measurements_lead_deleted BEFORE DELETE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.area_measurements_parent_deleted('lead_id');
DROP TRIGGER IF EXISTS area_measurements_opportunity_deleted ON public.opportunities;
CREATE TRIGGER area_measurements_opportunity_deleted BEFORE DELETE ON public.opportunities
  FOR EACH ROW EXECUTE FUNCTION public.area_measurements_parent_deleted('opportunity_id');
DROP TRIGGER IF EXISTS area_measurements_property_deleted ON public.properties;
CREATE TRIGGER area_measurements_property_deleted BEFORE DELETE ON public.properties
  FOR EACH ROW EXECUTE FUNCTION public.area_measurements_parent_deleted('property_id');

COMMIT;
