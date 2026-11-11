-- Self-contained DB test for 202611110030_service_plans (on top of 202611110010_properties). THROWAWAY local Postgres only
-- (run-service-plans.sh). Builds a minimal copy of the touched tables with prod's CHECKs (read 2026-11-11), applies, asserts.
\set ON_ERROR_STOP 1
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
END $$;
DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;
CREATE TABLE orgs (id uuid PRIMARY KEY, name text);
CREATE TABLE users (id uuid PRIMARY KEY, org_id uuid REFERENCES orgs(id));
CREATE TABLE customers (id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE, name text);
CREATE TABLE opportunities (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, customer_id uuid REFERENCES customers(id), address_text text, lat numeric, lng numeric);
CREATE TABLE projects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, opportunity_id uuid);
CREATE TABLE production_jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, project_id uuid, customer_id uuid, address_text text, lat numeric, lng numeric);
CREATE TABLE documents (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, job_id uuid, customer_id uuid, deleted_at timestamptz);
CREATE TABLE sub_contractors (id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES orgs(id), company_name text, active boolean DEFAULT true);
CREATE TABLE org_trades (org_id uuid NOT NULL, slug text NOT NULL, CONSTRAINT org_trades_org_slug_key UNIQUE (org_id, slug));
CREATE TABLE work_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES orgs(id), work_order_number text,
  job_id uuid, customer_id uuid REFERENCES customers(id) ON DELETE SET NULL, trade text,
  work_order_type text NOT NULL DEFAULT 'go_back', status text NOT NULL DEFAULT 'pending',
  address text, city text, state text, zip text, title text NOT NULL DEFAULT 't', scheduled_date date, assigned_user_id uuid, assigned_sub_id uuid,
  completed_at timestamptz,
  CONSTRAINT work_orders_org_trade_fkey FOREIGN KEY (org_id, trade) REFERENCES org_trades(org_id, slug),
  CONSTRAINT work_orders_status_check CHECK (status = ANY (ARRAY['pending','assigned','scheduled','in_progress','completed','cancelled','on_hold'])),
  CONSTRAINT work_orders_work_order_type_check CHECK (work_order_type = ANY (ARRAY['go_back','repair','warranty','punch_list','inspection','install','service_call']))
);
CREATE TABLE photos (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, job_id uuid NOT NULL, work_order_id uuid REFERENCES work_orders(id) ON DELETE SET NULL, storage_path text NOT NULL DEFAULT 'x');

INSERT INTO orgs VALUES ('00000000-0000-0000-0000-000000000001', 'A'), ('00000000-0000-0000-0000-000000000002', 'B');
INSERT INTO users VALUES ('90000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001'), ('90000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002');
INSERT INTO customers VALUES ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000001', 'Pat'), ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000001', 'Sam'), ('20000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000002', 'Other');
INSERT INTO sub_contractors VALUES ('80000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Green Team'), ('80000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', 'Not ours');
INSERT INTO org_trades VALUES ('00000000-0000-0000-0000-000000000001', 'lawn'), ('00000000-0000-0000-0000-000000000002', 'lawn');
-- An existing ordinary work order, written before the migration.
INSERT INTO work_orders (id, org_id, work_order_type, status) VALUES ('60000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000001', 'repair', 'completed');

\i supabase/migrations/202611110010_properties.sql
\i supabase/migrations/202611110030_service_plans.sql
-- Idempotent: applying twice changes nothing and does not fail.
\i supabase/migrations/202611110030_service_plans.sql

DO $t$
DECLARE
  o1 uuid := '00000000-0000-0000-0000-000000000001'; o2 uuid := '00000000-0000-0000-0000-000000000002';
  ca uuid := '10000000-0000-0000-0000-00000000000a'; cb uuid := '10000000-0000-0000-0000-00000000000b'; c2 uuid := '20000000-0000-0000-0000-00000000000a';
  u1 uuid := '90000000-0000-0000-0000-000000000001'; u2 uuid := '90000000-0000-0000-0000-000000000002';
  s1 uuid := '80000000-0000-0000-0000-000000000001'; s2 uuid := '80000000-0000-0000-0000-000000000002';
  pa uuid; pb uuid; p2 uuid; plan uuid; v1 uuid; insp uuid; ok boolean;
BEGIN
  INSERT INTO properties (org_id, customer_id, address_text) VALUES (o1, ca, '1 Oak St') RETURNING id INTO pa;
  INSERT INTO properties (org_id, customer_id, address_text) VALUES (o1, cb, '2 Elm St') RETURNING id INTO pb;
  INSERT INTO properties (org_id, customer_id, address_text) VALUES (o2, c2, '3 Pine St') RETURNING id INTO p2;

  -- T1 a plan; another customer's property / another company's crew / follow-up person / unknown trade refused
  INSERT INTO service_plans (org_id, customer_id, property_id, trade, name, start_date, created_by, default_sub_id, seasons)
    VALUES (o1, ca, pa, 'lawn', 'Weekly mowing', '2026-03-02', u1, s1, '[{"from":"01-01","to":"12-31","frequency":"weekly"}]') RETURNING id INTO plan;
  ok := false; BEGIN INSERT INTO service_plans (org_id, customer_id, property_id, trade, name, start_date, created_by) VALUES (o1, ca, pb, 'lawn', 'x', '2026-03-02', u1); EXCEPTION WHEN insufficient_privilege THEN ok := true; END; ASSERT ok, 'T1 other customer property';
  ok := false; BEGIN INSERT INTO service_plans (org_id, customer_id, property_id, trade, name, start_date, created_by, default_sub_id) VALUES (o1, ca, pa, 'lawn', 'x', '2026-03-02', u1, s2); EXCEPTION WHEN insufficient_privilege THEN ok := true; END; ASSERT ok, 'T1 other company crew';
  ok := false; BEGIN INSERT INTO service_plans (org_id, customer_id, property_id, trade, name, start_date, created_by, follow_up, follow_up_days, follow_up_user_id) VALUES (o1, ca, pa, 'lawn', 'x', '2026-03-02', u1, 'inspection', 1, u2); EXCEPTION WHEN insufficient_privilege THEN ok := true; END; ASSERT ok, 'T1 other company inspector';
  ok := false; BEGIN INSERT INTO service_plans (org_id, customer_id, property_id, trade, name, start_date, created_by) VALUES (o1, ca, pa, 'pool', 'x', '2026-03-02', u1); EXCEPTION WHEN foreign_key_violation THEN ok := true; END; ASSERT ok, 'T1 unknown trade';
  ok := false; BEGIN UPDATE service_plans SET customer_id = cb, property_id = pb WHERE id = plan; EXCEPTION WHEN insufficient_privilege THEN ok := true; END; ASSERT ok, 'T1 plan cannot change customer';
  ok := false; BEGIN INSERT INTO service_plans (org_id, customer_id, property_id, trade, name, start_date, created_by, billing_basis) VALUES (o1, ca, pa, 'lawn', 'x', '2026-03-02', u1, 'per_week'); EXCEPTION WHEN check_violation THEN ok := true; END; ASSERT ok, 'T1 billing basis list';

  -- T2 visits: shape, idempotency key, property fill trigger agrees, skip needs a reason, inspection needs a result
  INSERT INTO work_orders (org_id, work_order_type, visit_step, status, service_plan_id, service_planned_date, scheduled_date, trade, customer_id, property_id, assigned_sub_id)
    VALUES (o1, 'service_visit', 'service', 'scheduled', plan, '2026-11-10', '2026-11-10', 'lawn', ca, pa, s1) RETURNING id INTO v1;
  ok := false; BEGIN INSERT INTO work_orders (org_id, work_order_type, visit_step, status, service_plan_id, service_planned_date, scheduled_date, trade, customer_id)
    VALUES (o1, 'service_visit', 'service', 'scheduled', plan, '2026-11-10', '2026-11-12', 'lawn', ca); EXCEPTION WHEN unique_violation THEN ok := true; END; ASSERT ok, 'T2 one visit per slot';
  INSERT INTO work_orders (org_id, work_order_type, visit_step, status, service_plan_id, service_planned_date, scheduled_date, trade, customer_id, parent_visit_id, assigned_user_id)
    VALUES (o1, 'service_visit', 'inspection', 'scheduled', plan, '2026-11-10', '2026-11-11', 'lawn', ca, v1, u1) RETURNING id INTO insp;
  ASSERT (SELECT property_id FROM work_orders WHERE id = v1) = pa, 'T2 property kept';
  ok := false; BEGIN INSERT INTO work_orders (org_id, work_order_type, status, service_plan_id, service_planned_date, scheduled_date, customer_id) VALUES (o1, 'service_visit', 'scheduled', plan, '2026-11-17', '2026-11-17', ca); EXCEPTION WHEN check_violation THEN ok := true; END; ASSERT ok, 'T2 visit needs trade + step';
  ok := false; BEGIN UPDATE work_orders SET status = 'skipped' WHERE id = v1; EXCEPTION WHEN check_violation THEN ok := true; END; ASSERT ok, 'T2 skip needs a reason';
  UPDATE work_orders SET status = 'skipped', skip_reason = 'rain' WHERE id = v1;
  ok := false; BEGIN UPDATE work_orders SET status = 'completed' WHERE id = insp; EXCEPTION WHEN check_violation THEN ok := true; END; ASSERT ok, 'T2 inspection needs a result';
  UPDATE work_orders SET status = 'completed', health_result = 'yellow' WHERE id = insp;
  ok := false; BEGIN UPDATE work_orders SET health_result = 'red' WHERE id = v1; EXCEPTION WHEN check_violation THEN ok := true; END; ASSERT ok, 'T2 service visit carries no result';
  ok := false; BEGIN UPDATE work_orders SET status = 'skipped', skip_reason = 'rain' WHERE id = '60000000-0000-0000-0000-00000000000a'; EXCEPTION WHEN check_violation THEN ok := true; END; ASSERT ok, 'T2 only visits are skipped';
  ok := false; BEGIN INSERT INTO work_orders (org_id, work_order_type, visit_step, status, service_plan_id, service_planned_date, scheduled_date, trade) VALUES (o2, 'service_visit', 'service', 'scheduled', plan, '2026-11-10', '2026-11-10', 'lawn'); EXCEPTION WHEN insufficient_privilege THEN ok := true; END; ASSERT ok, 'T2 another company cannot use the plan';
  -- Old rows and old types still fine
  INSERT INTO work_orders (org_id, work_order_type, status) VALUES (o1, 'warranty', 'on_hold');

  -- T3 a plan with visits cannot be deleted (no silent orphaning)
  ok := false; BEGIN DELETE FROM service_plans WHERE id = plan; EXCEPTION WHEN foreign_key_violation THEN ok := true; END; ASSERT ok, 'T3 plan delete refused';

  -- T4 visit photos (no job); a photo with neither job nor visit refused
  INSERT INTO photos (org_id, job_id, work_order_id) VALUES (o1, NULL, v1);
  ok := false; BEGIN INSERT INTO photos (org_id, job_id, work_order_id) VALUES (o1, NULL, NULL); EXCEPTION WHEN check_violation THEN ok := true; END; ASSERT ok, 'T4 orphan photo';

  -- T5 crew links: one per crew, same company only, service role only
  INSERT INTO crew_day_links (org_id, sub_id, token) VALUES (o1, s1, repeat('a', 32));
  ok := false; BEGIN INSERT INTO crew_day_links (org_id, sub_id, token) VALUES (o1, s2, repeat('b', 32)); EXCEPTION WHEN insufficient_privilege THEN ok := true; END; ASSERT ok, 'T5 other company crew';
  ok := false; BEGIN INSERT INTO crew_day_links (org_id, sub_id, token) VALUES (o1, s1, repeat('c', 32)); EXCEPTION WHEN unique_violation THEN ok := true; END; ASSERT ok, 'T5 one link per crew';
  ASSERT NOT has_table_privilege('authenticated', 'crew_day_links', 'SELECT'), 'T5 not readable by users';
  ASSERT NOT has_table_privilege('authenticated', 'service_plans', 'SELECT'), 'T5 plans not readable by users';

  RAISE NOTICE 'REPORT: all assertions passed';
END $t$;
