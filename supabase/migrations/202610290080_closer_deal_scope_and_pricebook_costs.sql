-- Closers (rep / sales_rep / closer): prices, proposals, contracts, payments and job money only on DEALS THEY ARE ON.
-- "On a deal" (one definition, arx_private.opp_mine): owner / setter / assigned on the opportunity, closer on its lead, or closer on one of its
-- appointments; a proposal / contract / job is theirs when they created it or its deal is theirs.
-- Managers, owners, ops, admins and subs are untouched. RESTRICTIVE select policies only; writes untouched. The app reads these tables with
-- the service role (and the proposal PDF with the user's session, which this keeps working for their own proposals).
--
-- Pricebook: sell prices stay readable by sales roles; COST and MARGIN columns (cost_price, material_cost, labor_cost, profit_margin_percent)
-- are no longer readable with ANY user token (column privileges). Owners / admins / ops see them through the server (service role), which
-- strips them for everyone else (lib/pricebook-costs.ts). Rollback at the bottom.
begin;

create or replace function arx_private.opp_mine(p_user uuid, p_opp uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_opp is not null and (
       exists (select 1 from public.opportunities o where o.id = p_opp and (o.owner_user_id = p_user or o.setter_user_id = p_user or o.assigned_user_id = p_user))
    or exists (select 1 from public.opportunities o join public.leads l on l.id = o.lead_id where o.id = p_opp and l.closer_user_id = p_user)
    or exists (select 1 from public.scheduled_appointments a where a.opportunity_id = p_opp and a.closer_user_id = p_user)
  );
$$;

create or replace function arx_private.project_mine(p_user uuid, p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_project is not null and exists (
    select 1 from public.projects pr
     where pr.id = p_project and (pr.owner_user_id = p_user or arx_private.opp_mine(p_user, pr.opportunity_id))
  );
$$;

-- Cross-table checks go through these definer functions (not inline sub-selects) so the policies cannot recurse into each other.
create or replace function arx_private.proposal_mine(p_user uuid, p_proposal uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_proposal is not null and exists (
    select 1 from public.proposals p
     where p.id = p_proposal and (p.created_by = p_user or arx_private.opp_mine(p_user, p.opportunity_id) or arx_private.project_mine(p_user, p.project_id))
  );
$$;

create or replace function arx_private.job_mine(p_user uuid, p_job uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_job is not null and exists (
    select 1 from public.production_jobs j
     where j.id = p_job and (j.created_by = p_user or arx_private.project_mine(p_user, j.project_id)
                              or arx_private.proposal_mine(p_user, j.accepted_proposal_id) or arx_private.proposal_mine(p_user, j.linked_proposal_id))
  );
$$;

create or replace function arx_private.invoice_mine(p_user uuid, p_invoice uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_invoice is not null and exists (select 1 from public.job_invoices i where i.id = p_invoice and (i.created_by = p_user or arx_private.job_mine(p_user, i.job_id)));
$$;

create or replace function public.is_closer_self()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select lower(btrim(u.role::text)) in ('rep', 'sales_rep', 'closer') and not coalesce(u.is_super_admin, false)
                     from public.users u where u.id = auth.uid()), false);
$$;

create or replace function public.opp_is_mine_self(p_opp uuid) returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select arx_private.opp_mine(auth.uid(), p_opp); $$;
create or replace function public.project_is_mine_self(p_project uuid) returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select arx_private.project_mine(auth.uid(), p_project); $$;
-- Service side: which of these opportunities are the user's (APIs use it for by-id reads).
create or replace function public.proposal_is_mine_self(p uuid) returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select arx_private.proposal_mine(auth.uid(), p); $$;
create or replace function public.job_is_mine_self(p uuid) returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select arx_private.job_mine(auth.uid(), p); $$;
create or replace function public.invoice_is_mine_self(p uuid) returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select arx_private.invoice_mine(auth.uid(), p); $$;
create or replace function public.my_opportunity_ids(p_user uuid, p_ids uuid[]) returns setof uuid language sql stable security definer set search_path = public, pg_temp
as $$ select i from unnest(p_ids) as i where arx_private.opp_mine(p_user, i); $$;

revoke all on function public.is_closer_self() from public, anon;
revoke all on function public.opp_is_mine_self(uuid) from public, anon;
revoke all on function public.project_is_mine_self(uuid) from public, anon;
revoke all on function public.my_opportunity_ids(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.proposal_is_mine_self(uuid) from public, anon;
revoke all on function public.job_is_mine_self(uuid) from public, anon;
revoke all on function public.invoice_is_mine_self(uuid) from public, anon;
grant execute on function public.proposal_is_mine_self(uuid), public.job_is_mine_self(uuid), public.invoice_is_mine_self(uuid) to authenticated, service_role;
revoke all on function arx_private.proposal_mine(uuid, uuid), arx_private.job_mine(uuid, uuid), arx_private.invoice_mine(uuid, uuid) from public, anon, authenticated;
revoke all on function arx_private.opp_mine(uuid, uuid) from public, anon, authenticated;
revoke all on function arx_private.project_mine(uuid, uuid) from public, anon, authenticated;
grant execute on function public.is_closer_self() to authenticated, service_role;
grant execute on function public.opp_is_mine_self(uuid) to authenticated, service_role;
grant execute on function public.project_is_mine_self(uuid) to authenticated, service_role;
grant execute on function public.my_opportunity_ids(uuid, uuid[]) to service_role;

drop policy if exists closer_own_deals on public.proposals;
create policy closer_own_deals on public.proposals as restrictive for select to authenticated
  using (not (select public.is_closer_self()) or created_by = (select auth.uid()) or public.opp_is_mine_self(opportunity_id) or public.project_is_mine_self(project_id));

drop policy if exists closer_own_deals on public.order_form_contracts;
create policy closer_own_deals on public.order_form_contracts as restrictive for select to authenticated
  using (not (select public.is_closer_self()) or created_by = (select auth.uid()) or public.opp_is_mine_self(opportunity_id) or public.proposal_is_mine_self(proposal_id));

drop policy if exists closer_own_deals on public.proposal_line_items;
create policy closer_own_deals on public.proposal_line_items as restrictive for select to authenticated
  using (not (select public.is_closer_self()) or public.proposal_is_mine_self(proposal_id));

drop policy if exists closer_own_deals on public.production_jobs;
create policy closer_own_deals on public.production_jobs as restrictive for select to authenticated
  using (not (select public.is_closer_self()) or created_by = (select auth.uid()) or public.project_is_mine_self(project_id)
         or public.proposal_is_mine_self(accepted_proposal_id) or public.proposal_is_mine_self(linked_proposal_id));

do $$
declare t text;
begin
  foreach t in array array['job_payments', 'job_invoices', 'job_additional_scope', 'job_change_orders'] loop
    execute format('drop policy if exists closer_own_deals on public.%I', t);
    execute format('create policy closer_own_deals on public.%I as restrictive for select to authenticated using (not (select public.is_closer_self()) or created_by = (select auth.uid()) or public.job_is_mine_self(job_id))', t);
  end loop;
end $$;

drop policy if exists closer_own_deals on public.job_invoice_items;
create policy closer_own_deals on public.job_invoice_items as restrictive for select to authenticated
  using (not (select public.is_closer_self()) or public.invoice_is_mine_self(invoice_id));

-- Pricebook: cost / margin columns closed to every user token.
revoke select on public.pricebook_items from authenticated, anon;
grant select (id, org_id, pricebook_id, category, item_type, name, unit, unit_price, price_type, is_labor, is_taxable, is_commissionable, active, created_at, updated_at,
              is_adder, adder_category, commission_percent, commission_cap, visibility, show_to_customer, manager_spo_enabled, manager_spo_percent, role_commission_rates, image_url)
  on public.pricebook_items to authenticated;

revoke select on public.roofing_types from authenticated, anon;
grant select (id, org_id, name, description, pricing_unit, unit_price, labor_multiplier, default_warranty_years, default_warranty_text, color, icon, sort_order, is_default, active, created_at, updated_at)
  on public.roofing_types to authenticated;

commit;

-- ROLLBACK:
-- drop policy closer_own_deals on proposals, order_form_contracts, proposal_line_items, production_jobs, job_payments, job_invoices,
--   job_additional_scope, job_change_orders, job_invoice_items;
-- grant select on public.pricebook_items to authenticated; grant select on public.roofing_types to authenticated;
