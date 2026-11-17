-- Field Tech (2026-11-17): a crew member out doing the visits. Two additive pieces.
--
-- 1. arx_private.is_field_role() learns 'field_tech' (and a custom role NAMED "Field Tech" / "Field Technician", unless it is a
--    manager role). Everything that already keys on it then applies with no other change: no job board, no Production / Crew
--    threads, no money tables (restrictive field_role_money_deny policies), no supplier costs, contact details only for own
--    work. lib/permissions.ts FIELD_ROLE_SLUGS / FIELD_ROLE_NAME_PATTERN is the TypeScript twin and
--    lib/__tests__/job-notes-rls-parity.test.ts fails if the two differ. Field Tech's day, photos and time clock run through
--    the crew phone link and crew membership (crew_members), never through these tables.
-- 2. create_field_tech_preset(org, by): the system "Field Tech" permission preset (base role field_tech, NO permissions —
--    nothing is granted by the role), idempotent, called by lib/company-seed.ts for a new company and by the backfill below.
--    The Add User screen shows the card only to companies with service plans or the crew time clock (lib/role-presets.ts);
--    Setter / Canvasser cards are hidden when door knocking is off. Nothing is hidden or changed in the database.
--
-- Backfill: every company that already has presets and runs a non-roofing profile (or has service plans / the time clock
-- switched on) gets the Field Tech preset once. The original roofing company is left exactly as it was.
--
-- Rollback: re-create arx_private.is_field_role from 202610280010 (without 'field_tech' and the field-tech name words);
--   remove the preset rows where base_role = 'field_tech' and is_system; remove public.create_field_tech_preset(uuid, uuid).

CREATE OR REPLACE FUNCTION arx_private.is_field_role(p_role text, p_crname text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT lower(btrim(coalesce(p_role, ''))) IN ('setter', 'canvasser', 'inside_sales', 'inside sales', 'call_center', 'call center', 'field_tech')
      OR (lower(coalesce(p_crname, '')) !~ 'manager'
          AND lower(coalesce(p_crname, '')) ~ '(^|[^a-z])(setter|canvasser|inside[ _-]?sales|call[ _-]?cent(er|re)|field[ _-]?tech(nician)?)s?([^a-z]|$)');
$$;

CREATE OR REPLACE FUNCTION public.create_field_tech_preset(p_org_id uuid, p_created_by uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM permission_presets WHERE org_id = p_org_id AND base_role = 'field_tech') THEN
    RETURN;
  END IF;
  INSERT INTO permission_presets (org_id, name, description, base_role, color, is_system, sort_order, created_by)
  VALUES (p_org_id, 'Field Tech', 'Crew member in the field. Sees their own stops, clocks in and out, adds photos. No prices, pay or sales.', 'field_tech', 'teal', true, 7, p_created_by)
  ON CONFLICT (org_id, name) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.create_field_tech_preset(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_field_tech_preset(uuid, uuid) TO service_role;

-- Backfill (once; the function skips a company that already has the preset).
SELECT public.create_field_tech_preset(o.id, NULL)
FROM public.orgs o
WHERE EXISTS (SELECT 1 FROM public.permission_presets pp WHERE pp.org_id = o.id)
  AND (
    coalesce(o.settings #>> '{profile,id}', 'roofing') <> 'roofing'
    OR o.settings #>> '{features,servicePlans}' = 'true'
    OR o.settings #>> '{features,timeTracking}' = 'true'
  );
