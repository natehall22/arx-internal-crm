-- DB test for project tools (migration 202611120080) on a minimal stand-in for the tables it touches.
-- Throwaway local Postgres only: drops and rebuilds schema public.
\set ON_ERROR_STOP on
drop schema if exists public cascade; create schema public;
create table orgs (id uuid primary key default gen_random_uuid());
create table users (id uuid primary key default gen_random_uuid());
create table production_jobs (id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id));
create table work_orders (id uuid primary key default gen_random_uuid());
create table job_change_orders (id uuid primary key default gen_random_uuid());
create table job_cost_lines (id uuid primary key default gen_random_uuid(), org_id uuid not null);
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
\i supabase/migrations/202611120080_project_tools.sql
-- applying twice is harmless
\i supabase/migrations/202611120080_project_tools.sql

do $$
declare a uuid; b uuid; ja uuid; jb uuid; u uuid; r jsonb; n int; ok boolean;
begin
  insert into orgs default values returning id into a;
  insert into orgs default values returning id into b;
  insert into users default values returning id into u;
  insert into production_jobs (org_id) values (a) returning id into ja;
  insert into production_jobs (org_id) values (b) returning id into jb;

  -- first set: writes the line and a history row (old = null)
  r := set_job_budget_line(a, ja, 'materials', 5000, u, 'initial');
  assert (r->>'changed')::boolean, 'first set changes';
  assert (select amount from job_budget_lines where job_id = ja and cost_code = 'materials') = 5000, 'amount stored';
  assert (select count(*) from job_budget_changes where job_id = ja) = 1, 'one history row';
  assert (select old_amount is null and new_amount = 5000 and reason = 'initial' from job_budget_changes where job_id = ja), 'history shape';

  -- same amount: nothing written
  r := set_job_budget_line(a, ja, 'materials', 5000, u, null);
  assert not (r->>'changed')::boolean, 'unchanged is a no-op';
  assert (select count(*) from job_budget_changes where job_id = ja) = 1, 'no extra history';

  -- edit: line updated in place, history keeps old and new
  r := set_job_budget_line(a, ja, 'materials', 5500.456, u, '  ');
  assert (select amount from job_budget_lines where job_id = ja and cost_code = 'materials') = 5500.46, 'rounded to cents';
  assert (select count(*) from job_budget_lines where job_id = ja) = 1, 'still one line';
  assert (select count(*) from job_budget_changes where job_id = ja) = 2, 'two history rows';
  assert (select old_amount = 5000 and new_amount = 5500.46 and reason is null from job_budget_changes where job_id = ja order by changed_at desc, id limit 1), 'old -> new, blank reason = null';

  -- another company's job: refused, nothing written
  ok := false;
  begin perform set_job_budget_line(a, jb, 'materials', 1, u, null); exception when sqlstate 'P0002' then ok := true; end;
  assert ok, 'other company job refused';
  assert (select count(*) from job_budget_lines where job_id = jb) = 0, 'nothing written for the other company';

  -- negative refused
  ok := false;
  begin perform set_job_budget_line(a, ja, 'labor', -5, u, null); exception when others then ok := true; end;
  assert ok, 'negative refused';
  ok := false;
  begin insert into job_budget_lines (org_id, job_id, cost_code, amount) values (a, ja, 'labor', -1); exception when check_violation then ok := true; end;
  assert ok, 'check constraint on amount';

  -- selections / stages / logs constraints
  ok := false;
  begin insert into job_selections (org_id, job_id, item, status) values (a, ja, 'x', 'bogus'); exception when check_violation then ok := true; end;
  assert ok, 'selection status check';
  insert into job_selections (org_id, job_id, item, link_token) values (a, ja, 'Faucet', 'tok1');
  ok := false;
  begin insert into job_selections (org_id, job_id, item, link_token) values (a, ja, 'Faucet2', 'tok1'); exception when unique_violation then ok := true; end;
  assert ok, 'link token unique';
  insert into job_stages (org_id, job_id, stage_key, name, start_date) values (a, ja, 'framing', 'Framing', '2026-03-02');
  ok := false;
  begin insert into job_stages (org_id, job_id, stage_key, name, start_date) values (a, ja, 'framing', 'Again', '2026-03-03'); exception when unique_violation then ok := true; end;
  assert ok, 'one stage key per job';
  insert into job_daily_logs (org_id, job_id, log_date, note) values (a, ja, '2026-03-02', 'hi');
  ok := false;
  begin insert into job_daily_logs (org_id, job_id, log_date, source) values (a, ja, '2026-03-02', 'robot'); exception when check_violation then ok := true; end;
  assert ok, 'log source check';

  -- cost codes: unique per company, slug check
  insert into org_cost_codes (org_id, code, label) values (a, 'framing', 'Framing');
  insert into org_cost_codes (org_id, code, label) values (b, 'framing', 'Framing');
  ok := false;
  begin insert into org_cost_codes (org_id, code, label) values (a, 'framing', 'X'); exception when unique_violation then ok := true; end;
  assert ok, 'code unique per company';
  ok := false;
  begin insert into org_cost_codes (org_id, code, label) values (a, 'Bad Code', 'X'); exception when check_violation then ok := true; end;
  assert ok, 'code slug check';

  -- every new table is service-role only (RLS on, no policies); the function is not callable by app roles
  select count(*) into n from pg_class c join pg_namespace ns on ns.oid = c.relnamespace where ns.nspname = 'public' and c.relname in ('org_cost_codes','job_budget_lines','job_budget_changes','job_selections','job_stages','job_daily_logs') and c.relrowsecurity;
  assert n = 6, 'RLS on every new table';
  select count(*) into n from pg_policy where polrelid::regclass::text in ('org_cost_codes','job_budget_lines','job_budget_changes','job_selections','job_stages','job_daily_logs');
  assert n = 0, 'no policies';
  assert not has_function_privilege('authenticated', 'set_job_budget_line(uuid,uuid,text,numeric,uuid,text)', 'execute'), 'authenticated cannot call the writer';
  assert not has_function_privilege('anon', 'set_job_budget_line(uuid,uuid,text,numeric,uuid,text)', 'execute'), 'anon cannot call the writer';

  raise notice 'REPORT: all assertions passed';
end $$;
