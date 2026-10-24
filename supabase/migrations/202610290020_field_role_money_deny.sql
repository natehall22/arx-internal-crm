-- Money tables: pricing, job cost and other people's pay are not readable with a field-role session token.
--
-- Found by the 2026-10-24 role matrix on production data: a setter or canvasser token could read every job cost line (100),
-- proposal (183), contract (50), payment (58), production job (42) and every setter's ramp pay (33) straight from the database.
-- The app reads these with the service role (checked: no field-role screen reads them with the user's session), so nothing
-- the app does changes. RESTRICTIVE policies are ANDed onto the existing ones: no existing rule is edited, and rollback is a
-- drop of the policies listed at the bottom.
--   R1  pricing + job financials: not for field roles (setter, canvasser, inside sales, call center).
--   R2  job cost lines: only people who can open the job board (and payroll admins).
--   R3  setter ramp pay: own row, or admin / manager / payroll admin.
-- Not changed here (needs app changes first): leads, customers, opportunities, appointments are still org-readable; see release notes.

begin;

create or replace function public.is_field_role_self()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select arx_private.is_field_role(lower(btrim(u.role::text)), lower(coalesce(cr.name, '') || ' ' || coalesce(cr.display_name, '')))
            and not coalesce(u.is_super_admin, false)
       from public.users u left join public.custom_roles cr on cr.id = u.custom_role_id
      where u.id = auth.uid()),
    false);
$$;

create or replace function public.can_view_job_board_self()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select arx_private.can_view_job_board(auth.uid()) or public.is_payroll_admin();
$$;

revoke all on function public.is_field_role_self() from public, anon;
revoke all on function public.can_view_job_board_self() from public, anon;
grant execute on function public.is_field_role_self() to authenticated, service_role;
grant execute on function public.can_view_job_board_self() to authenticated, service_role;

-- R1
do $$
declare t text;
begin
  foreach t in array array[
    'proposals', 'proposal_line_items', 'order_form_contracts', 'job_payments', 'job_invoices', 'job_invoice_items',
    'job_additional_scope', 'job_change_orders', 'production_jobs', 'work_orders', 'pricebook_items', 'roofing_types',
    'estimates', 'estimate_lines'
  ] loop
    execute format('drop policy if exists field_role_money_deny on public.%I', t);
    execute format('create policy field_role_money_deny on public.%I as restrictive for select to authenticated using (not public.is_field_role_self())', t);
  end loop;

  -- R2
  foreach t in array array['job_cost_lines', 'cost_attachments', 'job_product_orders', 'material_orders'] loop
    execute format('drop policy if exists job_cost_board_only on public.%I', t);
    execute format('create policy job_cost_board_only on public.%I as restrictive for select to authenticated using (public.can_view_job_board_self())', t);
  end loop;
end $$;

-- R3
drop policy if exists ramp_pay_own_or_manager on public.setter_ramp_weekly_status;
create policy ramp_pay_own_or_manager on public.setter_ramp_weekly_status as restrictive for select to authenticated
  using (user_id = auth.uid() or public.is_admin_or_manager(auth.uid()) or public.is_payroll_admin());

commit;

-- ROLLBACK (only if something breaks):
-- do $$ declare t text; begin
--   foreach t in array array['proposals','proposal_line_items','order_form_contracts','job_payments','job_invoices','job_invoice_items','job_additional_scope','job_change_orders','production_jobs','work_orders','pricebook_items','roofing_types','estimates','estimate_lines'] loop
--     execute format('drop policy if exists field_role_money_deny on public.%I', t); end loop;
--   foreach t in array array['job_cost_lines','cost_attachments','job_product_orders','material_orders'] loop
--     execute format('drop policy if exists job_cost_board_only on public.%I', t); end loop;
-- end $$;
-- drop policy if exists ramp_pay_own_or_manager on public.setter_ramp_weekly_status;
