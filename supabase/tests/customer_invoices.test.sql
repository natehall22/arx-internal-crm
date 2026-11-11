-- Self-contained DB test for 202611110060_customer_invoices (invoices without a job). THROWAWAY local Postgres only
-- (run-customer-invoices.sh). Builds minimal copies of the touched tables, applies the real invoice / payment / properties /
-- service-plan / sales-tax migrations in order, then asserts: job invoices unchanged, customer invoices numbered and
-- company-checked, create_service_invoice idempotent (visits + plan-months), void frees, payments without a job.
\set ON_ERROR_STOP 1
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
END $$;
DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;
DROP SCHEMA IF EXISTS auth CASCADE; CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
CREATE TABLE orgs (id uuid PRIMARY KEY, name text);
CREATE TABLE users (id uuid PRIMARY KEY, org_id uuid REFERENCES orgs(id));
CREATE FUNCTION get_user_org_id(u uuid) RETURNS uuid LANGUAGE sql AS $$ SELECT org_id FROM users WHERE id = u $$;
CREATE FUNCTION is_admin_or_manager(u uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE TABLE customers (id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE, name text);
CREATE TABLE opportunities (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, customer_id uuid REFERENCES customers(id), address_text text, lat numeric, lng numeric);
CREATE TABLE projects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, opportunity_id uuid);
CREATE TABLE production_jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, job_number text, project_id uuid, customer_id uuid, address_text text, lat numeric, lng numeric);
CREATE TABLE documents (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, job_id uuid, customer_id uuid, deleted_at timestamptz);
CREATE TABLE proposals (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid);
CREATE TABLE proposal_line_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), proposal_id uuid);
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

\i supabase/migrations/049_job_payments.sql
\i supabase/migrations/053_job_invoices.sql
\i supabase/migrations/057_invoice_kind.sql
\i supabase/migrations/058_invoice_notes.sql
\i supabase/migrations/202611100040_job_invoices_org_scope.sql
\i supabase/migrations/202611110010_properties.sql
\i supabase/migrations/202611110030_service_plans.sql
\i supabase/migrations/202611110040_sales_tax.sql
\i supabase/migrations/202611110060_customer_invoices.sql
-- Idempotent: a second apply changes nothing and does not fail.
\i supabase/migrations/202611110060_customer_invoices.sql

INSERT INTO orgs VALUES ('00000000-0000-0000-0000-000000000001', 'A'), ('00000000-0000-0000-0000-000000000002', 'B');
INSERT INTO users VALUES ('90000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001');
INSERT INTO customers VALUES ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000001', 'Pat'),
  ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000001', 'Sam'),
  ('20000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000002', 'Other');
INSERT INTO org_trades VALUES ('00000000-0000-0000-0000-000000000001', 'lawn');

DO $t$
DECLARE
  o1 uuid := '00000000-0000-0000-0000-000000000001'; o2 uuid := '00000000-0000-0000-0000-000000000002';
  ca uuid := '10000000-0000-0000-0000-00000000000a'; cb uuid := '10000000-0000-0000-0000-00000000000b'; c2 uuid := '20000000-0000-0000-0000-00000000000a';
  u1 uuid := '90000000-0000-0000-0000-000000000001';
  j1 uuid; ji uuid; pa uuid; pb uuid; plan_v uuid; plan_m uuid; v1 uuid; v2 uuid; v3 uuid; vm1 uuid; vm2 uuid; vopen uuid; vb uuid;
  r jsonb; inv uuid; inv2 uuid; n int; ok boolean; num text; pay uuid;
BEGIN
  -- T1 job invoices: unchanged (org from the job, job number format), job payments unchanged
  INSERT INTO production_jobs (org_id, job_number, customer_id) VALUES (o1, '26-0001', ca) RETURNING id INTO j1;
  INSERT INTO job_invoices (job_id, created_by) VALUES (j1, u1) RETURNING id, invoice_number INTO ji, num;
  ASSERT num = 'INV-' || to_char(now(), 'YY') || '-26-0001-001', 'T1 job invoice number ' || num;
  ASSERT (SELECT org_id FROM job_invoices WHERE id = ji) = o1, 'T1 job invoice org';
  ASSERT (SELECT customer_id FROM job_invoices WHERE id = ji) IS NULL, 'T1 job invoice has no customer_id';
  INSERT INTO job_payments (job_id, paid_at, amount_cents, payment_type, method, payer) VALUES (j1, '2026-11-01', 100, 'deposit', 'check', 'homeowner');

  -- T2 a customer invoice needs a customer + company; customer/property must be the company's
  ok := false; BEGIN INSERT INTO job_invoices (org_id, created_by) VALUES (o1, u1); EXCEPTION WHEN check_violation THEN ok := true; END; ASSERT ok, 'T2 needs customer';
  ok := false; BEGIN INSERT INTO job_invoices (customer_id, created_by) VALUES (ca, u1); EXCEPTION WHEN not_null_violation THEN ok := true; END; ASSERT ok, 'T2 needs org';
  ok := false; BEGIN INSERT INTO job_invoices (org_id, customer_id, created_by) VALUES (o1, c2, u1); EXCEPTION WHEN insufficient_privilege THEN ok := true; END; ASSERT ok, 'T2 other company customer';
  ok := false; BEGIN INSERT INTO job_invoices (org_id, customer_id, invoice_kind) VALUES (o1, ca, 'weird'); EXCEPTION WHEN check_violation THEN ok := true; END; ASSERT ok, 'T2 kind list';
  INSERT INTO properties (org_id, customer_id, address_text) VALUES (o1, ca, '1 Oak St') RETURNING id INTO pa;
  INSERT INTO properties (org_id, customer_id, address_text) VALUES (o1, cb, '2 Elm St') RETURNING id INTO pb;
  ok := false; BEGIN INSERT INTO job_invoices (org_id, customer_id, property_id) VALUES (o1, ca, pb); EXCEPTION WHEN insufficient_privilege THEN ok := true; END; ASSERT ok, 'T2 other customer property';
  -- moving a customer invoice to another company is refused (the customer is not there)
  INSERT INTO job_invoices (org_id, customer_id, property_id, invoice_kind) VALUES (o1, ca, pa, 'service') RETURNING id, invoice_number INTO inv, num;
  ASSERT num = 'INV-' || to_char(now(), 'YY') || '-00001', 'T2 customer number ' || num;
  ok := false; BEGIN UPDATE job_invoices SET org_id = o2 WHERE id = inv; EXCEPTION WHEN insufficient_privilege THEN ok := true; END; ASSERT ok, 'T2 re-home refused';
  INSERT INTO job_invoices (org_id, customer_id) VALUES (o1, cb) RETURNING invoice_number INTO num;
  ASSERT num = 'INV-' || to_char(now(), 'YY') || '-00002', 'T2 next number ' || num;
  INSERT INTO job_invoices (org_id, customer_id) VALUES (o2, c2) RETURNING invoice_number INTO num;
  ASSERT num = 'INV-' || to_char(now(), 'YY') || '-00001', 'T2 per company number ' || num;
  DELETE FROM job_invoices WHERE customer_id IS NOT NULL;

  -- T3 service invoices: one per-visit plan, one monthly plan
  INSERT INTO service_plans (org_id, customer_id, property_id, trade, name, start_date, created_by, billing_basis, price)
    VALUES (o1, ca, pa, 'lawn', 'Mowing', '2026-03-02', u1, 'per_visit', 45) RETURNING id INTO plan_v;
  INSERT INTO service_plans (org_id, customer_id, property_id, trade, name, start_date, created_by, billing_basis, price)
    VALUES (o1, ca, pa, 'lawn', 'Care', '2026-03-02', u1, 'per_month', 120) RETURNING id INTO plan_m;
  INSERT INTO work_orders (org_id, work_order_type, visit_step, status, service_plan_id, service_planned_date, scheduled_date, trade, customer_id, property_id, completed_at)
    VALUES (o1, 'service_visit', 'service', 'completed', plan_v, '2026-10-06', '2026-10-06', 'lawn', ca, pa, now()) RETURNING id INTO v1;
  INSERT INTO work_orders (org_id, work_order_type, visit_step, status, service_plan_id, service_planned_date, scheduled_date, trade, customer_id, property_id, completed_at)
    VALUES (o1, 'service_visit', 'service', 'completed', plan_v, '2026-10-13', '2026-10-13', 'lawn', ca, pa, now()) RETURNING id INTO v2;
  INSERT INTO work_orders (org_id, work_order_type, visit_step, status, service_plan_id, service_planned_date, scheduled_date, trade, customer_id, property_id)
    VALUES (o1, 'service_visit', 'service', 'scheduled', plan_v, '2026-10-20', '2026-10-20', 'lawn', ca, pa) RETURNING id INTO vopen;
  INSERT INTO work_orders (org_id, work_order_type, visit_step, status, service_plan_id, service_planned_date, scheduled_date, trade, customer_id, property_id, completed_at)
    VALUES (o1, 'service_visit', 'service', 'completed', plan_m, '2026-10-07', '2026-10-07', 'lawn', ca, pa, now()) RETURNING id INTO vm1;
  INSERT INTO work_orders (org_id, work_order_type, visit_step, status, service_plan_id, service_planned_date, scheduled_date, trade, customer_id, property_id, completed_at)
    VALUES (o1, 'service_visit', 'service', 'completed', plan_m, '2026-10-21', '2026-10-21', 'lawn', ca, pa, now()) RETURNING id INTO vm2;

  r := create_service_invoice(o1, ca, pa, u1, jsonb_build_array(
    jsonb_build_object('description', 'Mowing — Oct 6', 'qty', 1, 'unit_price_cents', 4500, 'taxable', false, 'work_order_id', v1, 'service_date', '2026-10-06', 'service_plan_id', plan_v),
    jsonb_build_object('description', 'Mowing — Oct 13', 'qty', 1, 'unit_price_cents', 4500, 'taxable', false, 'work_order_id', v2, 'service_date', '2026-10-13', 'service_plan_id', plan_v),
    jsonb_build_object('description', 'Care — October', 'qty', 1, 'unit_price_cents', 12000, 'taxable', true, 'service_plan_id', plan_m, 'billing_month', '2026-10-01'),
    jsonb_build_object('description', 'Care visit — Oct 7', 'qty', 1, 'unit_price_cents', 0, 'work_order_id', vm1, 'service_date', '2026-10-07', 'service_plan_id', plan_m),
    jsonb_build_object('description', 'Care visit — Oct 21', 'qty', 1, 'unit_price_cents', 0, 'work_order_id', vm2, 'service_date', '2026-10-21', 'service_plan_id', plan_m)
  ));
  inv := (r->>'invoice_id')::uuid;
  ASSERT inv IS NOT NULL, 'T3 invoice made';
  ASSERT jsonb_array_length(r->'skipped') = 0, 'T3 nothing skipped';
  ASSERT (SELECT count(*) FROM job_invoice_items WHERE invoice_id = inv) = 5, 'T3 five lines';
  ASSERT (SELECT invoice_kind FROM job_invoices WHERE id = inv) = 'service', 'T3 kind';
  ASSERT (SELECT status FROM job_invoices WHERE id = inv) = 'draft', 'T3 draft';
  ASSERT (SELECT sum(line_total_cents) FROM job_invoice_items WHERE invoice_id = inv) = 21000, 'T3 line totals';
  ASSERT (SELECT taxable FROM job_invoice_items WHERE invoice_id = inv AND billing_month IS NOT NULL), 'T3 taxable carried';
  ASSERT (SELECT array_agg(sort_order ORDER BY sort_order) FROM job_invoice_items WHERE invoice_id = inv) = ARRAY[0,1,2,3,4], 'T3 order kept';

  -- T4 idempotent: the same batch again bills nothing and reports every unit skipped
  r := create_service_invoice(o1, ca, pa, u1, jsonb_build_array(
    jsonb_build_object('description', 'x', 'qty', 1, 'unit_price_cents', 4500, 'work_order_id', v1, 'service_plan_id', plan_v),
    jsonb_build_object('description', 'x', 'qty', 1, 'unit_price_cents', 12000, 'service_plan_id', plan_m, 'billing_month', '2026-10-01'),
    jsonb_build_object('description', 'x', 'qty', 1, 'unit_price_cents', 0, 'work_order_id', vm1, 'service_date', '2026-10-07', 'service_plan_id', plan_m)
  ));
  ASSERT r->>'invoice_id' IS NULL, 'T4 no second invoice';
  ASSERT jsonb_array_length(r->'skipped') = 3, 'T4 skipped visits + month: ' || (r->'skipped')::text;
  SELECT count(*) INTO n FROM job_invoices WHERE customer_id = ca; ASSERT n = 1, 'T4 still one invoice';

  -- T5 a partly billed batch keeps only the new units; a $0 monthly visit never rides without its month
  INSERT INTO work_orders (org_id, work_order_type, visit_step, status, service_plan_id, service_planned_date, scheduled_date, trade, customer_id, property_id, completed_at)
    VALUES (o1, 'service_visit', 'service', 'completed', plan_v, '2026-10-27', '2026-10-27', 'lawn', ca, pa, now()) RETURNING id INTO v3;
  r := create_service_invoice(o1, ca, pa, u1, jsonb_build_array(
    jsonb_build_object('description', 'old', 'qty', 1, 'unit_price_cents', 4500, 'work_order_id', v1, 'service_plan_id', plan_v),
    jsonb_build_object('description', 'new', 'qty', 1, 'unit_price_cents', 4500, 'work_order_id', v3, 'service_date', '2026-10-27', 'service_plan_id', plan_v),
    jsonb_build_object('description', 'month', 'qty', 1, 'unit_price_cents', 12000, 'service_plan_id', plan_m, 'billing_month', '2026-10-01'),
    jsonb_build_object('description', 'late care visit', 'qty', 1, 'unit_price_cents', 0, 'work_order_id', vm2, 'service_date', '2026-10-21', 'service_plan_id', plan_m)
  ));
  inv2 := (r->>'invoice_id')::uuid;
  ASSERT inv2 IS NOT NULL, 'T5 invoice for the new visit';
  ASSERT (SELECT array_agg(description ORDER BY sort_order) FROM job_invoice_items WHERE invoice_id = inv2) = ARRAY['new'], 'T5 only the new line';
  ASSERT (SELECT sort_order FROM job_invoice_items WHERE invoice_id = inv2) = 0, 'T5 renumbered';

  -- T6 refusals: an open visit, another customer's visit, another company's customer, an empty batch
  ok := false; BEGIN PERFORM create_service_invoice(o1, ca, pa, u1, jsonb_build_array(jsonb_build_object('description', 'x', 'unit_price_cents', 100, 'work_order_id', vopen))); EXCEPTION WHEN invalid_parameter_value THEN ok := true; END; ASSERT ok, 'T6 open visit';
  ok := false; BEGIN PERFORM create_service_invoice(o1, cb, pb, u1, jsonb_build_array(jsonb_build_object('description', 'x', 'unit_price_cents', 100, 'work_order_id', v3))); EXCEPTION WHEN invalid_parameter_value THEN ok := true; END; ASSERT ok, 'T6 other customer visit';
  ok := false; BEGIN PERFORM create_service_invoice(o2, ca, null, u1, jsonb_build_array(jsonb_build_object('description', 'x', 'unit_price_cents', 100))); EXCEPTION WHEN insufficient_privilege THEN ok := true; END; ASSERT ok, 'T6 other company';
  ok := false; BEGIN PERFORM create_service_invoice(o1, cb, null, u1, jsonb_build_array(jsonb_build_object('description', 'x', 'unit_price_cents', 100, 'service_plan_id', plan_m, 'billing_month', '2026-11-01'))); EXCEPTION WHEN insufficient_privilege THEN ok := true; END; ASSERT ok, 'T6 other customer plan';
  ok := false; BEGIN PERFORM create_service_invoice(o1, ca, pa, u1, '[]'::jsonb); EXCEPTION WHEN invalid_parameter_value THEN ok := true; END; ASSERT ok, 'T6 empty';
  ok := false; BEGIN INSERT INTO job_invoice_items (invoice_id, description, unit_price_cents, line_total_cents, service_plan_id, billing_month) VALUES (inv, 'x', 1, 1, plan_m, '2026-10-15'); EXCEPTION WHEN check_violation THEN ok := true; END; ASSERT ok, 'T6 month is the 1st';
  ok := false; BEGIN INSERT INTO job_invoice_items (invoice_id, description, unit_price_cents, line_total_cents, unit) VALUES (inv, 'x', 1, 1, 'day'); EXCEPTION WHEN check_violation THEN ok := true; END; ASSERT ok, 'T6 unit list';
  -- hours line: 2.5 h × $80
  INSERT INTO job_invoice_items (invoice_id, description, qty, unit_price_cents, line_total_cents, unit, service_date) VALUES (inv2, 'Tractor work', 2.5, 8000, 20000, 'hour', '2026-10-28');

  -- T7 voiding frees the units; a monthly visit then rides with its month again
  UPDATE job_invoices SET status = 'void', void_reason = 'wrong price', voided_at = now() WHERE id = inv;
  r := create_service_invoice(o1, ca, pa, u1, jsonb_build_array(
    jsonb_build_object('description', 'month', 'qty', 1, 'unit_price_cents', 12500, 'service_plan_id', plan_m, 'billing_month', '2026-10-01'),
    jsonb_build_object('description', 'care visit', 'qty', 1, 'unit_price_cents', 0, 'work_order_id', vm1, 'service_date', '2026-10-07', 'service_plan_id', plan_m),
    jsonb_build_object('description', 'v1 again', 'qty', 1, 'unit_price_cents', 4500, 'work_order_id', v1, 'service_plan_id', plan_v)
  ));
  ASSERT r->>'invoice_id' IS NOT NULL, 'T7 rebilled after void';
  ASSERT (SELECT count(*) FROM job_invoice_items WHERE invoice_id = (r->>'invoice_id')::uuid) = 3, 'T7 three lines';

  -- T8 payments without a job: need company + customer, customer must be the company's
  INSERT INTO job_payments (org_id, customer_id, paid_at, amount_cents, payment_type, method, payer)
    VALUES (o1, ca, '2026-11-05', 4500, 'other', 'check', 'other') RETURNING id INTO pay;
  INSERT INTO invoice_payments (invoice_id, job_payment_id, applied_cents) VALUES (inv2, pay, 4500);
  ok := false; BEGIN INSERT INTO job_payments (paid_at, amount_cents, payment_type, method, payer) VALUES ('2026-11-05', 1, 'other', 'check', 'other'); EXCEPTION WHEN check_violation THEN ok := true; END; ASSERT ok, 'T8 needs customer';
  ok := false; BEGIN INSERT INTO job_payments (org_id, customer_id, paid_at, amount_cents, payment_type, method, payer) VALUES (o2, ca, '2026-11-05', 1, 'other', 'check', 'other'); EXCEPTION WHEN insufficient_privilege THEN ok := true; END; ASSERT ok, 'T8 other company customer';
  -- a job payment still needs nothing new
  ASSERT (SELECT count(*) FROM job_payments WHERE job_id = j1) = 1, 'T8 job payment intact';

  -- T9 a customer with invoices can't be deleted out from under them (financial history)
  ok := false; BEGIN DELETE FROM customers WHERE id = ca; EXCEPTION WHEN foreign_key_violation THEN ok := true; END; ASSERT ok, 'T9 customer delete refused';

  RAISE NOTICE 'REPORT: all assertions passed';
END $t$;
