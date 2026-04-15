-- Link older projects to their source opportunities when they share the same lead.
-- Sales reporting is intentionally driven by completed Installation Agreements,
-- not project existence or inspection feedback outcomes.

UPDATE projects p
SET opportunity_id = o.id
FROM opportunities o
WHERE p.opportunity_id IS NULL
  AND p.lead_id IS NOT NULL
  AND o.lead_id = p.lead_id
  AND o.org_id = p.org_id;
