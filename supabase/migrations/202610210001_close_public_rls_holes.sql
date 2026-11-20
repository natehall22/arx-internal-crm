-- Close database rules that let the public (anon) key read/write sensitive rows.
-- Logged-in users and server code (service role) keep the same access as before.
-- Rollback SQL is at the bottom.

begin;

-- 1. Signed contracts: the "by token" anon rules matched every row (USING true).
--    The signing page and /api/contracts/sign use the service role, which bypasses RLS,
--    so they don't need these. Org-scoped rules for logged-in users stay.
drop policy if exists "Anon can read contracts by token" on public.order_form_contracts;
drop policy if exists "Anon can update contracts by token" on public.order_form_contracts;

-- 2. Integration outbox: "Service role can manage outbox" was granted to PUBLIC.
--    Service role bypasses RLS and never needed it. Logged-in users keep enqueue
--    (insert/upsert) and read access for their own org only.
drop policy if exists "Service role can manage outbox" on public.integration_outbox;
create policy "Users can enqueue outbox events for their org"
  on public.integration_outbox for insert to authenticated
  with check (org_id = get_user_org_id(auth.uid()));
create policy "Users can update outbox events for their org"
  on public.integration_outbox for update to authenticated
  using (org_id = get_user_org_id(auth.uid()))
  with check (org_id = get_user_org_id(auth.uid()));

-- 3. Report access/schedule tables: same behaviour for logged-in users, anon blocked.
--    (Per-org scoping comes with the multi-company work.)
drop policy if exists "Users can view report access" on public.report_role_access;
create policy "Users can view report access"
  on public.report_role_access for all to authenticated
  using (true) with check (true);

drop policy if exists "Users can view report schedules" on public.report_schedules;
create policy "Users can view report schedules"
  on public.report_schedules for all to authenticated
  using (true) with check (true);

-- 4. Leftover backup tables had RLS off. Turning it on with no policies leaves them
--    readable only by the service role. Nothing in the app reads them.
alter table public._backup_roof_measurements_20260904 enable row level security;
alter table public._backup_roof_measurements_20260904b enable row level security;

commit;

-- ROLLBACK (only if something breaks):
-- create policy "Anon can read contracts by token" on public.order_form_contracts for select using (true);
-- create policy "Anon can update contracts by token" on public.order_form_contracts for update using (true);
-- drop policy "Users can enqueue outbox events for their org" on public.integration_outbox;
-- drop policy "Users can update outbox events for their org" on public.integration_outbox;
-- create policy "Service role can manage outbox" on public.integration_outbox for all using (true);
-- drop policy "Users can view report access" on public.report_role_access;
-- create policy "Users can view report access" on public.report_role_access for all using (true);
-- drop policy "Users can view report schedules" on public.report_schedules;
-- create policy "Users can view report schedules" on public.report_schedules for all using (true);
-- alter table public._backup_roof_measurements_20260904 disable row level security;
-- alter table public._backup_roof_measurements_20260904b disable row level security;
