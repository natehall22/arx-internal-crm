-- RLS lockdown (security sweep 2026-11-13, findings #1, #2, #3). Additive in effect for the app; NOT applied.
--
-- WHY: every staff member holds a real Supabase JWT and the anon key is public, so anyone signed in can call PostgREST
-- directly (/rest/v1/...) and skip every rule in app/api. Only RLS stands in the way, and the write policies below were
-- org-wide for any member (a closer could insert a job_payments row so their job reads "paid in full", rewrite
-- opportunities.owner_user_id / setter_user_id, edit a signed contract total; a manager could PATCH users.role = 'admin').
--
-- WHAT:
--   1. Money / sales tables: every PERMISSIVE INSERT / UPDATE / DELETE / ALL policy is dropped, whatever its name. An ALL
--      policy also granted SELECT, so it is re-created as a SELECT-only policy with the same USING (reads unchanged) unless
--      an identical permissive SELECT policy already exists. RESTRICTIVE policies are never touched.
--      Kept here on purpose: job_change_orders "Users can insert change orders" — POST /api/change-orders/create inserted
--      in-person change orders with the caller's JWT until this branch; it now uses the service client. That policy is
--      dropped by 202611240045, applied AFTER this branch's code is deployed.
--   2. users / user_permissions / custom_roles / role_permissions / permission_presets / preset_permissions: the member
--      write policies (gated on is_admin_or_manager, which includes regional/sales/setter managers) are replaced by
--      owner/admin-only ones (get_user_role(auth.uid())::text IN ('admin','owner'), the pattern of org_monthly_goals).
--      The guard trigger on users (guard_users_is_super_admin, 202610210010) now also refuses a change to role,
--      custom_role_id, org_id or active unless the caller is the server (service role, or no JWT = SQL editor/migration).
--   3. SECURITY DEFINER functions that trust a passed org id: get_unpaid_referrals, dashboard_count_door_leads_scoped —
--      EXECUTE revoked from PUBLIC, anon, authenticated (only the server calls them, with the service key:
--      lib/morning-update-metrics.ts countDoors <- morning email / founder week, all createServiceClient(); nothing calls
--      get_unpaid_referrals). The RLS helpers get_user_org_id / get_user_role / is_admin_or_manager / get_sub_id_for_user:
--      EXECUTE revoked from PUBLIC and anon (policies run them as `authenticated`; app code calls get_sub_id_for_user with a
--      user client — subs pages — so authenticated keeps it). Effect for a request with NO JWT: a table whose policy calls
--      one of these now answers "permission denied for function" instead of an empty list. Nothing in the app reads a CRM
--      table without a signed-in user (org_id_for_subdomain / company_subdomain_for_alias are separate and untouched).
--
-- BROWSER-WRITER EVIDENCE (branch fix/rls-lockdown, 2026-11-13): no 'use client' file writes any table below (client
-- components only READ users / user_permissions / proposals / opportunities). Every server write to them goes through
-- createServiceClient() / orgDb(admin) — the one user-JWT writer found was the in-person insert in
-- app/api/change-orders/create (moved to the service client; see 0045). SQL: no SECURITY INVOKER function or trigger writes
-- these tables except the money RPCs (record_job_payment, apply_job_invoice_payment, create_service_invoice,
-- record_customer_invoice_payment/refund, cancel/uncancel_production_job, confirm_opportunity_self_generated,
-- approve_billed_time, enqueue_integration_event), all called only with the service client. After this, a user calling
-- those RPCs directly with their own JWT is refused by RLS, as intended. The iPhone app only reads its own users row.
--
-- APPLY ORDER: safe before the code (nothing the deployed app does needs the dropped policies). Then deploy, then 0045.
--
-- ROLLBACK (exact prod definitions captured 2026-11-13 from pg_policies; roles {public} unless noted):
--   job_payments          "Users can insert job payments for their org"  INSERT WITH CHECK (EXISTS (SELECT 1 FROM production_jobs pj WHERE pj.id = job_payments.job_id AND pj.org_id = get_user_org_id(auth.uid())))
--   job_payments          "Admins can delete job payments"                DELETE USING ((EXISTS (SELECT 1 FROM production_jobs pj WHERE pj.id = job_payments.job_id AND pj.org_id = get_user_org_id(auth.uid()))) AND is_admin_or_manager(auth.uid()))
--   order_form_contracts  "Users can insert order form contracts"         INSERT WITH CHECK (org_id IN (SELECT users.org_id FROM users WHERE users.id = auth.uid()))
--   order_form_contracts  "Users can update order form contracts"         UPDATE USING (org_id IN (SELECT users.org_id FROM users WHERE users.id = auth.uid()))
--   opportunities         "Users can insert opportunities in their org"   INSERT WITH CHECK (org_id = get_user_org_id(auth.uid()))
--   opportunities         "Users can update opportunities in their org"   UPDATE USING (org_id = get_user_org_id(auth.uid()))
--   opportunities         "Admins/managers can delete opportunities in their org" DELETE USING ((org_id = get_user_org_id(auth.uid())) AND is_admin_or_manager(auth.uid()))
--   opportunities         "Users can view opportunities in their org"     ALL USING (org_id = get_user_org_id(auth.uid()))   (identical SELECT policy "Users can read opportunities in their org" exists, so no read copy)
--   job_change_orders     "Users can update change orders"                UPDATE USING (org_id IN (SELECT users.org_id FROM users WHERE users.id = auth.uid()))
--   job_invoices          "Users can insert invoices for their org jobs"  INSERT WITH CHECK (org_id = get_user_org_id(auth.uid()))
--   job_invoices          "Users can update draft invoices for their org jobs" UPDATE USING ((status = 'draft'::invoice_status) AND (org_id = get_user_org_id(auth.uid())))
--   job_invoice_items     "Users can insert invoice items for draft invoices" INSERT WITH CHECK (EXISTS (SELECT 1 FROM job_invoices ji JOIN production_jobs pj ON pj.id = ji.job_id WHERE ji.id = job_invoice_items.invoice_id AND ji.status = 'draft'::invoice_status AND pj.org_id = get_user_org_id(auth.uid())))
--   job_invoice_items     "Users can update invoice items for draft invoices" UPDATE USING (same EXISTS as the insert)
--   job_invoice_items     "Users can delete invoice items for draft invoices" DELETE USING (same EXISTS as the insert)
--   invoice_payments      "Users can insert invoice payments for their org" INSERT WITH CHECK (EXISTS (SELECT 1 FROM job_invoices ji JOIN production_jobs pj ON pj.id = ji.job_id WHERE ji.id = invoice_payments.invoice_id AND pj.org_id = get_user_org_id(auth.uid())))
--   job_cost_lines        "Users can insert job cost lines in their org"  INSERT WITH CHECK (org_id = get_user_org_id(auth.uid()))
--   job_cost_lines        "Users can update job cost lines in their org"  UPDATE USING (org_id = get_user_org_id(auth.uid())) WITH CHECK (org_id = get_user_org_id(auth.uid()))
--   proposals             "Users can create proposals"                    INSERT WITH CHECK (org_id IN (SELECT users.org_id FROM users WHERE users.id = auth.uid()))
--   proposals             "Users can update proposals"                    UPDATE USING (org_id IN (SELECT users.org_id FROM users WHERE users.id = auth.uid()))
--   proposal_line_items   "Users can manage proposal line items"          ALL USING (org_id IN (SELECT users.org_id FROM users WHERE users.id = auth.uid()))   (re-created below as SELECT "Users can manage proposal line items (read)")
--   integration_outbox    "Users can enqueue outbox events for their org" INSERT TO authenticated WITH CHECK (org_id = get_user_org_id(auth.uid()))
--   integration_outbox    "Users can update outbox events for their org"  UPDATE TO authenticated USING (org_id = get_user_org_id(auth.uid())) WITH CHECK (org_id = get_user_org_id(auth.uid()))
--   contracts             "Users can insert contracts"                    INSERT WITH CHECK (org_id = get_user_org_id(auth.uid()))
--   contracts             "Users can update contracts"                    UPDATE USING (org_id = get_user_org_id(auth.uid()))
--   contract_signatures   "Users can insert contract signatures"          INSERT WITH CHECK (org_id = get_user_org_id(auth.uid()))
--   contract_signatures   "Users can update contract signatures"          UPDATE USING (org_id = get_user_org_id(auth.uid()))
--   job_product_orders    "Users can create product orders"               INSERT WITH CHECK (EXISTS (SELECT 1 FROM production_jobs pj WHERE pj.id = job_product_orders.job_id AND pj.org_id = pj.org_id AND pj.org_id = (SELECT u.org_id FROM users u WHERE u.id = auth.uid())))
--   job_product_orders    "Users can update product orders"               UPDATE USING (EXISTS (SELECT 1 FROM production_jobs pj WHERE pj.id = job_product_orders.job_id AND pj.org_id = (SELECT u.org_id FROM users u WHERE u.id = auth.uid())))
--   job_product_orders    "Admins can delete product orders"              DELETE USING (EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.org_id = job_product_orders.org_id AND u.role = 'admin'::user_role))
--   users                 "Admins can insert users"                       INSERT WITH CHECK ((org_id = get_user_org_id(auth.uid())) AND is_admin_or_manager(auth.uid()))
--   users                 "Admins can update users"                       UPDATE USING ((org_id = get_user_org_id(auth.uid())) AND is_admin_or_manager(auth.uid()))
--   user_permissions      "Admins can manage user permissions"            ALL USING ((org_id = get_user_org_id(auth.uid())) AND is_admin_or_manager(auth.uid()))
--   custom_roles          "Admins can manage roles"                       ALL USING ((org_id = get_user_org_id(auth.uid())) AND is_admin_or_manager(auth.uid()))
--   permission_presets    "Admins can manage presets"                     ALL USING ((org_id = get_user_org_id(auth.uid())) AND is_admin_or_manager(auth.uid()))
--   role_permissions      "Admins can manage role permissions"            ALL USING ((EXISTS (SELECT 1 FROM custom_roles cr WHERE cr.id = role_permissions.role_id AND cr.org_id = get_user_org_id(auth.uid()))) AND is_admin_or_manager(auth.uid()))
--   preset_permissions    "Admins can manage preset permissions"          ALL USING ((EXISTS (SELECT 1 FROM permission_presets pp WHERE pp.id = preset_permissions.preset_id AND pp.org_id = get_user_org_id(auth.uid()))) AND is_admin_or_manager(auth.uid()))
--   (the migration also prints each dropped policy as a NOTICE.)
--   guard_users_is_super_admin: restore the 202610210010 body (is_super_admin only).
--   Functions: GRANT EXECUTE ON FUNCTION get_unpaid_referrals(uuid, integer), dashboard_count_door_leads_scoped(uuid,
--   timestamptz, timestamptz, uuid[]) TO authenticated; GRANT EXECUTE ON FUNCTION get_user_org_id(uuid), get_user_role(uuid),
--   is_admin_or_manager(uuid), get_sub_id_for_user(uuid) TO anon (prod had EXECUTE for anon + authenticated on all six).

-- ── 1 + 2a. Drop member write policies (whatever their names) ───────────────────────────────────────────────────────────
do $$
declare
  t text;
  p record;
  read_name text;
  keep constant text[] := array['job_change_orders|Users can insert change orders'];  -- dropped by 202611240045
  -- Their "manage" ALL policies only read a subset of what their org-wide SELECT policies already read: no read copy.
  people constant text[] := array['users', 'user_permissions', 'custom_roles', 'role_permissions', 'permission_presets', 'preset_permissions'];
  tables constant text[] := array[
    'job_payments', 'order_form_contracts', 'opportunities', 'job_change_orders', 'job_invoices', 'job_invoice_items',
    'invoice_payments', 'job_cost_lines', 'proposals', 'proposal_line_items', 'integration_outbox', 'contracts',
    'contract_signatures', 'job_product_orders',
    'users', 'user_permissions', 'custom_roles', 'role_permissions', 'permission_presets', 'preset_permissions'];
begin
  foreach t in array tables loop
    if to_regclass('public.' || t) is null then
      raise notice 'skip %: table not present', t;
      continue;
    end if;
    for p in
      select policyname, cmd, roles, qual, with_check
      from pg_policies
      where schemaname = 'public' and tablename = t and permissive = 'PERMISSIVE' and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
    loop
      if (t || '|' || p.policyname) = any (keep) then
        raise notice 'keeping %.% until 202611240045', t, p.policyname;
        continue;
      end if;
      raise notice 'dropping policy % on % (% to %) using (%) with check (%)', p.policyname, t, p.cmd, p.roles, p.qual, p.with_check;
      -- An ALL policy also let its holders READ: keep exactly that read unless the same read already exists.
      if p.cmd = 'ALL' and p.qual is not null and t <> all (people) and not exists (
        select 1 from pg_policies s
        where s.schemaname = 'public' and s.tablename = t and s.permissive = 'PERMISSIVE' and s.cmd = 'SELECT'
          and s.qual = p.qual and s.roles = p.roles
      ) then
        read_name := left(p.policyname, 56) || ' (read)';
        execute format('create policy %I on public.%I as permissive for select to %s using (%s)',
          read_name, t, (select string_agg(quote_ident(r), ', ') from unnest(p.roles) r), p.qual);
        raise notice '  kept its read as policy % (select using %)', read_name, p.qual;
      end if;
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
  end loop;
end $$;

-- ── 2b. Owner/admin-only writes on people, roles and permission grants ──────────────────────────────────────────────────
-- The app writes all of these with the service client (app/api/admin/users, admin/roles, admin/presets, permissions,
-- admin/user-permissions); these policies only limit what a signed-in owner/admin could do straight through the API.
do $$
declare
  owner_admin constant text := $q$(get_user_role(auth.uid())::text = any (array['admin'::text, 'owner'::text]))$q$;
begin
  if to_regclass('public.users') is not null then
    execute 'drop policy if exists "Owners and admins can insert users" on public.users';
    execute 'create policy "Owners and admins can insert users" on public.users for insert to authenticated with check ((org_id = get_user_org_id(auth.uid())) and ' || owner_admin || ')';
    execute 'drop policy if exists "Owners and admins can update users" on public.users';
    execute 'create policy "Owners and admins can update users" on public.users for update to authenticated using ((org_id = get_user_org_id(auth.uid())) and ' || owner_admin || ') with check ((org_id = get_user_org_id(auth.uid())) and ' || owner_admin || ')';
  end if;
  if to_regclass('public.user_permissions') is not null then
    execute 'drop policy if exists "Owners and admins can manage user permissions" on public.user_permissions';
    execute 'create policy "Owners and admins can manage user permissions" on public.user_permissions for all to authenticated using ((org_id = get_user_org_id(auth.uid())) and ' || owner_admin || ') with check ((org_id = get_user_org_id(auth.uid())) and ' || owner_admin || ')';
  end if;
  if to_regclass('public.custom_roles') is not null then
    execute 'drop policy if exists "Owners and admins can manage roles" on public.custom_roles';
    execute 'create policy "Owners and admins can manage roles" on public.custom_roles for all to authenticated using ((org_id = get_user_org_id(auth.uid())) and ' || owner_admin || ') with check ((org_id = get_user_org_id(auth.uid())) and ' || owner_admin || ')';
  end if;
  if to_regclass('public.permission_presets') is not null then
    execute 'drop policy if exists "Owners and admins can manage presets" on public.permission_presets';
    execute 'create policy "Owners and admins can manage presets" on public.permission_presets for all to authenticated using ((org_id = get_user_org_id(auth.uid())) and ' || owner_admin || ') with check ((org_id = get_user_org_id(auth.uid())) and ' || owner_admin || ')';
  end if;
  if to_regclass('public.role_permissions') is not null then
    execute 'drop policy if exists "Owners and admins can manage role permissions" on public.role_permissions';
    execute 'create policy "Owners and admins can manage role permissions" on public.role_permissions for all to authenticated using ((exists (select 1 from custom_roles cr where cr.id = role_permissions.role_id and cr.org_id = get_user_org_id(auth.uid()))) and ' || owner_admin || ') with check ((exists (select 1 from custom_roles cr where cr.id = role_permissions.role_id and cr.org_id = get_user_org_id(auth.uid()))) and ' || owner_admin || ')';
  end if;
  if to_regclass('public.preset_permissions') is not null then
    execute 'drop policy if exists "Owners and admins can manage preset permissions" on public.preset_permissions';
    execute 'create policy "Owners and admins can manage preset permissions" on public.preset_permissions for all to authenticated using ((exists (select 1 from permission_presets pp where pp.id = preset_permissions.preset_id and pp.org_id = get_user_org_id(auth.uid()))) and ' || owner_admin || ') with check ((exists (select 1 from permission_presets pp where pp.id = preset_permissions.preset_id and pp.org_id = get_user_org_id(auth.uid()))) and ' || owner_admin || ')';
  end if;
end $$;

-- ── 2c. users: role / custom role / company / active / super admin change only from the server ──────────────────────────
-- Same function and trigger as 202610210010 (BEFORE INSERT OR UPDATE on users), extended: one guard for every privileged
-- column. "Server" = request.jwt role service_role, or no JWT at all ('' = SQL editor, migrations, data fixes).
create or replace function public.guard_users_is_super_admin()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_role text := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                          (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'),
                          '');
  v_server boolean := v_role in ('service_role', '');
begin
  if tg_op = 'INSERT' then
    if coalesce(new.is_super_admin, false) and not v_server then
      raise exception 'is_super_admin can only be set by the server' using errcode = '42501';
    end if;
    new.super_admin_granted_at := case when coalesce(new.is_super_admin, false) then now() else null end;
    return new;
  end if;

  if new.is_super_admin is distinct from old.is_super_admin then
    if not v_server then
      raise exception 'is_super_admin can only be changed by the server' using errcode = '42501';
    end if;
    new.super_admin_granted_at := case when coalesce(new.is_super_admin, false) then now() else null end;
  end if;

  if not v_server and (
       new.role is distinct from old.role
    or new.custom_role_id is distinct from old.custom_role_id
    or new.org_id is distinct from old.org_id
    or new.active is distinct from old.active
  ) then
    raise exception 'role, custom role, company and active can only be changed by the server' using errcode = '42501';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_guard_users_is_super_admin on public.users;
create trigger trg_guard_users_is_super_admin
  before insert or update on public.users
  for each row execute function public.guard_users_is_super_admin();

-- ── 3. SECURITY DEFINER functions ───────────────────────────────────────────────────────────────────────────────────────
do $$
begin
  -- Trust a passed org id: server only.
  if to_regprocedure('public.get_unpaid_referrals(uuid, integer)') is not null then
    revoke execute on function public.get_unpaid_referrals(uuid, integer) from public, anon, authenticated;
    grant execute on function public.get_unpaid_referrals(uuid, integer) to service_role;
  end if;
  if to_regprocedure('public.dashboard_count_door_leads_scoped(uuid, timestamptz, timestamptz, uuid[])') is not null then
    revoke execute on function public.dashboard_count_door_leads_scoped(uuid, timestamptz, timestamptz, uuid[]) from public, anon, authenticated;
    grant execute on function public.dashboard_count_door_leads_scoped(uuid, timestamptz, timestamptz, uuid[]) to service_role;
  end if;
  -- RLS helpers: policies run them as `authenticated`; nobody without a JWT needs them.
  if to_regprocedure('public.get_user_org_id(uuid)') is not null then
    revoke execute on function public.get_user_org_id(uuid) from public, anon;
    grant execute on function public.get_user_org_id(uuid) to authenticated, service_role;
  end if;
  if to_regprocedure('public.get_user_role(uuid)') is not null then
    revoke execute on function public.get_user_role(uuid) from public, anon;
    grant execute on function public.get_user_role(uuid) to authenticated, service_role;
  end if;
  if to_regprocedure('public.is_admin_or_manager(uuid)') is not null then
    revoke execute on function public.is_admin_or_manager(uuid) from public, anon;
    grant execute on function public.is_admin_or_manager(uuid) to authenticated, service_role;
  end if;
  if to_regprocedure('public.get_sub_id_for_user(uuid)') is not null then
    revoke execute on function public.get_sub_id_for_user(uuid) from public, anon;
    grant execute on function public.get_sub_id_for_user(uuid) to authenticated, service_role;
  end if;
end $$;
