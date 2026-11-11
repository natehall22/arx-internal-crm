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
  completed_at timestamptz, priority text DEFAULT 'normal', description text, created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_orders_org_id_work_order_number_key UNIQUE (org_id, work_order_number),
  CONSTRAINT work_orders_org_trade_fkey FOREIGN KEY (org_id, trade) REFERENCES org_trades(org_id, slug),
  CONSTRAINT work_orders_status_check CHECK (status = ANY (ARRAY['pending','assigned','scheduled','in_progress','completed','cancelled','on_hold'])),
  CONSTRAINT work_orders_work_order_type_check CHECK (work_order_type = ANY (ARRAY['go_back','repair','warranty','punch_list','inspection','install','service_call']))
);
CREATE TABLE photos (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, job_id uuid NOT NULL, work_order_id uuid REFERENCES work_orders(id) ON DELETE SET NULL, storage_path text NOT NULL DEFAULT 'x', deleted_at timestamptz);

INSERT INTO orgs VALUES ('00000000-0000-0000-0000-000000000001', 'A'), ('00000000-0000-0000-0000-000000000002', 'B');
INSERT INTO users VALUES ('90000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001'), ('90000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002');
INSERT INTO customers VALUES ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000001', 'Pat'), ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000001', 'Sam'), ('20000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000002', 'Other');
INSERT INTO sub_contractors VALUES ('80000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Green Team'), ('80000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', 'Not ours');
INSERT INTO org_trades VALUES ('00000000-0000-0000-0000-000000000001', 'lawn'), ('00000000-0000-0000-0000-000000000002', 'lawn');
-- An existing ordinary work order, written before the migration.
INSERT INTO work_orders (id, org_id, work_order_type, status, work_order_number) VALUES ('60000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000001', 'repair', 'completed', 'WO-00041');

\i supabase/migrations/202611110010_properties.sql
\i supabase/migrations/202611110030_service_plans.sql
-- Idempotent: applying twice changes nothing and does not fail.
\i supabase/migrations/202611110030_service_plans.sql
-- The numbering trigger as prod has it (20260213_operations_tables.sql), now calling the counter version.
CREATE TRIGGER trigger_generate_work_order_number BEFORE INSERT ON work_orders FOR EACH ROW
  WHEN (NEW.work_order_number IS NULL OR NEW.work_order_number = '') EXECUTE FUNCTION generate_work_order_number();

DO $t$
DECLARE
  o1 uuid := '00000000-0000-0000-0000-000000000001'; o2 uuid := '00000000-0000-0000-0000-000000000002';
  ca uuid := '10000000-0000-0000-0000-00000000000a'; cb uuid := '10000000-0000-0000-0000-00000000000b'; c2 uuid := '20000000-0000-0000-0000-00000000000a';
  u1 uuid := '90000000-0000-0000-0000-000000000001'; u2 uuid := '90000000-0000-0000-0000-000000000002';
  s1 uuid := '80000000-0000-0000-0000-000000000001'; s2 uuid := '80000000-0000-0000-0000-000000000002';
  pa uuid; pb uuid; p2 uuid; plan uuid; v1 uuid; insp uuid; ok boolean; t1 uuid; t2 uuid; r jsonb; n int; keep uuid; gone uuid; photo_v uuid; v_upd timestamptz;
BEGIN
  INSERT INTO properties (org_id, customer_id, address_text) VALUES (o1, ca, '1 Oak St') RETURNING id INTO pa;
  INSERT INTO properties (org_id, customer_id, address_text) VALUES (o1, cb, '2 Elm St') RETURNING id INTO pb;
  INSERT INTO properties (org_id, customer_id, address_text) VALUES (o2, c2, '3 Pine St') RETURNING id INTO p2;

  -- T0 templates: own trade only; a plan may point only at its own company's template
  INSERT INTO service_plan_templates (org_id, name, trade, pricing, steps) VALUES (o1, 'Lawn', 'lawn', '{"fields":[],"tiers":[],"allowCustom":true}', '[]') RETURNING id INTO t1;
  INSERT INTO service_plan_templates (org_id, name, trade) VALUES (o2, 'Other lawn', 'lawn') RETURNING id INTO t2;
  ok := false; BEGIN INSERT INTO service_plan_templates (org_id, name, trade) VALUES (o1, 'x', 'pool'); EXCEPTION WHEN foreign_key_violation THEN ok := true; END; ASSERT ok, 'T0 template trade';
  ok := false; BEGIN INSERT INTO service_plans (org_id, customer_id, property_id, trade, name, start_date, created_by, template_id) VALUES (o1, ca, pa, 'lawn', 'x', '2026-03-02', u1, t2); EXCEPTION WHEN insufficient_privilege THEN ok := true; END; ASSERT ok, 'T0 other company template';

  -- T1 a plan; another customer's property / another company's crew / unknown trade refused
  INSERT INTO service_plans (org_id, customer_id, property_id, trade, name, start_date, created_by, default_sub_id, seasons, template_id, template_version, steps)
    VALUES (o1, ca, pa, 'lawn', 'Weekly mowing', '2026-03-02', u1, s1, '[{"from":"01-01","to":"12-31","frequency":"weekly"}]', t1, 1,
            '[{"key":"inspection","label":"Inspection","daysAfter":1,"assignTo":"person","userId":null,"subId":null,"results":[]}]') RETURNING id INTO plan;
  ok := false; BEGIN INSERT INTO service_plans (org_id, customer_id, property_id, trade, name, start_date, created_by) VALUES (o1, ca, pb, 'lawn', 'x', '2026-03-02', u1); EXCEPTION WHEN insufficient_privilege THEN ok := true; END; ASSERT ok, 'T1 other customer property';
  ok := false; BEGIN INSERT INTO service_plans (org_id, customer_id, property_id, trade, name, start_date, created_by, default_sub_id) VALUES (o1, ca, pa, 'lawn', 'x', '2026-03-02', u1, s2); EXCEPTION WHEN insufficient_privilege THEN ok := true; END; ASSERT ok, 'T1 other company crew';
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
  -- Follow-on results are the plan's own words (checked by the app); any short key is stored.
  UPDATE work_orders SET status = 'completed', step_result = 'needs_repair' WHERE id = insp;
  ok := false; BEGIN UPDATE work_orders SET step_result = 'red' WHERE id = v1; EXCEPTION WHEN check_violation THEN ok := true; END; ASSERT ok, 'T2 service visit carries no result';
  ok := false; BEGIN UPDATE work_orders SET visit_step = 'Bad Key' WHERE id = insp; EXCEPTION WHEN check_violation THEN ok := true; END; ASSERT ok, 'T2 step key shape';
  ok := false; BEGIN UPDATE work_orders SET status = 'skipped', skip_reason = 'rain' WHERE id = '60000000-0000-0000-0000-00000000000a'; EXCEPTION WHEN check_violation THEN ok := true; END; ASSERT ok, 'T2 only visits are skipped';
  ok := false; BEGIN INSERT INTO work_orders (org_id, work_order_type, visit_step, status, service_plan_id, service_planned_date, scheduled_date, trade) VALUES (o2, 'service_visit', 'service', 'scheduled', plan, '2026-11-10', '2026-11-10', 'lawn'); EXCEPTION WHEN insufficient_privilege THEN ok := true; END; ASSERT ok, 'T2 another company cannot use the plan';
  -- Old rows and old types still fine
  INSERT INTO work_orders (org_id, work_order_type, status) VALUES (o1, 'warranty', 'on_hold');

  -- T3 a plan with visits cannot be deleted (no silent orphaning)
  ok := false; BEGIN DELETE FROM service_plans WHERE id = plan; EXCEPTION WHEN foreign_key_violation THEN ok := true; END; ASSERT ok, 'T3 plan delete refused';

  -- T4 visit photos (no job); a photo with neither job nor visit refused
  INSERT INTO photos (org_id, job_id, work_order_id) VALUES (o1, NULL, v1);
  ok := false; BEGIN INSERT INTO photos (org_id, job_id, work_order_id) VALUES (o1, NULL, NULL); EXCEPTION WHEN check_violation THEN ok := true; END; ASSERT ok, 'T4 orphan photo';

  -- T4b history rows need a subject
  INSERT INTO service_plan_changes (org_id, plan_id, action, changed_by, changes) VALUES (o1, plan, 'updated', u1, '[{"field":"price","label":"Price","old":45,"new":50}]');
  ok := false; BEGIN INSERT INTO service_plan_changes (org_id, action) VALUES (o1, 'updated'); EXCEPTION WHEN check_violation THEN ok := true; END; ASSERT ok, 'T4b change needs plan or template';

  -- T5 crew links: one per crew, same company only, service role only, expire by default in 30 days
  INSERT INTO crew_day_links (org_id, sub_id, token) VALUES (o1, s1, repeat('a', 32));
  ASSERT (SELECT expires_at BETWEEN now() + interval '29 days' AND now() + interval '31 days' FROM crew_day_links WHERE sub_id = s1), 'T5 default expiry';
  ok := false; BEGIN INSERT INTO crew_day_links (org_id, sub_id, token) VALUES (o1, s2, repeat('b', 32)); EXCEPTION WHEN insufficient_privilege THEN ok := true; END; ASSERT ok, 'T5 other company crew';
  ok := false; BEGIN INSERT INTO crew_day_links (org_id, sub_id, token) VALUES (o1, s1, repeat('c', 32)); EXCEPTION WHEN unique_violation THEN ok := true; END; ASSERT ok, 'T5 one link per crew';
  ASSERT NOT has_table_privilege('authenticated', 'crew_day_links', 'SELECT'), 'T5 not readable by users';
  ASSERT NOT has_table_privilege('authenticated', 'service_plans', 'SELECT'), 'T5 plans not readable by users';
  ASSERT NOT has_table_privilege('authenticated', 'service_plan_templates', 'SELECT'), 'T5 templates not readable by users';
  ASSERT NOT has_table_privilege('authenticated', 'service_plan_changes', 'SELECT'), 'T5 history not readable by users';

  -- T6 save RPC: plan + visits in one go; a removed visit with a live photo is cancelled, one without is deleted;
  --    kept visits refreshed (incl. trade) + charges; a stale expected version refuses everything.
  n := service_plan_add_visits(o1, plan, NULL, '[{"service_planned_date":"2026-12-01","scheduled_date":"2026-12-01","price":45,"taxable":false},
                                              {"service_planned_date":"2026-12-08","scheduled_date":"2026-12-08","price":45},
                                              {"service_planned_date":"2026-12-15","scheduled_date":"2026-12-15","price":45}]');
  ASSERT n = 3, 'T6 added ' || n;
  ASSERT (SELECT count(*) FROM service_visit_charges c JOIN work_orders w ON w.id = c.work_order_id WHERE w.service_plan_id = plan AND c.price = 45) = 3, 'T6 charges beside visits';
  ASSERT service_plan_add_visits(o1, plan, NULL, '[{"service_planned_date":"2026-12-01","scheduled_date":"2026-12-01"}]') = 0, 'T6 idempotent slot';
  SELECT id INTO gone FROM work_orders WHERE service_plan_id = plan AND service_planned_date = '2026-12-01';
  SELECT id INTO photo_v FROM work_orders WHERE service_plan_id = plan AND service_planned_date = '2026-12-08';
  SELECT id INTO keep FROM work_orders WHERE service_plan_id = plan AND service_planned_date = '2026-12-15';
  INSERT INTO photos (org_id, job_id, work_order_id) VALUES (o1, NULL, photo_v);
  SELECT updated_at INTO v_upd FROM service_plans WHERE id = plan;
  INSERT INTO org_trades VALUES (o1, 'gutters');
  r := service_plan_save(o1, plan, v_upd, '{"price": 50, "trade": "gutters", "org_id": "00000000-0000-0000-0000-000000000002"}', ARRAY[gone, photo_v],
         jsonb_build_array(jsonb_build_object('ids', jsonb_build_array(keep), 'set', jsonb_build_object('trade', 'gutters', 'title', 'Mow+'), 'charge', jsonb_build_object('price', 50, 'taxable', true))));
  ASSERT (r->>'removed')::int = 1 AND (r->>'cancelled')::int = 1 AND (r->>'updated')::int = 1, 'T6 counts ' || r::text;
  ASSERT NOT EXISTS (SELECT 1 FROM work_orders WHERE id = gone), 'T6 deleted';
  ASSERT (SELECT status FROM work_orders WHERE id = photo_v) = 'cancelled', 'T6 photo visit cancelled, kept';
  ASSERT (SELECT trade || '|' || title FROM work_orders WHERE id = keep) = 'gutters|Mow+', 'T6 kept refreshed';
  ASSERT (SELECT price FROM service_visit_charges WHERE work_order_id = keep) = 50, 'T6 charge refreshed';
  ASSERT (SELECT org_id FROM service_plans WHERE id = plan) = o1, 'T6 patch cannot move the plan';
  ASSERT (SELECT price FROM service_plans WHERE id = plan) = 50, 'T6 plan saved';
  ok := false; BEGIN PERFORM service_plan_save(o1, plan, v_upd, '{"price": 60}', NULL, NULL); EXCEPTION WHEN serialization_failure THEN ok := true; END; ASSERT ok, 'T6 stale save refused';
  ASSERT (SELECT price FROM service_plans WHERE id = plan) = 50, 'T6 stale save wrote nothing';
  ASSERT service_plan_add_visits(o1, plan, v_upd, '[{"service_planned_date":"2026-12-22","scheduled_date":"2026-12-22"}]') = -1, 'T6 stale generator refused';
  ok := false; BEGIN PERFORM service_plan_save(o2, plan, NULL, '{}', NULL, NULL); EXCEPTION WHEN no_data_found THEN ok := true; END; ASSERT ok, 'T6 other company cannot save';
  ASSERT NOT has_table_privilege('authenticated', 'service_visit_charges', 'SELECT'), 'T6 charges not readable by users';
  ASSERT NOT has_function_privilege('authenticated', 'service_plan_save(uuid, uuid, timestamptz, jsonb, uuid[], jsonb)', 'EXECUTE'), 'T6 save not callable by users';

  -- T7 work order numbers: per company, continues from the highest existing, never truncated past 99,999
  ASSERT (SELECT work_order_number FROM work_orders WHERE id = v1) = 'WO-00042', 'T7 continues after WO-00041: ' || (SELECT work_order_number FROM work_orders WHERE id = v1);
  ASSERT (SELECT last_number FROM work_order_number_counters WHERE org_id = o1) >= 42, 'T7 counter row';
  UPDATE work_order_number_counters SET last_number = 99999 WHERE org_id = o1;
  INSERT INTO work_orders (org_id, work_order_type, status) VALUES (o1, 'repair', 'pending');
  ASSERT EXISTS (SELECT 1 FROM work_orders WHERE org_id = o1 AND work_order_number = 'WO-100000'), 'T7 widened past 99,999';
  INSERT INTO work_orders (org_id, work_order_type, status) VALUES (o2, 'repair', 'pending');
  ASSERT EXISTS (SELECT 1 FROM work_orders WHERE org_id = o2 AND work_order_number = 'WO-00001'), 'T7 per company';

  RAISE NOTICE 'REPORT: all assertions passed';
END $t$;
