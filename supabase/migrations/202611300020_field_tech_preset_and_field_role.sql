-- Field Tech (2026-11-17): a crew member out doing the visits, plus the service-company role presets. Additive.
--
-- 1. arx_private.is_field_role() learns 'field_tech' (and a custom role NAMED "Field Tech" / "Field Technician", unless it is a
--    manager role). Everything that already keys on it then applies with no other change: no job board, no Production / Crew
--    threads, no money tables (restrictive field_role_money_deny policies), no supplier costs, contact details only for own
--    work. lib/permissions.ts FIELD_ROLE_SLUGS / FIELD_ROLE_NAME_PATTERN is the TypeScript twin and
--    lib/__tests__/job-notes-rls-parity.test.ts fails if the two differ. Field Tech's day, photos and time clock run through
--    the crew phone link and crew membership (crew_members), never through these tables.
-- 2. create_service_role_presets(org, by): the system Field Tech / Crew Lead / Office / Bookkeeper presets (details at the
--    function), idempotent, called by lib/company-seed.ts for a company with crews and by the backfill below. The Add User and
--    Manage Presets screens show them only to companies with service plans or the crew time clock, and hide the Setter /
--    Canvasser card when door knocking is off (lib/role-presets.ts). Nothing existing is changed.
--
-- Rollback: re-create arx_private.is_field_role from 202610280010 (without 'field_tech' and the field-tech name words);
--   remove the system preset rows named Field Tech / Crew Lead / Office / Bookkeeper; remove public.create_service_role_presets(uuid, uuid).

CREATE OR REPLACE FUNCTION arx_private.is_field_role(p_role text, p_crname text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT lower(btrim(coalesce(p_role, ''))) IN ('setter', 'canvasser', 'inside_sales', 'inside sales', 'call_center', 'call center', 'field_tech')
      OR (lower(coalesce(p_crname, '')) !~ 'manager'
          AND lower(coalesce(p_crname, '')) ~ '(^|[^a-z])(setter|canvasser|inside[ _-]?sales|call[ _-]?cent(er|re)|field[ _-]?tech(nician)?)s?([^a-z]|$)');
$$;

-- The four service-company role presets (it only ever ADDS):
--   Field Tech   base role field_tech, no permissions (lockdown role; day / photos / clock via the crew link and crew membership)
--   Crew Lead    base role field_tech too: the SAME lockdown; "lead" is the flag on the person in Crew setup (crew_members.is_lead),
--                which is what lets them tap the clock for the whole crew. The card exists so owners find it; no second role.
--   Office       base role custom (the small custom default plus the explicit list): scheduling, jobs (visits), customers, leads,
--                quotes (proposals), contracts view, money:record (invoices), price book, people list. NOT the operations role
--                (a payroll admin): no payroll, no reports:financials, no settings / admin.
--   Bookkeeper   base role custom: money:record (invoices, payments), reports:financials + reports, job financials; the pipeline is
--                view-only. No scheduling, no settings.
-- money:record and reports:financials can only be handed out by an owner (lib/money-permission-guard.ts), so a manager choosing
-- these cards cannot grant them. A permission name missing from `permissions` is skipped.
CREATE OR REPLACE FUNCTION public.create_service_role_presets(p_org_id uuid, p_created_by uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  r record;
  v_id uuid;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('Field Tech', 'Crew member in the field. Sees their own stops, clocks in and out, adds photos. No prices, pay or sales.', 'field_tech', 'teal', 7, ARRAY[]::text[]),
      ('Crew Lead', 'Field tech who runs the crew''s day and taps the clock for the crew (mark them lead in Crew setup). No prices, pay or sales.', 'field_tech', 'green', 8, ARRAY[]::text[]),
      ('Office', 'Schedules visits, looks after customers, sends quotes and invoices. No payroll or settings.', 'custom', 'orange', 9,
        ARRAY['scheduling:view','scheduling:create','scheduling:edit','jobs:view','jobs:edit','customers:view','customers:edit','leads:view','leads:create','leads:edit',
              'opportunities:view','proposals:view','proposals:create','proposals:edit','proposals:send','contracts:view','money:record','pricebook:view','users:view','teams:view']),
      ('Bookkeeper', 'Invoices, payments, statements and financial reports. Sales pipeline is view only.', 'custom', 'purple', 10,
        ARRAY['money:record','reports:financials','reports:view_all','reports:export','jobs:view','jobs:financials:view','customers:view','leads:view','opportunities:view','proposals:view','contracts:view','pricebook:view','users:view'])
    ) AS t(name, description, base_role, color, sort_order, perms)
  LOOP
    INSERT INTO permission_presets (org_id, name, description, base_role, color, is_system, sort_order, created_by)
    VALUES (p_org_id, r.name, r.description, r.base_role, r.color, true, r.sort_order, p_created_by)
    ON CONFLICT (org_id, name) DO NOTHING;
    SELECT id INTO v_id FROM permission_presets WHERE org_id = p_org_id AND name = r.name;
    IF v_id IS NOT NULL AND coalesce(array_length(r.perms, 1), 0) > 0 THEN
      INSERT INTO preset_permissions (preset_id, permission_id)
      SELECT v_id, p.id FROM permissions p WHERE p.name = ANY (r.perms)
      ON CONFLICT (preset_id, permission_id) DO NOTHING;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.create_service_role_presets(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_service_role_presets(uuid, uuid) TO service_role;

-- Backfill (once; the function only adds what is missing): every company that already has presets gets the four rows, so a
-- company that switches service plans / the time clock on LATER already has them. Whether they are shown is decided in the app
-- by one predicate (lib/role-presets.ts: profile + saved switches + plan); the original roofing company never sees them.
SELECT public.create_service_role_presets(o.id, NULL)
FROM public.orgs o
WHERE EXISTS (SELECT 1 FROM public.permission_presets pp WHERE pp.org_id = o.id);
