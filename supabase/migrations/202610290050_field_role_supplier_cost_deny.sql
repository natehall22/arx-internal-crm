-- Same rule as 202610290020 for the supplier-order tables (material costs, supplier pricing): closed to field roles.
-- Ops screens read them with the service role. Also closes the anon execute on can_view_pricing_item.
begin;

do $$
declare t text;
begin
  foreach t in array array['supplier_orders', 'supplier_order_send_lines', 'supplier_order_send_sourcing', 'job_trade_material_sources', 'org_trade_material_defaults'] loop
    execute format('drop policy if exists field_role_money_deny on public.%I', t);
    execute format('create policy field_role_money_deny on public.%I as restrictive for select to authenticated using (not public.is_field_role_self())', t);
  end loop;
end $$;

do $$
begin
  if to_regprocedure('public.can_view_pricing_item(uuid)') is not null then
    revoke all on function public.can_view_pricing_item(uuid) from public, anon;
  end if;
end $$;

commit;
-- ROLLBACK: drop policy field_role_money_deny on each of the five tables.
