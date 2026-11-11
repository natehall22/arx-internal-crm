-- Self-contained DB test for 202611120040_jobber_import (Move from Jobber). THROWAWAY local Postgres only
-- (run-jobber-import.sh). Applies the real invoice / properties / custom-field / service-plan / tax / customer-invoice
-- migrations, then this one twice, and asserts: Jobber ids unique per company, paid-before-import counted by the payment
-- writer and void guard, batch claim order, one-row undo / revert rules, the address-key list helper.
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
CREATE TABLE customers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE, name text, email text, phone text, address_text text, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE opportunities (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, customer_id uuid REFERENCES customers(id), address_text text, lat numeric, lng numeric);
CREATE TABLE projects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, opportunity_id uuid);
CREATE TABLE production_jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, job_number text, sale_date date, project_id uuid, customer_id uuid, address_text text, lat numeric, lng numeric);
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
\i supabase/migrations/202611110020_custom_fields.sql
\i supabase/migrations/202611110030_service_plans.sql
\i supabase/migrations/202611110040_sales_tax.sql
\i supabase/migrations/202611110060_customer_invoices.sql

CREATE TABLE pricebook_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES orgs(id), name text NOT NULL, unit_price numeric(10,2) NOT NULL DEFAULT 0);
CREATE TABLE proposal_adders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), pricebook_item_id uuid REFERENCES pricebook_items(id));
ALTER TABLE documents ADD CONSTRAINT documents_customer_fk FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL; -- as in 071
-- Online payments (202611120020) comes before this file: it owns the 8-arg no-job payment writer, the refund writer and
-- the NET void guard that this file copies with paid_outside_cents added.
\i supabase/migrations/122_job_payments_idempotency.sql
CREATE TYPE outbox_status AS ENUM ('pending', 'processing', 'completed', 'failed');
CREATE TABLE integration_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES orgs(id), provider text NOT NULL, event_type text NOT NULL,
  entity_table text NOT NULL, entity_id uuid NOT NULL, idempotency_key text NOT NULL UNIQUE, payload jsonb NOT NULL DEFAULT '{}',
  status outbox_status NOT NULL DEFAULT 'pending', created_at timestamptz NOT NULL DEFAULT now());
\i supabase/migrations/202611120020_online_payments.sql
\i supabase/migrations/202611120040_jobber_import.sql
-- Idempotent: a second apply changes nothing and does not fail.
\i supabase/migrations/202611120040_jobber_import.sql

INSERT INTO orgs VALUES ('00000000-0000-0000-0000-000000000001', 'A'), ('00000000-0000-0000-0000-000000000002', 'B');
INSERT INTO users VALUES ('90000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001');

DO $t$
DECLARE
  o1 uuid := '00000000-0000-0000-0000-000000000001'; o2 uuid := '00000000-0000-0000-0000-000000000002';
  u1 uuid := '90000000-0000-0000-0000-000000000001';
  c1 uuid; c2 uuid; c3 uuid; p1 uuid; inv uuid; inv2 uuid; pb uuid; doc uuid; run uuid; cf uuid; n int; ok boolean; r text; j jsonb;
BEGIN
  -- T1 Jobber id unique per company (same id in two companies is fine)
  INSERT INTO customers (org_id, name, import_source, import_source_id) VALUES (o1, 'Jane', 'jobber', '101') RETURNING id INTO c1;
  INSERT INTO customers (org_id, name, import_source, import_source_id) VALUES (o2, 'Other', 'jobber', '101');
  ok := false; BEGIN INSERT INTO customers (org_id, name, import_source, import_source_id) VALUES (o1, 'Dup', 'jobber', '101'); EXCEPTION WHEN unique_violation THEN ok := true; END; ASSERT ok, 'T1 duplicate refused';
  ok := false; BEGIN INSERT INTO customers (org_id, name, import_source) VALUES (o1, 'Half', 'jobber'); EXCEPTION WHEN check_violation THEN ok := true; END; ASSERT ok, 'T1 source without id refused';

  -- T2 paid before import: balance and void guard count it; never more than what is left
  INSERT INTO job_invoices (org_id, customer_id, invoice_kind, invoice_number, status, subtotal_cents, total_cents, paid_outside_cents, import_source, import_source_id, created_by)
    VALUES (o1, c1, 'service', '1042', 'partially_paid', 19500, 19500, 10000, 'jobber', 'invoice:1042', u1) RETURNING id INTO inv;
  INSERT INTO job_invoice_items (invoice_id, description, qty, unit_price_cents, line_total_cents) VALUES (inv, 'Mowing', 1, 19500, 19500);
  ok := false; BEGIN PERFORM record_customer_invoice_payment(o1, inv, 9501, '2026-11-11', 'cash', null, u1); EXCEPTION WHEN invalid_parameter_value THEN ok := true; END; ASSERT ok, 'T2 over balance refused';
  ok := false; BEGIN UPDATE job_invoices SET status = 'void', void_reason = 'x' WHERE id = inv; EXCEPTION WHEN check_violation THEN ok := true; END; ASSERT ok, 'T2 void refused (paid in Jobber)';
  ok := false; BEGIN UPDATE job_invoices SET paid_outside_cents = 5 WHERE job_id IS NOT NULL; INSERT INTO job_invoices (org_id, customer_id, invoice_kind, status, total_cents, paid_outside_cents, created_by) VALUES (o1, c1, 'service', 'sent', 100, 5, u1); EXCEPTION WHEN check_violation THEN ok := true; END; ASSERT ok, 'T2 paid_outside only on imported invoices';
  j := record_customer_invoice_payment(o1, inv, 9500, '2026-11-11', 'cash', null, u1);
  ASSERT j->>'status' = 'paid' AND (j->>'balance_cents')::int = 0, 'T2 rest paid → paid ' || j::text;
  -- T2b with online payments (0020): ONE writer signature (8 args, no 7-arg overload left for PostgREST to trip on); the
  -- idempotency key still dedupes; a refund's status counts the Jobber money; the void guard counts NET money + Jobber money.
  SELECT count(*) INTO n FROM pg_proc WHERE proname = 'record_customer_invoice_payment'; ASSERT n = 1, 'T2b one writer overload: ' || n;
  INSERT INTO job_invoices (org_id, customer_id, invoice_kind, invoice_number, status, subtotal_cents, total_cents, paid_outside_cents, import_source, import_source_id, created_by)
    VALUES (o1, c1, 'service', '2043', 'partially_paid', 10000, 10000, 4000, 'jobber', 'invoice:2043', u1) RETURNING id INTO inv2;
  j := record_customer_invoice_payment(o1, inv2, 6000, '2026-11-11', 'card', null, null, 'stripe:pi_1');
  ASSERT j->>'status' = 'paid' AND (j->>'duplicate')::boolean = false, 'T2b online rest paid ' || j::text;
  j := record_customer_invoice_payment(o1, inv2, 6000, '2026-11-11', 'card', null, null, 'stripe:pi_1');
  ASSERT (j->>'duplicate')::boolean AND (j->>'balance_cents')::int = 0, 'T2b same key = same payment ' || j::text;
  j := record_customer_invoice_refund(o1, inv2, 6000, '2026-11-12', 'card', null, 'stripe-refund:re_1');
  ASSERT j->>'status' = 'partially_paid', 'T2b refund leaves the Jobber money: partly paid ' || j::text;
  ok := false; BEGIN UPDATE job_invoices SET status = 'void', void_reason = 'x' WHERE id = inv2; EXCEPTION WHEN check_violation THEN ok := true; END; ASSERT ok, 'T2b void still refused (Jobber money)';
  UPDATE job_invoices SET paid_outside_cents = NULL, status = 'sent' WHERE id = inv2;
  UPDATE job_invoices SET status = 'void', void_reason = 'refunded in full' WHERE id = inv2;
  ASSERT (SELECT status FROM job_invoices WHERE id = inv2) = 'void', 'T2b fully refunded (net 0) can be voided';
  inv2 := NULL;

  -- T3 claim: lowest rank first, never past a rank still being written
  INSERT INTO import_runs (org_id, status, created_by) VALUES (o1, 'importing', u1) RETURNING id INTO run;
  ok := false; BEGIN INSERT INTO import_runs (org_id, status, created_by) VALUES (o1, 'draft', u1); EXCEPTION WHEN unique_violation THEN ok := true; END; ASSERT ok, 'T3 one open run per company';
  INSERT INTO import_run_items (org_id, run_id, kind, rank, seq, source_id, action) VALUES
    (o1, run, 'customer', 3, 1, 'a', 'create'), (o1, run, 'customer', 3, 2, 'b', 'create'), (o1, run, 'property', 4, 1, 'a:1', 'create');
  SELECT count(*) INTO n FROM import_run_claim(o1, run, 1); ASSERT n = 1, 'T3 batch size';
  SELECT count(*) INTO n FROM import_run_claim(o1, run, 50); ASSERT n = 1, 'T3 rest of rank 3 only';
  SELECT count(*) INTO n FROM import_run_claim(o1, run, 50); ASSERT n = 0, 'T3 rank 4 waits while rank 3 is working';
  UPDATE import_run_items SET status = 'done' WHERE run_id = run AND rank = 3;
  SELECT count(*) INTO n FROM import_run_claim(o1, run, 50); ASSERT n = 1, 'T3 then rank 4';
  SELECT count(*) INTO n FROM import_run_claim(o2, run, 50); ASSERT n = 0, 'T3 other company claims nothing';
  UPDATE import_run_items SET claimed_at = now() - interval '11 minutes' WHERE run_id = run AND rank = 4;
  SELECT count(*) INTO n FROM import_run_claim(o1, run, 50); ASSERT n = 1, 'T3 stale working item reclaimed';

  -- T4 undo one row
  INSERT INTO customers (org_id, name, email, import_source, import_source_id) VALUES (o1, 'Bob', 'b@x.com', 'jobber', '102') RETURNING id INTO c2;
  r := import_undo_row(o1, 'customers', c2, '{"name":"Bob","email":"b@x.com"}'); ASSERT r = 'deleted', 'T4 untouched row deleted: ' || r;
  r := import_undo_row(o1, 'customers', c2, '{}'); ASSERT r = 'gone', 'T4 gone';
  INSERT INTO customers (org_id, name, email) VALUES (o1, 'Cat', 'c@x.com') RETURNING id INTO c3;
  UPDATE customers SET email = 'new@x.com' WHERE id = c3;
  r := import_undo_row(o1, 'customers', c3, '{"email":"c@x.com"}'); ASSERT r = 'changed', 'T4 changed kept: ' || r;
  r := import_undo_row(o2, 'customers', c3, '{}'); ASSERT r = 'gone', 'T4 another company sees nothing';
  INSERT INTO properties (org_id, customer_id, address_text) VALUES (o1, c3, '1 Club Dr, Crawfordville, FL 32327') RETURNING id INTO p1;
  r := import_undo_row(o1, 'customers', c3, '{"email":"new@x.com"}'); ASSERT r = 'in_use', 'T4 referenced kept: ' || r;
  -- an invoice: its own lines go with it, a payment keeps it
  r := import_undo_row(o1, 'job_invoices', inv, '{"total_cents":19500}', ARRAY['job_invoice_items']); ASSERT r = 'in_use', 'T4 paid invoice kept: ' || r;
  INSERT INTO job_invoices (org_id, customer_id, invoice_kind, invoice_number, status, total_cents, import_source, import_source_id, created_by)
    VALUES (o1, c1, 'service', '1043', 'sent', 500, 'jobber', 'invoice:1043', u1) RETURNING id INTO inv2;
  INSERT INTO job_invoice_items (invoice_id, description, qty, unit_price_cents, line_total_cents) VALUES (inv2, 'Leaves', 1, 500, 500);
  r := import_undo_row(o1, 'job_invoices', inv2, '{"total_cents":500,"status":"sent"}', ARRAY['job_invoice_items']); ASSERT r = 'deleted', 'T4 unpaid invoice deleted: ' || r;
  ASSERT NOT EXISTS (SELECT 1 FROM job_invoice_items WHERE invoice_id = inv2), 'T4 lines gone';
  -- numbers compare as numbers (45.00 = 45)
  INSERT INTO pricebook_items (org_id, name, unit_price, import_source, import_source_id) VALUES (o1, 'Mow', 45.00, 'jobber', 'product:mow') RETURNING id INTO pb;
  r := import_undo_row(o1, 'pricebook_items', pb, '{"unit_price":45}'); ASSERT r = 'deleted', 'T4 numeric compare: ' || r;
  -- documents: soft delete
  INSERT INTO documents (org_id, customer_id) VALUES (o1, c1) RETURNING id INTO doc;
  r := import_undo_row(o1, 'documents', doc, '{"deleted_at":null}'); ASSERT r = 'deleted' AND (SELECT deleted_at FROM documents WHERE id = doc) IS NOT NULL, 'T4 document soft-deleted';
  -- a customer whose only reference is a removed (soft-deleted) document can be undone
  DECLARE c4 uuid; BEGIN
    INSERT INTO customers (org_id, name) VALUES (o1, 'Dee') RETURNING id INTO c4;
    INSERT INTO documents (org_id, customer_id, deleted_at) VALUES (o1, c4, now());
    r := import_undo_row(o1, 'customers', c4, '{"name":"Dee"}'); ASSERT r = 'deleted', 'T4 soft-deleted document does not hold the customer: ' || r;
    INSERT INTO customers (org_id, name) VALUES (o1, 'Eve') RETURNING id INTO c4;
    INSERT INTO documents (org_id, customer_id) VALUES (o1, c4);
    r := import_undo_row(o1, 'customers', c4, '{"name":"Eve"}'); ASSERT r = 'in_use', 'T4 live document holds the customer';
  END;
  -- custom field: kept while a record holds a value
  INSERT INTO custom_field_definitions (org_id, entity, label, field_type) VALUES (o1, 'customer', 'Gate code', 'text') RETURNING id INTO cf;
  UPDATE customers SET custom_fields = jsonb_build_object(cf::text, '4421') WHERE id = c1;
  r := import_undo_row(o1, 'custom_field_definitions', cf, '{}'); ASSERT r = 'in_use', 'T4 field with values kept';
  UPDATE customers SET custom_fields = '{}' WHERE id = c1;
  r := import_undo_row(o1, 'custom_field_definitions', cf, '{}'); ASSERT r = 'deleted', 'T4 field without values removed';
  ok := false; BEGIN PERFORM import_undo_row(o1, 'users', u1, '{}'); EXCEPTION WHEN insufficient_privilege THEN ok := true; END; ASSERT ok, 'T4 other tables refused';

  -- T5 revert a filled-in row only while it still holds what the import wrote
  UPDATE customers SET phone = '8505550101', import_source = 'jobber', import_source_id = '103' WHERE id = c3;
  r := import_revert_row(o1, 'customers', c3, '{"phone":"8505550101","import_source":"jobber","import_source_id":"103"}', '{"phone":null,"import_source":null,"import_source_id":null,"org_id":"00000000-0000-0000-0000-000000000002"}');
  ASSERT r = 'reverted', 'T5 reverted: ' || r;
  ASSERT (SELECT phone IS NULL AND import_source IS NULL AND org_id = o1 FROM customers WHERE id = c3), 'T5 values back, org untouched';
  UPDATE customers SET phone = '1' WHERE id = c3;
  r := import_revert_row(o1, 'customers', c3, '{"phone":"8505550101"}', '{"phone":null}'); ASSERT r = 'changed', 'T5 changed kept';

  -- T6 same-address keys for a list, in order
  ASSERT property_address_keys(ARRAY['511 Allison St NW, Concord, NC 28027, USA', '12 Oak Ct']) = ARRAY['511 allison st nw concord', '12 oak ct'], 'T6 keys';

  RAISE NOTICE 'REPORT: all assertions passed';
END $t$;
