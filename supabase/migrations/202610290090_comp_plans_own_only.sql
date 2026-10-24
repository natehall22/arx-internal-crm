-- Comp plans: each user sees only their own plan(s) and rates; payroll admins (admin, owner, operations, super admin) see all.
--   comp_plans       - a plan assigned to me (user_comp_plans), or the default plan when I have NO assignment (it is the plan that applies to me).
--   user_comp_plans  - my own assignments only (managers no longer see everyone's with their token).
-- The two screens that read these with the user's session (Commission widget, Commission estimator) only read the person's own plan.
-- Everything else reads with the service role. RESTRICTIVE select policies; writes untouched. Rollback at the bottom.
begin;

create or replace function public.comp_plan_is_mine_self(p_plan uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.user_comp_plans a where a.user_id = auth.uid() and a.comp_plan_id = p_plan)
      or (exists (select 1 from public.comp_plans p where p.id = p_plan and p.is_default and p.is_active)
          -- the default plan is the plan that applies to me when I have no CURRENT assignment to an active plan
          and not exists (select 1 from public.user_comp_plans a join public.comp_plans cp on cp.id = a.comp_plan_id
                           where a.user_id = auth.uid() and cp.is_active
                             and a.effective_from <= current_date and (a.effective_to is null or a.effective_to >= current_date)));
$$;
revoke all on function public.comp_plan_is_mine_self(uuid) from public, anon;
grant execute on function public.comp_plan_is_mine_self(uuid) to authenticated, service_role;

drop policy if exists own_plans_only on public.comp_plans;
create policy own_plans_only on public.comp_plans as restrictive for select to authenticated
  using ((select public.is_payroll_admin()) or public.comp_plan_is_mine_self(id));

drop policy if exists own_plans_only on public.user_comp_plans;
create policy own_plans_only on public.user_comp_plans as restrictive for select to authenticated
  using ((select public.is_payroll_admin()) or user_id = (select auth.uid()));

commit;
-- ROLLBACK: drop policy own_plans_only on public.comp_plans; drop policy own_plans_only on public.user_comp_plans;
