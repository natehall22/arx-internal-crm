-- Service-profile companies (lawn_landscape, exterior_cleaning) start with an "Estimate Visit" appointment type, so the
-- scheduling flow does not offer only roofing-shaped inspection/close types. Additive and idempotent: inserts one row per
-- such org that has no type of that name; never updates or deletes anything, and skips an org that keeps types in settings.appointment_types. Mirrors ensureProfileAppointmentType
-- (lib/org-profile-server.ts), which does the same on a profile switch.
INSERT INTO appointment_types (org_id, name, duration_minutes, description, category, active, sort_order)
SELECT o.id,
       'Estimate Visit',
       CASE o.settings #>> '{profile,id}' WHEN 'lawn_landscape' THEN 45 ELSE 30 END,
       'On-site visit to look at the property and give a quote',
       'inspection',
       true,
       COALESCE((SELECT max(sort_order) FROM appointment_types a WHERE a.org_id = o.id), 0) + 1
FROM orgs o
WHERE o.settings #>> '{profile,id}' IN ('lawn_landscape', 'exterior_cleaning')
  AND NOT (jsonb_typeof(o.settings -> 'appointment_types') = 'array' AND jsonb_array_length(o.settings -> 'appointment_types') > 0)
  AND NOT EXISTS (SELECT 1 FROM appointment_types a WHERE a.org_id = o.id AND lower(btrim(a.name)) = 'estimate visit');
