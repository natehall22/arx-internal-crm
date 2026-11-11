-- Properties: the places a customer owns or manages (Phase 2, first outside client = lawn / landscape / pressure washing
-- with commercial accounts). One customer has many properties; a deal, job, crew visit or file can point at one.
-- Additive / nullable only. NOT applied by the builder — apply by hand, BEFORE the code that reads it.
--
-- 1. public.properties (org_id NOT NULL, customer_id NOT NULL). Never hard-deleted by the app: `active = false` hides it.
--    `address_key` = public.property_address_key(address_text), set by trigger; ONE place defines "same address".
--    Unique per (org, customer, address_key) — the same customer cannot have the same address twice.
-- 2. property_id (nullable) on opportunities, production_jobs, work_orders, documents. ON DELETE SET NULL.
--    `documents` (bucket project-files) is the live file system (job Files tab, contracts, change orders: 36 rows in prod
--    2026-11-10); the legacy `files` table holds 1 row and is not extended.
-- 3. BEFORE INSERT fill: when a new row arrives WITHOUT property_id it is filled, never by the app:
--      opportunities   -> the customer's property at the deal's address (created if missing)
--      production_jobs -> its project's deal's property, else the customer's property at the job address (created if missing)
--      work_orders     -> its job's property, else the customer's property at the work-order address (created if missing)
--      documents       -> its job's property (never creates one); a customer-level document gets its property from the app
--    The fill NEVER raises (a failure leaves property_id NULL and logs a WARNING), so contract signing, job creation and
--    uploads keep working exactly as before. Addresses on those rows are untouched: nothing reads property_id to resolve
--    an address for ARX's existing flows.
-- 4. Company check (raises): a property_id written on any of those rows must belong to the row's own company, and to the
--    row's customer when both are set. A property's customer must be in the property's company.
-- 5. RLS on, no policies: service role only (all reads/writes go through the API, lib/properties.ts).
--
-- Existing rows: supabase/data-fixes/2026-11-11_backfill_properties.sql (preview / apply / undo). Run AFTER this file.
-- Rollback (nothing else depends on it):
--   DROP TRIGGER properties_fill_opportunities ON public.opportunities; (and the 3 other *_fill triggers)
--   ALTER TABLE public.opportunities DROP COLUMN property_id; (and production_jobs, work_orders, documents)
--   DROP TABLE public.properties; DROP FUNCTION public.ensure_property, public.property_fill_row, public.property_address_key,
--   public.properties_before_write;

BEGIN;

-- "Same address": lower case, punctuation (except # and -) to spaces, collapsed whitespace, no trailing country.
-- "123 Main St., Tallahassee, FL 32301, USA" = "123 main st tallahassee fl 32301". Deliberately conservative: it does not
-- expand abbreviations (St/Street), so two spellings stay two properties rather than wrongly merging two places.
CREATE OR REPLACE FUNCTION public.property_address_key(p text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT btrim(regexp_replace(
           regexp_replace(
             regexp_replace(lower(coalesce(p, '')), '[^a-z0-9#\- ]+', ' ', 'g'),
             '\s+', ' ', 'g'),
           '\s(usa|us|united states|united states of america)\s*$', '', 'g'));
$$;

CREATE TABLE IF NOT EXISTS public.properties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  -- Optional short name ("Main office", "Lot 14", "Rental on Oak").
  label text NULL CHECK (label IS NULL OR char_length(label) <= 80),
  address_line1 text NULL CHECK (address_line1 IS NULL OR char_length(address_line1) <= 200),
  address_line2 text NULL CHECK (address_line2 IS NULL OR char_length(address_line2) <= 200),
  city text NULL CHECK (city IS NULL OR char_length(city) <= 100),
  state text NULL CHECK (state IS NULL OR char_length(state) <= 50),
  zip text NULL CHECK (zip IS NULL OR char_length(zip) <= 20),
  -- One-line address as people read it. Written by lib/properties.ts from the parts; backfilled rows have only this.
  address_text text NOT NULL CHECK (char_length(btrim(address_text)) BETWEEN 1 AND 500),
  address_key text NOT NULL DEFAULT '',
  lat numeric(10, 8) NULL CHECK (lat IS NULL OR lat BETWEEN -90 AND 90),
  lng numeric(11, 8) NULL CHECK (lng IS NULL OR lng BETWEEN -180 AND 180),
  notes text NULL CHECK (notes IS NULL OR char_length(notes) <= 4000),
  -- Gate codes, dogs, where to park. Hidden from field roles (setters, canvassers, inside sales) by the API.
  access_notes text NULL CHECK (access_notes IS NULL OR char_length(access_notes) <= 2000),
  active boolean NOT NULL DEFAULT true,
  -- How the row was born: 'manual' (Customer File), 'auto' (the insert fill below), 'backfill' (the data fix), 'import'.
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'auto', 'backfill', 'import')),
  created_by uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS properties_org_customer_idx ON public.properties (org_id, customer_id);
CREATE UNIQUE INDEX IF NOT EXISTS properties_customer_address_key ON public.properties (org_id, customer_id, address_key);

ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.properties FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.properties_before_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.address_key := public.property_address_key(NEW.address_text);
  IF NEW.address_key = '' THEN RAISE EXCEPTION 'property address is empty' USING ERRCODE = '23514'; END IF;
  IF TG_OP = 'UPDATE' THEN
    NEW.updated_at := now();
    IF NEW.org_id IS DISTINCT FROM OLD.org_id THEN RAISE EXCEPTION 'a property cannot move to another company' USING ERRCODE = '42501'; END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.customers c WHERE c.id = NEW.customer_id AND c.org_id = NEW.org_id) THEN
    RAISE EXCEPTION 'property customer is not in this company' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS properties_before_write ON public.properties;
CREATE TRIGGER properties_before_write BEFORE INSERT OR UPDATE ON public.properties
  FOR EACH ROW EXECUTE FUNCTION public.properties_before_write();

-- Find-or-create the customer's property at an address. Returns NULL for a blank address. Used by the insert fill and
-- the backfill; the app's own "add property" goes through lib/properties.ts (same unique key, so the two cannot diverge).
CREATE OR REPLACE FUNCTION public.ensure_property(
  p_org uuid, p_customer uuid, p_address text, p_lat numeric DEFAULT NULL, p_lng numeric DEFAULT NULL, p_source text DEFAULT 'auto'
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_key text := public.property_address_key(p_address);
  v_id uuid;
BEGIN
  IF p_org IS NULL OR p_customer IS NULL OR v_key = '' THEN RETURN NULL; END IF;
  SELECT id INTO v_id FROM public.properties WHERE org_id = p_org AND customer_id = p_customer AND address_key = v_key;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  INSERT INTO public.properties (org_id, customer_id, address_text, lat, lng, source)
  VALUES (p_org, p_customer, btrim(p_address),
          CASE WHEN p_lat BETWEEN -90 AND 90 THEN p_lat END,
          CASE WHEN p_lng BETWEEN -180 AND 180 THEN p_lng END,
          p_source)
  ON CONFLICT (org_id, customer_id, address_key) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.properties WHERE org_id = p_org AND customer_id = p_customer AND address_key = v_key;
  END IF;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.ensure_property(uuid, uuid, text, numeric, numeric, text) FROM PUBLIC, anon, authenticated;

ALTER TABLE public.opportunities   ADD COLUMN IF NOT EXISTS property_id uuid NULL REFERENCES public.properties(id) ON DELETE SET NULL;
ALTER TABLE public.production_jobs ADD COLUMN IF NOT EXISTS property_id uuid NULL REFERENCES public.properties(id) ON DELETE SET NULL;
ALTER TABLE public.work_orders     ADD COLUMN IF NOT EXISTS property_id uuid NULL REFERENCES public.properties(id) ON DELETE SET NULL;
ALTER TABLE public.documents       ADD COLUMN IF NOT EXISTS property_id uuid NULL REFERENCES public.properties(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS opportunities_property_idx   ON public.opportunities (property_id)   WHERE property_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS production_jobs_property_idx ON public.production_jobs (property_id) WHERE property_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS work_orders_property_idx     ON public.work_orders (property_id)     WHERE property_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS documents_property_idx       ON public.documents (property_id)       WHERE property_id IS NOT NULL;
-- Customer-level documents (Customer File → Files: job_id NULL) are read by customer_id.
CREATE INDEX IF NOT EXISTS documents_customer_idx       ON public.documents (org_id, customer_id) WHERE customer_id IS NOT NULL AND deleted_at IS NULL;

-- One trigger function for the four tables (TG_TABLE_NAME picks the rule).
CREATE OR REPLACE FUNCTION public.property_fill_row() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_prop record;
  v_customer uuid;
  v_id uuid;
  v_addr text;
BEGIN
  -- (a) A property_id that IS set must be this company's (and this customer's) — a real bug if not, so it raises.
  IF NEW.property_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.property_id IS DISTINCT FROM OLD.property_id) THEN
    SELECT p.org_id, p.customer_id INTO v_prop FROM public.properties p WHERE p.id = NEW.property_id;
    IF NOT FOUND OR v_prop.org_id IS DISTINCT FROM NEW.org_id THEN
      RAISE EXCEPTION 'property % is not in this company', NEW.property_id USING ERRCODE = '42501';
    END IF;
    v_customer := NEW.customer_id;   -- all four tables carry customer_id
    IF v_customer IS NOT NULL AND v_customer IS DISTINCT FROM v_prop.customer_id THEN
      RAISE EXCEPTION 'property % belongs to another customer', NEW.property_id USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- (b) Fill on INSERT only, and never raise from here on.
  IF TG_OP <> 'INSERT' OR NEW.property_id IS NOT NULL THEN RETURN NEW; END IF;
  BEGIN
    IF TG_TABLE_NAME = 'opportunities' THEN
      v_id := public.ensure_property(NEW.org_id, NEW.customer_id, NEW.address_text, NEW.lat, NEW.lng, 'auto');
    ELSIF TG_TABLE_NAME = 'production_jobs' THEN
      SELECT o.property_id INTO v_id
        FROM public.projects pr JOIN public.opportunities o ON o.id = pr.opportunity_id AND o.org_id = pr.org_id
       WHERE pr.id = NEW.project_id AND pr.org_id = NEW.org_id
         AND (NEW.customer_id IS NULL OR o.customer_id IS NOT DISTINCT FROM NEW.customer_id);
      IF v_id IS NULL THEN
        v_id := public.ensure_property(NEW.org_id, NEW.customer_id, NEW.address_text, NEW.lat, NEW.lng, 'auto');
      END IF;
    ELSIF TG_TABLE_NAME = 'work_orders' THEN
      SELECT j.property_id INTO v_id FROM public.production_jobs j
       WHERE j.id = NEW.job_id AND j.org_id = NEW.org_id
         AND (NEW.customer_id IS NULL OR j.customer_id IS NOT DISTINCT FROM NEW.customer_id);
      IF v_id IS NULL THEN
        v_addr := nullif(concat_ws(', ', nullif(btrim(NEW.address), ''), nullif(btrim(NEW.city), ''),
                                   nullif(btrim(concat_ws(' ', nullif(btrim(NEW.state), ''), nullif(btrim(NEW.zip), ''))), '')), '');
        v_id := public.ensure_property(NEW.org_id, NEW.customer_id, v_addr, NULL, NULL, 'auto');
      END IF;
    ELSIF TG_TABLE_NAME = 'documents' THEN
      IF NEW.job_id IS NOT NULL THEN
        SELECT j.property_id INTO v_id FROM public.production_jobs j
         WHERE j.id = NEW.job_id AND j.org_id = NEW.org_id
           AND (NEW.customer_id IS NULL OR j.customer_id IS NOT DISTINCT FROM NEW.customer_id);
      END IF;
    END IF;
    NEW.property_id := v_id;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'property fill skipped on % (%): %', TG_TABLE_NAME, SQLSTATE, SQLERRM;
    NEW.property_id := NULL;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS properties_fill_opportunities ON public.opportunities;
CREATE TRIGGER properties_fill_opportunities BEFORE INSERT OR UPDATE OF property_id ON public.opportunities
  FOR EACH ROW EXECUTE FUNCTION public.property_fill_row();
DROP TRIGGER IF EXISTS properties_fill_production_jobs ON public.production_jobs;
CREATE TRIGGER properties_fill_production_jobs BEFORE INSERT OR UPDATE OF property_id ON public.production_jobs
  FOR EACH ROW EXECUTE FUNCTION public.property_fill_row();
DROP TRIGGER IF EXISTS properties_fill_work_orders ON public.work_orders;
CREATE TRIGGER properties_fill_work_orders BEFORE INSERT OR UPDATE OF property_id ON public.work_orders
  FOR EACH ROW EXECUTE FUNCTION public.property_fill_row();
DROP TRIGGER IF EXISTS properties_fill_documents ON public.documents;
CREATE TRIGGER properties_fill_documents BEFORE INSERT OR UPDATE OF property_id ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.property_fill_row();

COMMIT;
