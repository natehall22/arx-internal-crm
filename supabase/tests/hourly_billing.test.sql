-- Self-contained DB test for 202611120030_hourly_billing (approve_billed_time / unapprove_billed_time). THROWAWAY local
-- Postgres only (run-hourly-billing.sh). Minimal copies of the touched tables, then the real invoice / properties /
-- service-plan / sales-tax / customer-invoice migrations and this one (twice: idempotent), then asserts: a job day billed
-- once (approved hours can never be billed twice, even by a second call), totals checked, job invoice numbering, a visit
-- of a per-hour plan billed on a customer invoice and refused by Ready to bill afterwards (and the reverse), un-approve
-- only after void, company checks, per-hour plan basis accepted.
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
CREATE TABLE production_jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, job_number text, sale_date date, project_id uuid, customer_id uuid, address_text text, lat numeric, lng numeric, status text NOT NULL DEFAULT 'sold');
CREATE TABLE pricebook_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, name text);
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
ALTER TABLE job_payments ADD COLUMN funding_status text; -- 121_weekly_sales_payroll_foundation
\i supabase/migrations/053_job_invoices.sql
\i supabase/migrations/057_invoice_kind.sql
\i supabase/migrations/058_invoice_notes.sql
\i supabase/migrations/202611100040_job_invoices_org_scope.sql
\i supabase/migrations/202611110010_properties.sql
\i supabase/migrations/202611110030_service_plans.sql
\i supabase/migrations/202611110040_sales_tax.sql
\i supabase/migrations/202611110060_customer_invoices.sql
CREATE TABLE payroll_periods (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES orgs(id), status text NOT NULL DEFAULT 'open', cutoff_at timestamptz);
\i supabase/migrations/202610250010_payroll_adjustments.sql
\i supabase/migrations/202611120030_hourly_billing.sql
-- Idempotent: a second apply changes nothing and does not fail.
\i supabase/migrations/202611120030_hourly_billing.sql

-- Totals as the app sends them (tax added on top; lib/sales-tax.ts is tested in jest).
CREATE FUNCTION tot(lines jsonb, tax int DEFAULT 0) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'subtotal_cents', (SELECT coalesce(sum(round((l->>'qty')::numeric * (l->>'unit_price_cents')::int)), 0) FROM jsonb_array_elements(lines) l),
    'tax_cents', tax, 'taxable_subtotal_cents', 0, 'tax_lines', '[]'::jsonb,
    'total_cents', tax + (SELECT coalesce(sum(round((l->>'qty')::numeric * (l->>'unit_price_cents')::int)), 0) FROM jsonb_array_elements(lines) l))
$$;
CREATE FUNCTION day1(d text, src text DEFAULT 'clock', reason text DEFAULT null) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_array(jsonb_build_object('work_date', d, 'source', src, 'edit_reason', reason, 'clocked_seconds', 21600, 'billable_hours', 6, 'lines', '[]'::jsonb))
$$;
CREATE FUNCTION hrs(d text, qty numeric, cents int, taxable boolean DEFAULT false) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_array(jsonb_build_object('description', 'Grading labor', 'qty', qty, 'unit_price_cents', cents, 'taxable', taxable, 'unit', 'hour', 'service_date', d))
$$;

INSERT INTO orgs VALUES ('00000000-0000-0000-0000-000000000001', 'A'), ('00000000-0000-0000-0000-000000000002', 'B');
INSERT INTO users VALUES ('90000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001');
INSERT INTO customers VALUES ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000001', 'Pat'),
  ('20000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000002', 'Other');
INSERT INTO org_trades VALUES ('00000000-0000-0000-0000-000000000001', 'lawn');

DO $t$
DECLARE
  o1 uuid := '00000000-0000-0000-0000-000000000001'; o2 uuid := '00000000-0000-0000-0000-000000000002';
  ca uuid := '10000000-0000-0000-0000-00000000000a';
  u1 uuid := '90000000-0000-0000-0000-000000000001';
  j1 uuid; jfixed uuid; jcan uuid; pa uuid; plan_h uuid; plan_v uuid; vh uuid; vh2 uuid; vv uuid;
  r jsonb; inv uuid; inv2 uuid; n int; ok boolean; num text; appr uuid;
BEGIN
  -- T1 schema: job billing columns, per-hour plan basis accepted, bad values refused
  INSERT INTO production_jobs (org_id, job_number, customer_id, billing_mode, estimated_hours) VALUES (o1, '26-0007', ca, 'time_materials', 20) RETURNING id INTO j1;
  INSERT INTO production_jobs (org_id, job_number, customer_id) VALUES (o1, '26-0008', ca) RETURNING id INTO jfixed;
  INSERT INTO production_jobs (org_id, job_number, customer_id, billing_mode, status) VALUES (o1, '26-0009', ca, 'time_materials', 'cancelled') RETURNING id INTO jcan;
  ok := false; BEGIN UPDATE production_jobs SET billing_mode = 'weird' WHERE id = jfixed; EXCEPTION WHEN check_violation THEN ok := true; END; ASSERT ok, 'T1 billing_mode list';
  ok := false; BEGIN UPDATE production_jobs SET estimated_hours = -1 WHERE id = jfixed; EXCEPTION WHEN check_violation THEN ok := true; END; ASSERT ok, 'T1 estimate >= 0';
  INSERT INTO properties (org_id, customer_id, address_text) VALUES (o1, ca, '1 Oak St') RETURNING id INTO pa;
  INSERT INTO service_plans (org_id, customer_id, property_id, trade, name, start_date, created_by, billing_basis, price)
    VALUES (o1, ca, pa, 'lawn', 'Bush hogging', '2026-03-02', u1, 'per_hour', 75) RETURNING id INTO plan_h;
  INSERT INTO service_plans (org_id, customer_id, property_id, trade, name, start_date, created_by, billing_basis, price)
    VALUES (o1, ca, pa, 'lawn', 'Mowing', '2026-03-02', u1, 'per_visit', 45) RETURNING id INTO plan_v;
  ok := false; BEGIN UPDATE service_plans SET billing_basis = 'per_week' WHERE id = plan_v; EXCEPTION WHEN check_violation THEN ok := true; END; ASSERT ok, 'T1 plan basis list';
  INSERT INTO service_plan_templates (org_id, name, trade, billing_basis) VALUES (o1, 'Tractor work', 'lawn', 'per_hour');

  -- T2 a job day: invoice made with its lines + totals + the approval row
  r := approve_billed_time(o1, j1, null, u1, day1('2026-11-03'), hrs('2026-11-03', 6.25, 6500), tot(hrs('2026-11-03', 6.25, 6500), 100));
  inv := (r->>'invoice_id')::uuid;
  ASSERT inv IS NOT NULL, 'T2 invoice made';
  ASSERT r->>'invoice_number' = 'INV-' || to_char(now(), 'YY') || '-26-0007-001', 'T2 job invoice number ' || (r->>'invoice_number');
  ASSERT (SELECT job_id FROM job_invoices WHERE id = inv) = j1 AND (SELECT org_id FROM job_invoices WHERE id = inv) = o1, 'T2 job invoice';
  ASSERT (SELECT status FROM job_invoices WHERE id = inv) = 'draft', 'T2 draft';
  ASSERT (SELECT subtotal_cents FROM job_invoices WHERE id = inv) = 40625 AND (SELECT total_cents FROM job_invoices WHERE id = inv) = 40725, 'T2 totals';
  ASSERT (SELECT unit FROM job_invoice_items WHERE invoice_id = inv) = 'hour' AND (SELECT qty FROM job_invoice_items WHERE invoice_id = inv) = 6.25, 'T2 hour line';
  ASSERT (SELECT service_date FROM job_invoice_items WHERE invoice_id = inv) = '2026-11-03', 'T2 day on the line';
  ASSERT (SELECT work_order_id FROM job_invoice_items WHERE invoice_id = inv) IS NULL, 'T2 no visit on a job line';
  ASSERT (SELECT count(*) FROM billed_time_days WHERE production_job_id = j1 AND status = 'approved' AND invoice_id = inv) = 1, 'T2 approval row';

  -- T3 idempotent: the same day again bills nothing (skipped), and the unique index stops a direct second row
  r := approve_billed_time(o1, j1, null, u1, day1('2026-11-03'), hrs('2026-11-03', 6.25, 6500), tot(hrs('2026-11-03', 6.25, 6500)));
  ASSERT r->>'invoice_id' IS NULL AND r->'skipped'->0->>'work_date' = '2026-11-03', 'T3 skipped';
  ASSERT (SELECT count(*) FROM job_invoices WHERE job_id = j1) = 1, 'T3 still one invoice';
  ok := false; BEGIN INSERT INTO billed_time_days (org_id, production_job_id, work_date, source) VALUES (o1, j1, '2026-11-03', 'clock'); EXCEPTION WHEN unique_violation THEN ok := true; END; ASSERT ok, 'T3 unique';
  -- two days at once, one already billed → nothing written
  r := approve_billed_time(o1, j1, null, u1,
    day1('2026-11-03') || day1('2026-11-04'), hrs('2026-11-03', 1, 6500) || hrs('2026-11-04', 1, 6500), tot(hrs('2026-11-03', 1, 6500) || hrs('2026-11-04', 1, 6500)));
  ASSERT r->>'invoice_id' IS NULL, 'T3 all or nothing';
  ASSERT NOT EXISTS (SELECT 1 FROM billed_time_days WHERE work_date = '2026-11-04'), 'T3 nothing for the other day';

  -- T4 checks: totals must match, lines only for the approved days, edited needs a reason, job must be T&M and live
  ok := false; BEGIN PERFORM approve_billed_time(o1, j1, null, u1, day1('2026-11-05'), hrs('2026-11-05', 2, 6500), tot(hrs('2026-11-05', 1, 6500))); EXCEPTION WHEN invalid_parameter_value THEN ok := true; END; ASSERT ok, 'T4 totals';
  ok := false; BEGIN PERFORM approve_billed_time(o1, j1, null, u1, day1('2026-11-05'), hrs('2026-11-06', 2, 6500), tot(hrs('2026-11-06', 2, 6500))); EXCEPTION WHEN invalid_parameter_value THEN ok := true; END; ASSERT ok, 'T4 line day';
  ok := false; BEGIN PERFORM approve_billed_time(o1, j1, null, u1, day1('2026-11-05', 'edited'), hrs('2026-11-05', 2, 6500), tot(hrs('2026-11-05', 2, 6500))); EXCEPTION WHEN check_violation THEN ok := true; END; ASSERT ok, 'T4 edited needs a reason';
  ok := false; BEGIN PERFORM approve_billed_time(o1, jfixed, null, u1, day1('2026-11-05'), hrs('2026-11-05', 2, 6500), tot(hrs('2026-11-05', 2, 6500))); EXCEPTION WHEN invalid_parameter_value THEN ok := true; END; ASSERT ok, 'T4 fixed-price job';
  ok := false; BEGIN PERFORM approve_billed_time(o1, jcan, null, u1, day1('2026-11-05'), hrs('2026-11-05', 2, 6500), tot(hrs('2026-11-05', 2, 6500))); EXCEPTION WHEN invalid_parameter_value THEN ok := true; END; ASSERT ok, 'T4 cancelled job';
  ok := false; BEGIN PERFORM approve_billed_time(o2, j1, null, u1, day1('2026-11-05'), hrs('2026-11-05', 2, 6500), tot(hrs('2026-11-05', 2, 6500))); EXCEPTION WHEN no_data_found THEN ok := true; END; ASSERT ok, 'T4 other company';
  ok := false; BEGIN PERFORM approve_billed_time(o1, j1, null, u1, day1('2026-11-05'), '[{"description":"x","qty":0,"unit_price_cents":1,"service_date":"2026-11-05"}]', tot('[{"qty":0,"unit_price_cents":1}]')); EXCEPTION WHEN invalid_parameter_value THEN ok := true; END; ASSERT ok, 'T4 zero hours';
  ok := false; BEGIN PERFORM approve_billed_time(o1, j1, null, u1, day1('2026-11-05'), hrs('2026-11-05', 2, 0), tot(hrs('2026-11-05', 2, 0))); EXCEPTION WHEN invalid_parameter_value THEN ok := true; END; ASSERT ok, 'T4 nothing priced';
  ok := false; BEGIN PERFORM approve_billed_time(o1, j1, null, u1, day1('2026-11-05') || day1('2026-11-05'), hrs('2026-11-05', 2, 1), tot(hrs('2026-11-05', 2, 1))); EXCEPTION WHEN invalid_parameter_value THEN ok := true; END; ASSERT ok, 'T4 day twice';
  ok := false; BEGIN PERFORM approve_billed_time(o1, j1, plan_h, u1, day1('2026-11-05'), hrs('2026-11-05', 2, 1), tot(hrs('2026-11-05', 2, 1))); EXCEPTION WHEN invalid_parameter_value THEN ok := true; END; ASSERT ok, 'T4 job or visit';
  -- typed and edited (with reason) days pass
  r := approve_billed_time(o1, j1, null, u1, day1('2026-11-05', 'typed') || day1('2026-11-06', 'edited', 'clock left on'),
    hrs('2026-11-05', 3, 6500) || hrs('2026-11-06', 4, 6500), tot(hrs('2026-11-05', 3, 6500) || hrs('2026-11-06', 4, 6500)));
  ASSERT r->>'invoice_id' IS NOT NULL, 'T4 typed + edited';
  ASSERT (SELECT count(*) FROM job_invoice_items WHERE invoice_id = (r->>'invoice_id')::uuid) = 2, 'T4 one invoice, two days';
  ASSERT (SELECT edit_reason FROM billed_time_days WHERE work_date = '2026-11-06') = 'clock left on', 'T4 reason kept';

  -- T5 un-approve: refused while the invoice is live; after void the day is freed and can be billed again
  SELECT id INTO appr FROM billed_time_days WHERE production_job_id = j1 AND work_date = '2026-11-03';
  ASSERT NOT unapprove_billed_time(o1, appr, u1, 'wrong'), 'T5 live invoice keeps it';
  ok := false; BEGIN PERFORM unapprove_billed_time(o1, appr, u1, '  '); EXCEPTION WHEN invalid_parameter_value THEN ok := true; END; ASSERT ok, 'T5 reason';
  UPDATE job_invoices SET status = 'void', void_reason = 'wrong hours' WHERE id = inv;
  ASSERT NOT unapprove_billed_time(o2, appr, u1, 'x'), 'T5 other company';
  ASSERT unapprove_billed_time(o1, appr, u1, 'wrong hours'), 'T5 un-approved';
  ASSERT (SELECT status FROM billed_time_days WHERE id = appr) = 'unapproved', 'T5 status';
  ASSERT NOT unapprove_billed_time(o1, appr, u1, 'again'), 'T5 once';
  r := approve_billed_time(o1, j1, null, u1, day1('2026-11-03', 'edited', 'fixed'), hrs('2026-11-03', 5.5, 6500), tot(hrs('2026-11-03', 5.5, 6500)));
  ASSERT r->>'invoice_id' IS NOT NULL, 'T5 billed again';
  ASSERT (SELECT count(*) FROM billed_time_days WHERE production_job_id = j1 AND work_date = '2026-11-03') = 2, 'T5 history kept';

  -- T6 a visit of a per-hour plan: a customer invoice, every line carrying the visit
  INSERT INTO work_orders (org_id, work_order_type, visit_step, status, service_plan_id, service_planned_date, scheduled_date, trade, customer_id, property_id, completed_at)
    VALUES (o1, 'service_visit', 'service', 'completed', plan_h, '2026-11-03', '2026-11-03', 'lawn', ca, pa, now()) RETURNING id INTO vh;
  r := approve_billed_time(o1, null, vh, u1, day1('2026-11-03'),
    hrs('2026-11-03', 2, 7500) || '[{"description":"Tractor","qty":2,"unit_price_cents":9500,"taxable":true,"unit":"hour","service_date":"2026-11-03"},{"description":"Trip charge","qty":1,"unit_price_cents":3500,"service_date":"2026-11-03"}]'::jsonb,
    tot(hrs('2026-11-03', 2, 7500) || '[{"qty":2,"unit_price_cents":9500},{"qty":1,"unit_price_cents":3500}]'::jsonb));
  inv2 := (r->>'invoice_id')::uuid;
  ASSERT inv2 IS NOT NULL, 'T6 visit invoice';
  ASSERT (SELECT job_id FROM job_invoices WHERE id = inv2) IS NULL AND (SELECT customer_id FROM job_invoices WHERE id = inv2) = ca AND (SELECT property_id FROM job_invoices WHERE id = inv2) = pa, 'T6 customer invoice';
  ASSERT (SELECT invoice_kind FROM job_invoices WHERE id = inv2) = 'service', 'T6 kind';
  ASSERT (SELECT count(*) FROM job_invoice_items WHERE invoice_id = inv2 AND work_order_id = vh) = 3, 'T6 lines carry the visit';
  ASSERT (SELECT unit FROM job_invoice_items WHERE invoice_id = inv2 AND description = 'Trip charge') IS NULL, 'T6 trip is each';
  ASSERT (SELECT total_cents FROM job_invoices WHERE id = inv2) = 15000 + 19000 + 3500, 'T6 total';
  -- Ready to bill can't bill it now (create_service_invoice sees the visit on a live invoice)…
  r := create_service_invoice(o1, ca, pa, u1, jsonb_build_array(jsonb_build_object('description', 'x', 'qty', 1, 'unit_price_cents', 7500, 'work_order_id', vh, 'service_plan_id', plan_h)),
    '{"subtotal_cents":7500,"total_cents":7500,"tax_cents":0}');
  ASSERT r->>'invoice_id' IS NULL, 'T6 Ready to bill refused';
  -- …a second approval of the same visit on another day is refused too (the visit is billed)
  r := approve_billed_time(o1, null, vh, u1, day1('2026-11-04'), hrs('2026-11-04', 1, 7500), tot(hrs('2026-11-04', 1, 7500)));
  ASSERT r->>'invoice_id' IS NULL AND r->'skipped' @> jsonb_build_array(jsonb_build_object('work_order_id', vh)), 'T6 visit billed once';
  -- …and a billed visit can't be reopened (the existing guard)
  ok := false; BEGIN UPDATE work_orders SET status = 'scheduled' WHERE id = vh; EXCEPTION WHEN check_violation THEN ok := true; END; ASSERT ok, 'T6 reopen refused';

  -- T7 the reverse: a visit Ready to bill already billed is refused here
  INSERT INTO work_orders (org_id, work_order_type, visit_step, status, service_plan_id, service_planned_date, scheduled_date, trade, customer_id, property_id, completed_at)
    VALUES (o1, 'service_visit', 'service', 'completed', plan_h, '2026-11-10', '2026-11-10', 'lawn', ca, pa, now()) RETURNING id INTO vh2;
  r := create_service_invoice(o1, ca, pa, u1, jsonb_build_array(jsonb_build_object('description', 'x', 'qty', 1, 'unit_price_cents', 7500, 'work_order_id', vh2)),
    '{"subtotal_cents":7500,"total_cents":7500,"tax_cents":0}');
  ASSERT r->>'invoice_id' IS NOT NULL, 'T7 billed by Ready to bill';
  r := approve_billed_time(o1, null, vh2, u1, day1('2026-11-10'), hrs('2026-11-10', 1, 7500), tot(hrs('2026-11-10', 1, 7500)));
  ASSERT r->>'invoice_id' IS NULL, 'T7 refused here';

  -- T8 a visit of a plan NOT billed by the hour, a skipped visit, another company's visit: refused
  INSERT INTO work_orders (org_id, work_order_type, visit_step, status, service_plan_id, service_planned_date, scheduled_date, trade, customer_id, property_id, completed_at)
    VALUES (o1, 'service_visit', 'service', 'completed', plan_v, '2026-11-03', '2026-11-03', 'lawn', ca, pa, now()) RETURNING id INTO vv;
  ok := false; BEGIN PERFORM approve_billed_time(o1, null, vv, u1, day1('2026-11-03'), hrs('2026-11-03', 1, 1), tot(hrs('2026-11-03', 1, 1))); EXCEPTION WHEN invalid_parameter_value THEN ok := true; END; ASSERT ok, 'T8 per-visit plan';
  ok := false; BEGIN PERFORM approve_billed_time(o2, null, vh2, u1, day1('2026-11-03'), hrs('2026-11-03', 1, 1), tot(hrs('2026-11-03', 1, 1))); EXCEPTION WHEN no_data_found THEN ok := true; END; ASSERT ok, 'T8 other company visit';
  UPDATE work_orders SET status = 'skipped', completed_at = null, skip_reason = 'rain', skipped_at = now() WHERE id = vv;
  UPDATE service_plans SET billing_basis = 'per_hour' WHERE id = plan_v;
  ok := false; BEGIN PERFORM approve_billed_time(o1, null, vv, u1, day1('2026-11-03'), hrs('2026-11-03', 1, 1), tot(hrs('2026-11-03', 1, 1))); EXCEPTION WHEN invalid_parameter_value THEN ok := true; END; ASSERT ok, 'T8 skipped visit';

  -- T9 the tables stay service-role only
  ASSERT NOT has_table_privilege('authenticated', 'billed_time_days', 'SELECT'), 'T9 no browser reads';
  ASSERT NOT has_function_privilege('authenticated', 'approve_billed_time(uuid, uuid, uuid, uuid, jsonb, jsonb, jsonb)', 'EXECUTE'), 'T9 no browser calls';
  ASSERT NOT has_function_privilege('anon', 'unapprove_billed_time(uuid, uuid, uuid, text)', 'EXECUTE'), 'T9 no anon calls';

  -- T10 commission change lines: written on an OPEN week with the base they cover; a stale "covered so far" is refused
  DECLARE p1 uuid; p2 uuid; u2 uuid := '90000000-0000-0000-0000-000000000002';
  BEGIN
    INSERT INTO users VALUES (u2, o1);
    INSERT INTO payroll_periods (org_id, status, cutoff_at) VALUES (o1, 'paid', '2026-11-08') RETURNING id INTO p1;
    INSERT INTO payroll_periods (org_id, status, cutoff_at) VALUES (o1, 'open', '2026-11-15') RETURNING id INTO p2;
    n := payroll_add_commission_changes(o1, j1, p2, p1, u1, jsonb_build_array(
      jsonb_build_object('user_id', u1, 'amount', 210, 'base_delta', 3000, 'reason', 'Commission change: +$3,000 × 7%', 'expected_prior', 0),
      jsonb_build_object('user_id', u2, 'amount', 150, 'base_delta', 3000, 'reason', 'Commission change: +$3,000 × 5%', 'expected_prior', 0)));
    ASSERT n = 2, 'T10 two lines';
    ASSERT (SELECT sum(amount) FROM payroll_adjustments WHERE job_id = j1 AND kind = 'commission_change' AND payroll_period_id = p2) = 360, 'T10 on the open week';
    ASSERT (SELECT source_period_id FROM payroll_adjustments WHERE user_id = u1 AND kind = 'commission_change') = p1, 'T10 source week';
    -- the same run again (stale expected_prior 0) is refused: never paid twice
    ok := false; BEGIN PERFORM payroll_add_commission_changes(o1, j1, p2, p1, u1, jsonb_build_array(jsonb_build_object('user_id', u1, 'amount', 210, 'base_delta', 3000, 'reason', 'x', 'expected_prior', 0))); EXCEPTION WHEN serialization_failure THEN ok := true; END; ASSERT ok, 'T10 stale refused';
    -- a clawback with the right prior is fine (negative amount)
    n := payroll_add_commission_changes(o1, j1, p2, p1, u1, jsonb_build_array(jsonb_build_object('user_id', u1, 'amount', -210, 'base_delta', -3000, 'reason', 'Commission change: −$3,000 × 7%', 'expected_prior', 3000)));
    ASSERT (SELECT sum(amount) FROM payroll_adjustments WHERE user_id = u1 AND kind = 'commission_change') = 0, 'T10 clawback';
    -- a paid week can't take one; another company's job / person refused; a zero base change refused by the shape check
    ok := false; BEGIN PERFORM payroll_add_commission_changes(o1, j1, p1, p1, u1, jsonb_build_array(jsonb_build_object('user_id', u1, 'amount', 1, 'base_delta', 1, 'reason', 'x', 'expected_prior', 0))); EXCEPTION WHEN SQLSTATE '55006' THEN ok := true; END; ASSERT ok, 'T10 paid week refused';
    ok := false; BEGIN PERFORM payroll_add_commission_changes(o2, j1, p2, p1, u1, jsonb_build_array(jsonb_build_object('user_id', u1, 'amount', 1, 'base_delta', 1, 'reason', 'x', 'expected_prior', 0))); EXCEPTION WHEN no_data_found THEN ok := true; END; ASSERT ok, 'T10 other company';
    ok := false; BEGIN PERFORM payroll_add_commission_changes(o1, j1, p2, p1, u1, jsonb_build_array(jsonb_build_object('user_id', u2, 'amount', 1, 'base_delta', 0, 'reason', 'x', 'expected_prior', 3000))); EXCEPTION WHEN check_violation THEN ok := true; END; ASSERT ok, 'T10 zero base change';
    ASSERT NOT has_function_privilege('authenticated', 'payroll_add_commission_changes(uuid, uuid, uuid, uuid, uuid, jsonb)', 'EXECUTE'), 'T10 service role only';
  END;

  RAISE NOTICE 'REPORT: all assertions passed';
END $t$;
