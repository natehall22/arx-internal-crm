-- Drop the 15 dashboard_* database functions the app no longer calls (PR #68 moved the Dashboard, team/personal
-- stats, Sisu and goals onto the rpt_* reporting views). KEPT on purpose: dashboard_count_door_leads_scoped —
-- lib/morning-update-metrics.ts and lib/founder-week-tally.ts still call it.
--
-- Checked before writing this: no other function, view, policy or trigger references any of them (only each other,
-- and all of those go together); no caller in app/, lib/, components/, scripts/, e2e/, supabase/functions, the iOS
-- app or the website. No CASCADE: if anything unexpected still depends on one, this fails instead of dropping it.
--
-- Rollback: every definition is saved first in payroll_backup.dropped_dashboard_functions_20261023
-- (run the stored `definition` text to recreate any of them, then re-grant: EXECUTE to service_role only, and for
-- dashboard_door_rpc_attribution_is_pin_first also REVOKE FROM PUBLIC). Originals: migrations 107/127-130/139/2026082500xx.

-- The backup schema is otherwise only created by hand-run data fixes; make sure it exists on a fresh database too.
CREATE SCHEMA IF NOT EXISTS payroll_backup;
REVOKE ALL ON SCHEMA payroll_backup FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON SCHEMA payroll_backup FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON SCHEMA payroll_backup FROM authenticated; END IF;
END $$;

CREATE TABLE IF NOT EXISTS payroll_backup.dropped_dashboard_functions_20261023 AS
SELECT p.proname::text AS function_name,
       pg_get_function_identity_arguments(p.oid) AS arguments,
       pg_get_functiondef(p.oid) AS definition,
       NOW() AS saved_at
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname LIKE 'dashboard\_%'
  AND p.proname <> 'dashboard_count_door_leads_scoped';
ALTER TABLE payroll_backup.dropped_dashboard_functions_20261023 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON payroll_backup.dropped_dashboard_functions_20261023 FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON payroll_backup.dropped_dashboard_functions_20261023 FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON payroll_backup.dropped_dashboard_functions_20261023 FROM authenticated; END IF;
END $$;

DROP FUNCTION IF EXISTS public.dashboard_closer_calendar_appts_by_closer(uuid, timestamptz, timestamptz, uuid[]);
DROP FUNCTION IF EXISTS public.dashboard_contact_leads_by_owner(uuid, timestamptz, timestamptz, uuid[], text[]);
DROP FUNCTION IF EXISTS public.dashboard_count_contact_leads_scoped(uuid, timestamptz, timestamptz, uuid[], text[]);
DROP FUNCTION IF EXISTS public.dashboard_count_install_sales_scoped(uuid, timestamptz, timestamptz, uuid[], boolean);
DROP FUNCTION IF EXISTS public.dashboard_count_sits_scoped(uuid, timestamptz, timestamptz, uuid[], boolean, text[]);
DROP FUNCTION IF EXISTS public.dashboard_distinct_sale_opp_count(uuid, timestamptz, timestamptz, uuid[]);
DROP FUNCTION IF EXISTS public.dashboard_distinct_sit_opp_count(uuid, timestamptz, timestamptz, uuid[], text[]);
-- The attribution check calls dashboard_door_leads_by_owner, so it goes first.
DROP FUNCTION IF EXISTS public.dashboard_door_rpc_attribution_is_pin_first();
DROP FUNCTION IF EXISTS public.dashboard_door_leads_by_owner(uuid, timestamptz, timestamptz, uuid[]);
DROP FUNCTION IF EXISTS public.dashboard_inspections_received_by_closer(uuid, timestamptz, timestamptz, uuid[]);
DROP FUNCTION IF EXISTS public.dashboard_inspections_set_by_canvasser(uuid, timestamptz, timestamptz, uuid[]);
DROP FUNCTION IF EXISTS public.dashboard_install_sales_by_owner(uuid, timestamptz, timestamptz, uuid[]);
DROP FUNCTION IF EXISTS public.dashboard_install_sales_by_setter(uuid, timestamptz, timestamptz, uuid[]);
DROP FUNCTION IF EXISTS public.dashboard_sit_counts_by_owner(uuid, timestamptz, timestamptz, uuid[], text[]);
DROP FUNCTION IF EXISTS public.dashboard_sit_counts_by_setter(uuid, timestamptz, timestamptz, uuid[], text[]);
