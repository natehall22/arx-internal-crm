-- Custom fields per company (Phase 2). Owners define fields for customers, properties and jobs in Settings → Custom fields;
-- the values live on the record itself. Additive / nullable only. NOT applied by the builder — apply BEFORE the code
-- (the code reads both; without them the Custom fields page says so and record pages show nothing extra).
--
-- 1. custom_field_definitions: one row per field. Values are hidden from field roles unless `visible_to_field`. `id` is the field's permanent key — values are stored under it, so a
--    rename never loses data. `field_type` never changes after creation (the API refuses it). Never hard-deleted by the
--    app: `active = false` hides it and keeps every saved value.
-- 2. custom_fields jsonb on customers, properties, production_jobs: { "<definition id>": value }.
--    Why jsonb on the record and not a values table: the record is always read with its own values (one query, no join
--    or N+1 on lists, exports and the Jobber import), values move with the row, and there is no second table to keep
--    company-scoped. Types are checked by the ONE writer (lib/custom-fields.ts); the SQL below only merges.
-- 3. set_custom_field_values(entity, org, id, set, remove): atomic merge, so two people saving different fields on the
--    same record at the same moment cannot overwrite each other. Service role only.
--
-- Rollback: DROP FUNCTION public.set_custom_field_values; ALTER TABLE ... DROP COLUMN custom_fields (x3);
--           DROP TABLE public.custom_field_definitions;

BEGIN;
SET LOCAL lock_timeout = '5s';   -- adds columns to busy tables: give up rather than queue behind a long transaction

CREATE TABLE IF NOT EXISTS public.custom_field_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  entity text NOT NULL CHECK (entity IN ('customer', 'property', 'job')),
  label text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 60),
  field_type text NOT NULL CHECK (field_type IN ('text', 'number', 'date', 'yes_no', 'dropdown')),
  -- Dropdown choices, in order. Empty for every other type.
  options jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(options) = 'array' AND jsonb_array_length(options) <= 50),
  required boolean NOT NULL DEFAULT false,
  -- Field roles (setters, canvassers, inside sales) see a customer / property field only when this is on. Job fields never
  -- reach them (they have no job access at all).
  visible_to_field boolean NOT NULL DEFAULT false,
  sort integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT custom_field_definitions_dropdown_options CHECK (field_type = 'dropdown' OR jsonb_array_length(options) = 0)
);

CREATE INDEX IF NOT EXISTS custom_field_definitions_org_entity_idx ON public.custom_field_definitions (org_id, entity, sort);
-- Two fields on the same record type cannot share a name (case-insensitive).
CREATE UNIQUE INDEX IF NOT EXISTS custom_field_definitions_label_key ON public.custom_field_definitions (org_id, entity, lower(btrim(label)));

ALTER TABLE public.custom_field_definitions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.custom_field_definitions FROM anon, authenticated;

ALTER TABLE public.customers       ADD COLUMN IF NOT EXISTS custom_fields jsonb NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.properties      ADD COLUMN IF NOT EXISTS custom_fields jsonb NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.production_jobs ADD COLUMN IF NOT EXISTS custom_fields jsonb NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION public.set_custom_field_values(p_entity text, p_org uuid, p_id uuid, p_set jsonb, p_remove text[])
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v jsonb;
  s jsonb := coalesce(p_set, '{}'::jsonb);
  r text[] := coalesce(p_remove, ARRAY[]::text[]);
BEGIN
  IF p_org IS NULL OR p_id IS NULL THEN RAISE EXCEPTION 'org and id are required'; END IF;
  IF jsonb_typeof(s) <> 'object' THEN RAISE EXCEPTION 'set must be an object'; END IF;
  IF p_entity = 'customer' THEN
    UPDATE public.customers SET custom_fields = (coalesce(custom_fields, '{}'::jsonb) - r) || s
     WHERE id = p_id AND org_id = p_org RETURNING custom_fields INTO v;
  ELSIF p_entity = 'property' THEN
    UPDATE public.properties SET custom_fields = (coalesce(custom_fields, '{}'::jsonb) - r) || s
     WHERE id = p_id AND org_id = p_org RETURNING custom_fields INTO v;
  ELSIF p_entity = 'job' THEN
    UPDATE public.production_jobs SET custom_fields = (coalesce(custom_fields, '{}'::jsonb) - r) || s
     WHERE id = p_id AND org_id = p_org RETURNING custom_fields INTO v;
  ELSE
    RAISE EXCEPTION 'unknown entity %', p_entity;
  END IF;
  RETURN v; -- NULL: no such record in this company
END;
$$;
REVOKE ALL ON FUNCTION public.set_custom_field_values(text, uuid, uuid, jsonb, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_custom_field_values(text, uuid, uuid, jsonb, text[]) TO service_role;

COMMIT;
