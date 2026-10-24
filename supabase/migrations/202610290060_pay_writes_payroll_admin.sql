-- Pay-table WRITES: payroll admins only (admin, owner, operations, super admin; never managers).
-- Found 2026-10-24: payroll_bonus_lines, program_444_enrollments, spiff_* allowed any manager role to insert/update/delete with a session
-- token, and setter_ramp_enrollments / setter_ramp_weekly_status allowed ANY signed-in user in the org to. The app writes all of them with
-- the service role (checked: no user-session writer), so nothing the app does changes.
-- Every other pay table already has no write policy (service role only); payroll_adjustments / disputes / unit_earnings have no grants at all.
begin;

do $$
declare t text; p record;
begin
  foreach t in array array['payroll_bonus_lines', 'program_444_enrollments', 'setter_ramp_enrollments', 'setter_ramp_weekly_status', 'spiff_achievements', 'spiff_programs'] loop
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL') loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
    execute format('create policy payroll_admin_insert on public.%I for insert to authenticated with check (org_id = get_user_org_id(auth.uid()) and public.is_payroll_admin())', t);
    execute format('create policy payroll_admin_update on public.%I for update to authenticated using (org_id = get_user_org_id(auth.uid()) and public.is_payroll_admin()) with check (org_id = get_user_org_id(auth.uid()) and public.is_payroll_admin())', t);
    execute format('create policy payroll_admin_delete on public.%I for delete to authenticated using (org_id = get_user_org_id(auth.uid()) and public.is_payroll_admin())', t);
  end loop;
end $$;

commit;
-- ROLLBACK: drop the payroll_admin_* policies on the six tables and recreate the old ones (bonus lines / 444 / spiff: is_admin_or_manager; ramp: org members).
