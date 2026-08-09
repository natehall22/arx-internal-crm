-- SECURITY FIX: upsert_org_derived_commission_rates (migrations 202608070003/4) was
-- created without the REVOKE/GRANT pair every other SECURITY DEFINER payroll RPC in
-- this codebase carries (assign_management_comp_overlay, cancel_management_comp_overlay,
-- end_management_comp_overlay, assign_primary_comp_plan, cancel_scheduled_primary_comp_plan
-- — see migration 202608070001). Postgres grants EXECUTE on a new function to PUBLIC by
-- default, which in Supabase includes the anon and authenticated roles. Any authenticated
-- user (any rep, not just payroll admins) could have called this RPC directly via the
-- Supabase client SDK with their own JWT, passing an arbitrary admin's user id as
-- p_created_by_user_id (the function only checks that id belongs to SOME active admin in
-- the org — not that it matches the caller) and rewriting the org's live commission rates,
-- completely bypassing the Next.js route's isPayrollAdminRole() gate. Found in the
-- mandatory pre-ship security review, minutes after the function was first created and
-- before any UI calling it was deployed anywhere — exposure window was effectively nil,
-- but grants are fixed here regardless rather than relying on that.
REVOKE ALL ON FUNCTION upsert_org_derived_commission_rates(
  UUID, NUMERIC, NUMERIC, NUMERIC, DATE, UUID, TEXT, BOOLEAN
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION upsert_org_derived_commission_rates(
  UUID, NUMERIC, NUMERIC, NUMERIC, DATE, UUID, TEXT, BOOLEAN
) TO service_role;
