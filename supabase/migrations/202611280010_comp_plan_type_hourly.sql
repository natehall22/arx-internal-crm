-- comp_plan_type: add 'hourly' and 'unit_based' (2026-11-28). Additive only.
-- Live check 2026-11-16: comp_plans.plan_type and comp_plan_versions.plan_type are the Postgres enum `comp_plan_type`
-- (not a CHECK), and it lacked these two values, so saving an hourly or per-unit plan failed.
-- APPLY BEFORE DEPLOY: code that offers these plan types must not run until the values exist.
-- ADD VALUE IF NOT EXISTS is safe to re-run. Nothing may use a new value in the same transaction that adds it.
ALTER TYPE comp_plan_type ADD VALUE IF NOT EXISTS 'hourly';
ALTER TYPE comp_plan_type ADD VALUE IF NOT EXISTS 'unit_based';
