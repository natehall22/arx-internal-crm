-- Self-contained DB test for 202611230010_rpt_revenue (built on the customer-invoices harness)
-- (original header: 202611110060_customer_invoices (invoices without a job). THROWAWAY local Postgres only
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
CREATE TABLE production_jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, job_number text, sale_date date, status text NOT NULL DEFAULT 'sold', job_type text NOT NULL DEFAULT 'roofing', sale_amount numeric(12,2), billing_mode text, created_at timestamptz NOT NULL DEFAULT now(), project_id uuid, customer_id uuid, address_text text, lat numeric, lng numeric);
CREATE TABLE documents (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, job_id uuid, customer_id uuid, deleted_at timestamptz);
CREATE TABLE proposals (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid);
CREATE TABLE proposal_line_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), proposal_id uuid);
CREATE TABLE sub_contractors (id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES orgs(id), company_name text, active boolean DEFAULT true);
CREATE TABLE org_trades (org_id uuid NOT NULL, slug text NOT NULL, label text NOT NULL DEFAULT '', CONSTRAINT org_trades_org_slug_key UNIQUE (org_id, slug));
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
-- Idempotent: a second apply changes nothing and does not fail.
\i supabase/migrations/202611110060_customer_invoices.sql


\i supabase/migrations/202611230010_rpt_revenue.sql
-- Idempotent re-apply.
\i supabase/migrations/202611230010_rpt_revenue.sql

-- Test helper: totals as the app sends them (tax passed in; lib/sales-tax.ts is tested in jest).
CREATE FUNCTION bill(o uuid, c uuid, p uuid, u uuid, lines jsonb, tax int DEFAULT 0) RETURNS jsonb LANGUAGE sql AS $$
  SELECT create_service_invoice(o, c, p, u, lines, jsonb_build_object(
    'subtotal_cents', (SELECT coalesce(sum(round(coalesce((l->>'qty')::numeric, 1) * (l->>'unit_price_cents')::int)), 0) FROM jsonb_array_elements(lines) l),
    'tax_cents', tax, 'taxable_subtotal_cents', 0, 'tax_lines', '[]'::jsonb,
    'total_cents', tax + (SELECT coalesce(sum(round(coalesce((l->>'qty')::numeric, 1) * (l->>'unit_price_cents')::int)), 0) FROM jsonb_array_elements(lines) l)))
$$;

INSERT INTO orgs VALUES ('00000000-0000-0000-0000-000000000001', 'A'), ('00000000-0000-0000-0000-000000000002', 'B');
INSERT INTO users VALUES ('90000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001');
INSERT INTO customers VALUES ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000001', 'Pat'),
  ('20000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000002', 'Other');
INSERT INTO org_trades VALUES ('00000000-0000-0000-0000-000000000001', 'lawn', 'Lawn care'), ('00000000-0000-0000-0000-000000000001', 'roofing', 'Roofing');

DO $t$
DECLARE
  o1 uuid := '00000000-0000-0000-0000-000000000001'; o2 uuid := '00000000-0000-0000-0000-000000000002';
  ca uuid := '10000000-0000-0000-0000-00000000000a'; cb uuid := '20000000-0000-0000-0000-00000000000a';
  u1 uuid := '90000000-0000-0000-0000-000000000001';
  j1 uuid; j2 uuid; j3 uuid; jb uuid; i1 uuid; i2 uuid; i3 uuid; pa uuid; plan_id uuid; tpl uuid; v1 uuid; v2 uuid;
  r jsonb; inv1 uuid; inv2 uuid; inv3 uuid; inv4 uuid; inv5 uuid; n numeric;
  bj numeric; bs numeric; cj numeric; cs numeric;
BEGIN
  -- ===== Jobs =====
  -- J1: fixed price $10,000 sold in March, billed by a deposit + a final invoice (the SAME dollars) and one extra invoice adding $250 tax.
  INSERT INTO production_jobs (org_id, job_number, customer_id, sale_date, sale_amount, job_type) VALUES (o1, '26-0001', ca, '2026-03-10', 10000, 'roofing') RETURNING id INTO j1;
  INSERT INTO job_invoices (job_id, created_by, status, issued_at, subtotal_cents, total_cents, tax_cents) VALUES (j1, u1, 'sent', '2026-03-11', 500000, 500000, 0);
  INSERT INTO job_invoices (job_id, created_by, status, issued_at, subtotal_cents, total_cents, tax_cents) VALUES (j1, u1, 'paid', '2026-04-01', 500000, 500000, 0);
  INSERT INTO job_invoices (job_id, created_by, status, issued_at, subtotal_cents, total_cents, tax_cents) VALUES (j1, u1, 'sent', '2026-04-20', 100000, 125000, 25000);
  INSERT INTO job_invoices (job_id, created_by, status, issued_at, subtotal_cents, total_cents, tax_cents) VALUES (j1, u1, 'draft', '2026-04-21', 99900, 99900, 0);
  INSERT INTO job_payments (job_id, paid_at, amount_cents, payment_type, method, payer) VALUES (j1, '2026-03-12', 500000, 'deposit', 'check', 'homeowner');
  INSERT INTO job_payments (job_id, paid_at, amount_cents, payment_type, method, payer, funding_status) VALUES (j1, '2026-04-05', 500000, 'final', 'ach', 'homeowner', 'cleared');
  INSERT INTO job_payments (job_id, paid_at, amount_cents, payment_type, method, payer, funding_status) VALUES (j1, '2026-04-06', 12345, 'other', 'ach', 'homeowner', 'pending'); -- not cleared: not collected
  -- J2: cancelled: bills nothing.
  INSERT INTO production_jobs (org_id, job_number, sale_date, sale_amount, status) VALUES (o1, '26-0002', '2026-03-15', 8000, 'cancelled') RETURNING id INTO j2;
  -- J3: time & materials: the $500 estimate is NOT billed; its issued invoices are ($300 + $10 tax); a draft is not.
  INSERT INTO production_jobs (org_id, job_number, sale_date, sale_amount, billing_mode, job_type) VALUES (o1, '26-0003', '2026-03-20', 500, 'time_materials', 'mixed') RETURNING id INTO j3;
  INSERT INTO job_invoices (job_id, created_by, status, issued_at, subtotal_cents, total_cents, tax_cents) VALUES (j3, u1, 'sent', '2026-05-02', 30000, 31000, 1000);
  INSERT INTO job_invoices (job_id, created_by, status, issued_at, subtotal_cents, total_cents) VALUES (j3, u1, 'draft', '2026-05-03', 5000, 5000);
  -- Another company's job: must never leak into org 1.
  INSERT INTO production_jobs (org_id, job_number, sale_date, sale_amount) VALUES (o2, 'B-1', '2026-03-10', 777) RETURNING id INTO jb;

  -- ===== Service (invoices with no job) =====
  INSERT INTO org_trades VALUES (o2, 'lawn', 'Lawn');
  pa := (SELECT id FROM properties WHERE customer_id = ca LIMIT 1);
  IF pa IS NULL THEN INSERT INTO properties (org_id, customer_id, address_text) VALUES (o1, ca, '1 Oak St') RETURNING id INTO pa; END IF;
  INSERT INTO service_plan_templates (org_id, name, trade) VALUES (o1, 'Weekly lawn care', 'lawn') RETURNING id INTO tpl;
  INSERT INTO service_plans (org_id, customer_id, property_id, template_id, trade, name, price, created_by, start_date)
    VALUES (o1, ca, pa, tpl, 'lawn', 'Pat - lawn', 60, u1, '2026-03-01') RETURNING id INTO plan_id;
  INSERT INTO work_orders (org_id, customer_id, trade, work_order_type, status, title, service_plan_id, property_id, visit_step, service_planned_date, scheduled_date)
    VALUES (o1, ca, 'lawn', 'service_visit', 'completed', 'visit', plan_id, pa, 'service', '2026-03-16', '2026-03-16') RETURNING id INTO v1;
  INSERT INTO work_orders (org_id, customer_id, trade, work_order_type, status, title, service_plan_id, property_id, visit_step, service_planned_date, scheduled_date)
    VALUES (o1, ca, 'lawn', 'service_visit', 'completed', 'visit2', plan_id, pa, 'service', '2026-03-23', '2026-03-23') RETURNING id INTO v2;
  -- Invoice 1: a plan visit, $60.
  r := bill(o1, ca, pa, u1, jsonb_build_array(jsonb_build_object('description', 'Weekly lawn care', 'qty', 1, 'unit_price_cents', 6000, 'work_order_id', v1, 'service_plan_id', plan_id, 'service_date', '2026-03-16')));
  inv1 := (r->>'invoice_id')::uuid;
  UPDATE job_invoices SET status = 'sent', issued_at = '2026-03-16' WHERE id = inv1;
  -- Invoice 2: one-off hourly line $90 with $5 tax.
  r := bill(o1, ca, pa, u1, jsonb_build_array(jsonb_build_object('description', 'Hedge trimming', 'qty', 2, 'unit', 'hour', 'unit_price_cents', 4500)), 500);
  inv2 := (r->>'invoice_id')::uuid;
  UPDATE job_invoices SET status = 'sent', issued_at = '2026-04-10' WHERE id = inv2;
  -- Invoice 3: VOID (was billed, then voided): counts nothing.
  r := bill(o1, ca, pa, u1, jsonb_build_array(jsonb_build_object('description', 'Mistake', 'qty', 1, 'unit_price_cents', 99900)));
  inv3 := (r->>'invoice_id')::uuid;
  UPDATE job_invoices SET status = 'void', void_reason = 'oops' WHERE id = inv3;
  -- Invoice 4: DRAFT: counts nothing.
  r := bill(o1, ca, pa, u1, jsonb_build_array(jsonb_build_object('description', 'Not sent', 'qty', 1, 'unit_price_cents', 12300, 'work_order_id', v2, 'service_plan_id', plan_id, 'service_date', '2026-03-23')));
  inv4 := (r->>'invoice_id')::uuid;
  -- Payments: invoice 1 paid in full in March, then $10 refunded in April (negative row); invoice 2 paid $50 in April.
  PERFORM record_customer_invoice_payment(o1, inv1, 6000, '2026-03-17', 'card', NULL, u1);
  INSERT INTO job_payments (job_id, org_id, customer_id, paid_at, amount_cents, payment_type, method, payer) VALUES (NULL, o1, ca, '2026-04-02', -1000, 'other', 'card', 'other');
  PERFORM record_customer_invoice_payment(o1, inv2, 5000, '2026-04-12', 'cash', NULL, u1);
  -- Another company's service invoice + payment.
  INSERT INTO properties (org_id, customer_id, address_text) VALUES (o2, cb, '9 Elm');
  r := bill(o2, cb, (SELECT id FROM properties WHERE customer_id = cb), u1, jsonb_build_array(jsonb_build_object('description', 'B work', 'qty', 1, 'unit_price_cents', 55500)));
  UPDATE job_invoices SET status = 'sent', issued_at = '2026-03-16' WHERE id = (r->>'invoice_id')::uuid;

  -- ===== Assertions (org 1) =====
  -- T1 jobs billed ONCE: J1 contract 10000 (March) + 250 tax (April) + J3 T&M 310 (May); J2 cancelled 0, drafts 0.
  SELECT coalesce(sum(billed_jobs), 0) INTO bj FROM rpt_revenue WHERE org_id = o1;
  ASSERT bj = 10560, 'T1 jobs billed ' || bj;
  ASSERT (SELECT sum(billed) FROM rpt_revenue WHERE org_id = o1 AND work_type = 'Jobs' AND event_date BETWEEN '2026-03-01' AND '2026-03-31') = 10000, 'T1 March = the contract only (deposit + final invoices add nothing)';
  ASSERT (SELECT sum(billed) FROM rpt_revenue WHERE org_id = o1 AND service = 'Sales tax' AND work_type = 'Jobs') = 250, 'T1 invoice tax on top of the contract';
  ASSERT (SELECT sum(billed) FROM rpt_revenue WHERE org_id = o1 AND service = 'Hourly (time & materials)' AND work_type = 'Jobs') = 310, 'T1 T&M job bills its issued invoices, not the estimate';
  ASSERT NOT EXISTS (SELECT 1 FROM rpt_revenue WHERE reference = '26-0002' AND entry = 'Billed'), 'T1 cancelled job bills nothing';
  -- T2 service billed: invoice1 60 + invoice2 90 + 5 tax = 155; void (999) and draft (123) excluded.
  SELECT coalesce(sum(billed_service), 0) INTO bs FROM rpt_revenue WHERE org_id = o1;
  ASSERT bs = 155, 'T2 service billed ' || bs;
  -- ...and it ties to rpt_invoices' own totals (the dataset that already exists) - never more, never less.
  ASSERT bs = (SELECT sum(total) FROM (SELECT i.total_cents / 100.0 AS total FROM job_invoices i WHERE i.org_id = o1 AND i.job_id IS NULL AND i.status IN ('sent','partially_paid','paid')) q), 'T2 ties to issued invoice totals';
  -- T3 by service: the plan template's name carries the plan line; hours / tax have their own names.
  ASSERT (SELECT sum(billed) FROM rpt_revenue WHERE org_id = o1 AND service = 'Weekly lawn care') = 60, 'T3 by plan template';
  ASSERT (SELECT sum(billed) FROM rpt_revenue WHERE org_id = o1 AND service = 'Hourly (time & materials)' AND work_type = 'Service') = 90, 'T3 hourly line';
  ASSERT (SELECT trade FROM rpt_revenue WHERE org_id = o1 AND service = 'Weekly lawn care') = 'Lawn care', 'T3 trade label';
  -- T4 collected: ONE ledger. Jobs: 5000 + 5000 (pending 123.45 excluded). Service: 60 - 10 (refund) + 50.
  SELECT coalesce(sum(collected_jobs), 0), coalesce(sum(collected_service), 0) INTO cj, cs FROM rpt_revenue WHERE org_id = o1;
  ASSERT cj = 10000, 'T4 jobs collected ' || cj;
  ASSERT cs = 100, 'T4 service collected net of the refund ' || cs;
  ASSERT (SELECT sum(collected) FROM rpt_revenue WHERE org_id = o1 AND event_date BETWEEN '2026-04-01' AND '2026-04-30' AND work_type = 'Service') = 40, 'T4 the refund lands in April: -10 + 50';
  -- T5 nothing is both billed and collected on one row; totals are the sum of both kinds.
  ASSERT NOT EXISTS (SELECT 1 FROM rpt_revenue WHERE billed <> 0 AND collected <> 0), 'T5 a row is billed OR collected';
  ASSERT (SELECT sum(billed) FROM rpt_revenue WHERE org_id = o1) = bj + bs, 'T5 billed = jobs + service';
  -- T6 company fence: org 2 sees only its own rows, org 1 never sees 777 or 555.
  ASSERT (SELECT sum(billed) FROM rpt_revenue WHERE org_id = o2) = 777 + 555, 'T6 org 2 own money';
  ASSERT NOT EXISTS (SELECT 1 FROM rpt_revenue WHERE org_id = o1 AND reference IN ('B-1')), 'T6 no cross-company row';
  -- T7 revenue_id is unique (the report runner pages on it).
  ASSERT (SELECT count(*) FROM rpt_revenue) = (SELECT count(DISTINCT revenue_id) FROM rpt_revenue), 'T7 unique ids';
  -- T8 an invoice with no lines still bills its subtotal (imported summary invoice): ties to the invoice total.
  INSERT INTO job_invoices (org_id, customer_id, property_id, created_by, status, issued_at, subtotal_cents, total_cents, tax_cents, invoice_kind)
    VALUES (o1, ca, pa, u1, 'sent', '2026-05-10', 20000, 20000, 0, 'service');
  ASSERT (SELECT sum(billed_service) FROM rpt_revenue WHERE org_id = o1) = 355, 'T8 lineless invoice bills its subtotal';
  -- T9 the view is closed to the browser roles like every rpt_* view.
  ASSERT NOT has_table_privilege('anon', 'rpt_revenue', 'select') AND NOT has_table_privilege('authenticated', 'rpt_revenue', 'select'), 'T9 revoked from anon / authenticated';
  RAISE NOTICE 'REPORT: all assertions passed';
END
$t$;
