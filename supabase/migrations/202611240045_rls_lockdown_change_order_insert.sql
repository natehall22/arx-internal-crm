-- RLS lockdown, step 2 of 2 for job_change_orders (security sweep 2026-11-13, finding #2). NOT applied.
--
-- APPLY ORDER: AFTER the fix/rls-lockdown code is deployed (and after 202611240040). Until that deploy,
-- POST /api/change-orders/create inserted in-person change orders with the caller's JWT and needed this policy; the new code
-- inserts with the service client (route = gate: requireAuthApi, field-role bar, firstForeignRef, org_id from the profile).
-- Applied before the deploy, in-person change orders would fail to save until the deploy lands.
--
-- Without it any signed-in member could insert a "completed" change order on any job of their company straight through
-- PostgREST; the next commission-base sync would count it (signed contract + signed change orders).
--
-- ROLLBACK (prod definition 2026-11-13, roles {public}):
--   create policy "Users can insert change orders" on public.job_change_orders for insert
--     with check (org_id in (select users.org_id from users where users.id = auth.uid()));

do $$
declare
  p record;
begin
  if to_regclass('public.job_change_orders') is null then return; end if;
  for p in
    select policyname, cmd, roles, qual, with_check from pg_policies
    where schemaname = 'public' and tablename = 'job_change_orders' and permissive = 'PERMISSIVE' and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  loop
    raise notice 'dropping policy % on job_change_orders (% to %) using (%) with check (%)', p.policyname, p.cmd, p.roles, p.qual, p.with_check;
    execute format('drop policy %I on public.job_change_orders', p.policyname);
  end loop;
end $$;
