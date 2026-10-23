-- Default pay plan per role (PROPOSED — not applied until Nathan says go). Starts the day it is run; never backdated.
-- Run AFTER migration 202610240010_org_default_comp_plans.sql.
--   sales_rep (Closers)   -> "Closer"  7%
--   setter                -> "Setter"  5%   (the plan row is marked inactive; it still prices correctly)
--   canvasser             -> "FM 2.0"  3%
-- Deliberately NOT defaulted: admin/owner (owners are paid via OPP; Nathan needs an explicit assignment — see PR).

-- PREVIEW (read-only): who each default would cover, and who already has their own plan (unchanged).
SELECT d.role, cp.name AS plan, cp.base_percentage AS rate_percent,
       count(*) FILTER (WHERE u.id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM user_comp_plans a WHERE a.user_id = u.id AND (a.effective_to IS NULL OR a.effective_to >= CURRENT_DATE))) AS people_newly_covered,
       count(*) FILTER (WHERE u.id IS NOT NULL AND EXISTS (SELECT 1 FROM user_comp_plans a WHERE a.user_id = u.id AND (a.effective_to IS NULL OR a.effective_to >= CURRENT_DATE))) AS people_keeping_own_plan
FROM (VALUES ('sales_rep','Closer'), ('setter','Setter'), ('canvasser','FM 2.0')) AS d(role, plan_name)
JOIN comp_plans cp ON cp.name = d.plan_name AND cp.org_id = '9089d4ad-f46c-405b-9798-6751d45a7051'
LEFT JOIN users u ON u.role::text = d.role AND COALESCE(u.active, true) AND u.org_id = cp.org_id
GROUP BY d.role, cp.name, cp.base_percentage;

BEGIN;
INSERT INTO org_default_comp_plans (org_id, role, comp_plan_id, effective_from, change_reason)
SELECT cp.org_id, d.role, cp.id, CURRENT_DATE, 'Initial default pay plans (Nathan, ' || CURRENT_DATE || ')'
FROM (VALUES ('sales_rep','Closer'), ('setter','Setter'), ('canvasser','FM 2.0')) AS d(role, plan_name)
JOIN comp_plans cp ON cp.name = d.plan_name AND cp.org_id = '9089d4ad-f46c-405b-9798-6751d45a7051'
ON CONFLICT (org_id, role, effective_from) DO NOTHING;
COMMIT;

-- Rollback: DELETE FROM org_default_comp_plans WHERE change_reason LIKE 'Initial default pay plans%';
