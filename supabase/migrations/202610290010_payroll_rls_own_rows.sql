-- Payroll reads: a signed-in user sees only their own pay rows; payroll admins see the whole org.
--
-- Before: payroll_rep_hours, payroll_rep_hours_audit, payroll_payout_lines (and the other payroll tables below)
-- had SELECT policies of just `org_id = get_user_org_id(auth.uid())`, so any logged-in user could read everyone's
-- hours, rates and commission lines straight from the database with their session token.
-- Every app reader uses the service role (bypasses RLS), so the app is unaffected.
--
-- "Payroll admin" = PAYROLL_ADMIN_ROLES (admin, owner, operations) or a super admin. Managers are NOT included.
-- Additive in effect: only SELECT policies change; writes are untouched. Rollback SQL is at the bottom.

begin;

create or replace function public.is_payroll_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select coalesce(u.active, true)
            and (lower(btrim(u.role::text)) in ('admin', 'owner', 'operations') or coalesce(u.is_super_admin, false))
       from public.users u
      where u.id = auth.uid()),
    false);
$$;

revoke all on function public.is_payroll_admin() from public, anon;
grant execute on function public.is_payroll_admin() to authenticated, service_role;

-- Per-person tables: own rows, or payroll admin.
drop policy if exists payroll_rep_hours_org_select on public.payroll_rep_hours;
create policy payroll_rep_hours_own_or_admin_select on public.payroll_rep_hours for select to authenticated
  using (org_id = get_user_org_id(auth.uid()) and (user_id = auth.uid() or public.is_payroll_admin()));

drop policy if exists payroll_rep_hours_audit_org_select on public.payroll_rep_hours_audit;
create policy payroll_rep_hours_audit_own_or_admin_select on public.payroll_rep_hours_audit for select to authenticated
  using (org_id = get_user_org_id(auth.uid()) and (user_id = auth.uid() or public.is_payroll_admin()));

drop policy if exists payroll_payout_lines_org_select on public.payroll_payout_lines;
create policy payroll_payout_lines_own_or_admin_select on public.payroll_payout_lines for select to authenticated
  using (org_id = get_user_org_id(auth.uid()) and (user_id = auth.uid() or public.is_payroll_admin()));

drop policy if exists payroll_statement_deliveries_org_select on public.payroll_statement_deliveries;
create policy payroll_statement_deliveries_own_or_admin_select on public.payroll_statement_deliveries for select to authenticated
  using (org_id = get_user_org_id(auth.uid()) and (user_id = auth.uid() or public.is_payroll_admin()));

drop policy if exists payroll_chargebacks_org_select on public.payroll_chargebacks;
create policy payroll_chargebacks_own_or_admin_select on public.payroll_chargebacks for select to authenticated
  using (org_id = get_user_org_id(auth.uid()) and (user_id = auth.uid() or public.is_payroll_admin()));

drop policy if exists payroll_chargeback_applications_select on public.payroll_chargeback_applications;
create policy payroll_chargeback_applications_own_or_admin_select on public.payroll_chargeback_applications for select to authenticated
  using (exists (
    select 1 from public.payroll_chargebacks pc
     where pc.id = payroll_chargeback_applications.chargeback_id
       and pc.org_id = get_user_org_id(auth.uid())
       and (pc.user_id = auth.uid() or public.is_payroll_admin())));

drop policy if exists deal_commission_roles_org_select on public.deal_commission_roles;
create policy deal_commission_roles_own_or_admin_select on public.deal_commission_roles for select to authenticated
  using (org_id = get_user_org_id(auth.uid()) and (user_id = auth.uid() or public.is_payroll_admin()));

-- Bonus lines already limited to own rows, but its "admin" arm was every manager role. Payroll admins only.
drop policy if exists payroll_bonus_lines_select on public.payroll_bonus_lines;
create policy payroll_bonus_lines_select on public.payroll_bonus_lines for select to authenticated
  using (org_id = get_user_org_id(auth.uid()) and (user_id = auth.uid() or public.is_payroll_admin()));

-- Org-level tables with no person on the row (job pool amounts, period totals, who overrode what): payroll admins only.
drop policy if exists payroll_job_snapshots_org_select on public.payroll_job_snapshots;
create policy payroll_job_snapshots_admin_select on public.payroll_job_snapshots for select to authenticated
  using (org_id = get_user_org_id(auth.uid()) and public.is_payroll_admin());

drop policy if exists payroll_period_snapshots_org_select on public.payroll_period_snapshots;
create policy payroll_period_snapshots_admin_select on public.payroll_period_snapshots for select to authenticated
  using (org_id = get_user_org_id(auth.uid()) and public.is_payroll_admin());

drop policy if exists payroll_override_audit_org_select on public.payroll_override_audit;
create policy payroll_override_audit_admin_select on public.payroll_override_audit for select to authenticated
  using (org_id = get_user_org_id(auth.uid()) and public.is_payroll_admin());

drop policy if exists job_payroll_state_org_select on public.job_payroll_state;
create policy job_payroll_state_admin_select on public.job_payroll_state for select to authenticated
  using (org_id = get_user_org_id(auth.uid()) and public.is_payroll_admin());

-- Left as is on purpose: payroll_periods (labels, dates, status; the Sisu page reads pay dates with the user's session),
-- and payroll_adjustments / payroll_disputes / payroll_unit_earnings (RLS on, no policies = service role only).

commit;

-- ROLLBACK (only if something breaks): recreate each old policy, then drop the new ones and the helper.
-- create policy payroll_rep_hours_org_select on public.payroll_rep_hours for select using (org_id = get_user_org_id(auth.uid()));
-- create policy payroll_rep_hours_audit_org_select on public.payroll_rep_hours_audit for select using (org_id = get_user_org_id(auth.uid()));
-- create policy payroll_payout_lines_org_select on public.payroll_payout_lines for select using (org_id = get_user_org_id(auth.uid()));
-- create policy payroll_statement_deliveries_org_select on public.payroll_statement_deliveries for select using (org_id = get_user_org_id(auth.uid()));
-- create policy payroll_chargebacks_org_select on public.payroll_chargebacks for select using (org_id = get_user_org_id(auth.uid()));
-- create policy payroll_chargeback_applications_select on public.payroll_chargeback_applications for select using (exists (select 1 from payroll_chargebacks pc where pc.id = payroll_chargeback_applications.chargeback_id and pc.org_id = get_user_org_id(auth.uid())));
-- create policy deal_commission_roles_org_select on public.deal_commission_roles for select using (org_id = get_user_org_id(auth.uid()));
-- create policy payroll_bonus_lines_select on public.payroll_bonus_lines for select using (org_id = get_user_org_id(auth.uid()) and (user_id = auth.uid() or is_admin_or_manager(auth.uid())));
-- create policy payroll_job_snapshots_org_select on public.payroll_job_snapshots for select using (org_id = get_user_org_id(auth.uid()));
-- create policy payroll_period_snapshots_org_select on public.payroll_period_snapshots for select using (org_id = get_user_org_id(auth.uid()));
-- create policy payroll_override_audit_org_select on public.payroll_override_audit for select using (org_id = get_user_org_id(auth.uid()));
-- create policy job_payroll_state_org_select on public.job_payroll_state for select using (org_id = get_user_org_id(auth.uid()));
-- (then drop the *_own_or_admin_select / *_admin_select policies, re-create the payroll_bonus_lines_select drop above, and drop function public.is_payroll_admin())
