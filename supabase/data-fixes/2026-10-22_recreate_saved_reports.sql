-- Recreate the 2 reports from the retired report builder as saved reports (/reports/explore).
-- Run AFTER migration 202610220010_reporting_views.sql. The old custom_reports / report_schedules
-- tables are left untouched (additive-only rule); nothing is deleted.
--
--   Inspections Scheduled  (was: appointments by setter, this week, dashboard widget)
--       -> appointments, grouped by Setter, count, last 7 days, dashboard tile
--   Inspection sat/not sat (was: inspection outcomes by outcome, 30 days)
--       -> opportunities, grouped by Inspection result, count, last 30 days
--          (dated by the opportunity's created date; the old report dated by outcome entry)

-- PREVIEW (read-only): what will be created.
SELECT c.org_id, c.created_by, c.name,
       CASE c.name WHEN 'Inspections Scheduled' THEN 'appointments / by setter / 7d / dashboard tile'
                   ELSE 'opportunities / by inspection result / 30d' END AS becomes,
       EXISTS (SELECT 1 FROM saved_reports s WHERE s.org_id = c.org_id AND s.name = c.name) AS already_exists
FROM custom_reports c
WHERE c.name IN ('Inspections Scheduled', 'Inspection sat/not sat');

-- FIX
BEGIN;
INSERT INTO saved_reports (org_id, name, spec, shared_roles, dashboard_widget, created_by)
SELECT c.org_id, c.name,
       CASE c.name
         WHEN 'Inspections Scheduled' THEN
           '{"dataset":"appointments","mode":"summary","groupBy":"setter","metric":{"kind":"count"},"date":{"preset":"7d"},"filters":[],"sortDesc":true}'::jsonb
         ELSE
           '{"dataset":"opportunities","mode":"summary","groupBy":"inspection_outcome","metric":{"kind":"count"},"date":{"preset":"30d"},"filters":[],"sortDesc":true}'::jsonb
       END,
       '{}', c.is_dashboard_widget, c.created_by
FROM custom_reports c
WHERE c.name IN ('Inspections Scheduled', 'Inspection sat/not sat')
  AND NOT EXISTS (SELECT 1 FROM saved_reports s WHERE s.org_id = c.org_id AND s.name = c.name);
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM saved_reports WHERE name IN ('Inspections Scheduled', 'Inspection sat/not sat');
  IF n <> 2 THEN RAISE EXCEPTION 'expected 2 saved reports, found %', n; END IF;
END $$;
COMMIT;

-- Rollback: DELETE FROM saved_reports WHERE name IN ('Inspections Scheduled', 'Inspection sat/not sat');
