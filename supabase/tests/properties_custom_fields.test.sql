-- Self-contained DB test for 202611110010_properties + 202611110020_custom_fields + data-fixes/2026-11-11_backfill_properties.
-- Runs against a THROWAWAY local Postgres (see run-properties-custom-fields.sh): builds a minimal copy of the columns those
-- files touch, applies them, and asserts. Never point it at Supabase.
\set ON_ERROR_STOP 1
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
END $$;
DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS release_backups CASCADE;
CREATE TABLE orgs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text);
CREATE TABLE users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid REFERENCES orgs(id));
CREATE TABLE customers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES orgs(id), name text, address_text text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE opportunities (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, customer_id uuid REFERENCES customers(id),
  address_text text, lat numeric, lng numeric, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE projects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, opportunity_id uuid REFERENCES opportunities(id));
-- Column types as in prod (2026-11-11): opportunities.lat/lng numeric, production_jobs.lat/lng double precision.
CREATE TABLE production_jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, project_id uuid, customer_id uuid,
  address_text text, lat double precision, lng double precision, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE work_orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, job_id uuid, customer_id uuid,
  address text, city text, state text, zip text, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE documents (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, job_id uuid, customer_id uuid,
  storage_path text NOT NULL DEFAULT 'x', deleted_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now());
-- The prod "last updated" stamps (same names), so the test proves the backfill leaves them alone.
CREATE FUNCTION update_updated_at() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN NEW.updated_at = now(); RETURN NEW; END $f$;
CREATE TRIGGER trigger_production_jobs_updated_at BEFORE UPDATE ON production_jobs FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trigger_work_orders_updated_at BEFORE UPDATE ON work_orders FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trigger_enforce_documents_mvp_rules BEFORE UPDATE ON documents FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Existing data BEFORE the migration (ARX-shaped): A has one home, B has two, C has a blank address, org2 is another company.
INSERT INTO orgs (id) VALUES ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002');
INSERT INTO customers (id, org_id, address_text) VALUES
 ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000001', '12 Oak St, Concord, NC 28025'),
 ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000001', '1 Pine Rd, Concord, NC 28025, USA'),
 ('10000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-000000000001', ''),
 ('20000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000002', '12 Oak St, Concord, NC 28025');
INSERT INTO opportunities (id, org_id, customer_id, address_text, lat, lng) VALUES
 ('30000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000a', '12 oak st,  Concord, NC 28025', 35.4, -80.6),
 ('30000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000b', '1 Pine Rd, Concord, NC 28025', NULL, NULL),
 ('30000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000b', '9 Lake Dr, Kannapolis, NC 28081', NULL, NULL),
 ('30000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000c', NULL, NULL, NULL);
INSERT INTO projects (id, org_id, opportunity_id) VALUES ('40000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-00000000000a');
INSERT INTO production_jobs (id, org_id, project_id, customer_id, address_text, updated_at) VALUES
 ('50000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', '12 Oak Street, Concord NC', '2026-01-01T00:00:00Z');
-- A job with no deal behind it (customer D): its own address makes the property; coordinates are double precision.
INSERT INTO customers (id, org_id, address_text) VALUES ('10000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-000000000001', '511 Allison St NW, Concord, NC 28027');
INSERT INTO production_jobs (id, org_id, project_id, customer_id, address_text, lat, lng, updated_at) VALUES
 ('50000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000001', NULL, '10000000-0000-0000-0000-00000000000d', '511 Allison St nw concord nc', 35.41234567891, -80.58765432109, '2026-01-01T00:00:00Z');
-- Customer B also has two near-duplicate deal addresses (house number differs) for the preview list.
INSERT INTO opportunities (org_id, customer_id, address_text) VALUES
 ('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000b', '706 Patricia Ave, Concord, NC 28025'),
 ('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000b', '710 Patricia Ave, Concord, NC 28025');
INSERT INTO work_orders (id, org_id, job_id, customer_id, updated_at) VALUES ('60000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-00000000000a', NULL, '2026-01-01T00:00:00Z');
INSERT INTO documents (id, org_id, job_id, updated_at) VALUES ('70000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-00000000000a', '2026-01-01T00:00:00Z');

\i supabase/migrations/202611110010_properties.sql
\i supabase/migrations/202611110020_custom_fields.sql
\o /dev/null
\i supabase/data-fixes/2026-11-11_backfill_properties.sql
\o

DO $t$
DECLARE pv jsonb; ap jsonb; ap2 jsonb; un jsonb; n int; pa uuid; pb uuid; pid uuid; v jsonb; ok boolean;
  o1 uuid := '00000000-0000-0000-0000-000000000001'; o2 uuid := '00000000-0000-0000-0000-000000000002';
  ca uuid := '10000000-0000-0000-0000-00000000000a'; cb uuid := '10000000-0000-0000-0000-00000000000b'; c2 uuid := '20000000-0000-0000-0000-00000000000a';
BEGIN
  -- T1 address key
  ASSERT public.property_address_key('123 Main St., Tallahassee, FL 32301, USA') = '123 main st tallahassee', 'T1 key ' || public.property_address_key('123 Main St., Tallahassee, FL 32301, USA');
  ASSERT public.property_address_key('511 Allison St nw concord nc') = public.property_address_key('511 Allison St NW, Concord, NC 28027'), 'T1 zip/state/case';
  ASSERT public.property_address_key('511 Allison St NW, Concord, NC 28027-1234') = '511 allison st nw concord', 'T1 zip+4';
  ASSERT public.property_address_key('12 Oak Ct') = '12 oak ct', 'T1 Ct kept on a short address';
  ASSERT public.property_address_key('706 Patricia Ave') <> public.property_address_key('710 Patricia Ave'), 'T1 house numbers never merge';
  ASSERT public.property_address_key('  ') = '', 'T1 blank';
  ASSERT public.property_address_key('Unit #4-B, 5 Elm') = 'unit #4-b 5 elm', 'T1 keeps # and -';
  -- T2 preview writes nothing
  pv := release_backups.backfill_properties('preview');
  ASSERT (SELECT count(*) FROM properties) = 0, 'T2 preview wrote';
  -- A x1, B x4 (Pine, Lake, 706, 710), D x1 (job without a deal), org2 x1
  ASSERT (pv->'plan'->>'properties_needed')::int = 7, 'T2 needed=' || (pv->'plan'->>'properties_needed');
  ASSERT jsonb_array_length(pv->'plan'->'near_duplicates_to_check') = 1
     AND pv->'plan'->'near_duplicates_to_check'->0->>'why' = 'house number differs', 'T2 near dups ' || (pv->'plan'->'near_duplicates_to_check')::text;
  -- T3 apply
  ap := release_backups.backfill_properties('apply');
  ASSERT (ap->>'properties_created')::int = 7, 'T3 created ' || ap::text;
  ASSERT (SELECT count(*) FROM properties WHERE source = 'backfill') = 7, 'T3 source';
  ASSERT (SELECT p.lat FROM production_jobs j JOIN properties p ON p.id = j.property_id WHERE j.id = '50000000-0000-0000-0000-00000000000b') = 35.41234568, 'T3 job without deal: own address + double coords';
  ASSERT (SELECT count(*) FROM properties WHERE customer_id = '10000000-0000-0000-0000-00000000000d') = 1, 'T3 D: customer address and job address are one property';
  ASSERT (SELECT updated_at FROM production_jobs WHERE id = '50000000-0000-0000-0000-00000000000a') = '2026-01-01T00:00:00Z', 'T3 job updated_at kept';
  ASSERT (SELECT updated_at FROM work_orders WHERE id = '60000000-0000-0000-0000-00000000000a') = '2026-01-01T00:00:00Z', 'T3 work order updated_at kept';
  ASSERT (SELECT updated_at FROM documents WHERE id = '70000000-0000-0000-0000-00000000000a') = '2026-01-01T00:00:00Z', 'T3 document updated_at kept';
  ASSERT (SELECT bool_and(t.tgenabled = 'O') FROM pg_trigger t WHERE t.tgname IN ('trigger_production_jobs_updated_at', 'trigger_work_orders_updated_at', 'trigger_enforce_documents_mvp_rules')), 'T3 stamp triggers back on';
  SELECT property_id INTO pa FROM opportunities WHERE id = '30000000-0000-0000-0000-00000000000a';
  ASSERT pa IS NOT NULL, 'T3 opp A linked';
  ASSERT (SELECT lat FROM properties WHERE id = pa) = 35.4, 'T3 coords from deal';
  ASSERT (SELECT property_id FROM production_jobs WHERE id = '50000000-0000-0000-0000-00000000000a') = pa, 'T3 job takes deal property despite spelling';
  ASSERT (SELECT property_id FROM work_orders WHERE id = '60000000-0000-0000-0000-00000000000a') = pa, 'T3 work order takes job property';
  ASSERT (SELECT property_id FROM documents WHERE id = '70000000-0000-0000-0000-00000000000a') = pa, 'T3 document takes job property';
  ASSERT (SELECT count(DISTINCT property_id) FROM opportunities WHERE customer_id = cb) = 4, 'T3 B has four properties (near duplicates are not merged)';
  ASSERT (SELECT property_id FROM opportunities WHERE id = '30000000-0000-0000-0000-00000000000c') IS NULL, 'T3 blank address stays NULL';
  ASSERT (SELECT org_id FROM properties WHERE customer_id = c2) = o2, 'T3 org2 property in org2';
  ASSERT (SELECT address_text FROM opportunities WHERE id = '30000000-0000-0000-0000-00000000000a') = '12 oak st,  Concord, NC 28025', 'T3 address untouched';
  -- T4 re-apply is a no-op
  ap2 := release_backups.backfill_properties('apply');
  ASSERT (ap2->>'properties_created')::int = 0 AND (ap2->>'opportunities_linked')::int = 0 AND (ap2->>'jobs_linked')::int = 0, 'T4 rerun ' || ap2::text;

  -- T5 insert fill: a new deal at a known address reuses it; a new address creates an 'auto' property; jobs inherit
  INSERT INTO opportunities (org_id, customer_id, address_text) VALUES (o1, ca, '12 Oak St, Concord, NC 28025') RETURNING property_id INTO pid;
  ASSERT pid = pa, 'T5 reuse';
  INSERT INTO opportunities (id, org_id, customer_id, address_text) VALUES ('30000000-0000-0000-0000-0000000000d1', o1, ca, '77 New Way, Concord NC') RETURNING property_id INTO pb;
  ASSERT pb IS NOT NULL AND (SELECT source FROM properties WHERE id = pb) = 'auto', 'T5 auto';
  INSERT INTO projects (id, org_id, opportunity_id) VALUES ('40000000-0000-0000-0000-0000000000d1', o1, '30000000-0000-0000-0000-0000000000d1');
  INSERT INTO production_jobs (id, org_id, project_id, customer_id, address_text) VALUES ('50000000-0000-0000-0000-0000000000d1', o1, '40000000-0000-0000-0000-0000000000d1', ca, 'something else') RETURNING property_id INTO pid;
  ASSERT pid = pb, 'T5 job inherits deal property';
  INSERT INTO production_jobs (org_id, customer_id, address_text, lat, lng) VALUES (o1, cb, '3 Fresh Rd, Concord NC', 35.5::double precision, -80.5::double precision) RETURNING property_id INTO pid;
  ASSERT pid IS NOT NULL AND (SELECT lng FROM properties WHERE id = pid) = -80.5, 'T5 job without deal fills with double precision coords';
  INSERT INTO work_orders (org_id, job_id) VALUES (o1, '50000000-0000-0000-0000-0000000000d1') RETURNING property_id INTO pid;
  ASSERT pid = pb, 'T5 work order inherits';
  INSERT INTO work_orders (org_id, customer_id, address, city, state, zip) VALUES (o1, cb, '9 Lake Dr', 'Kannapolis', 'NC', '28081') RETURNING property_id INTO pid;
  ASSERT pid = (SELECT property_id FROM opportunities WHERE id = '30000000-0000-0000-0000-0000000000b2'), 'T5 work order by parts';
  INSERT INTO documents (org_id, customer_id) VALUES (o1, ca) RETURNING property_id INTO pid;
  ASSERT pid IS NULL, 'T5 customer-level document gets no property by itself';
  INSERT INTO documents (org_id, customer_id, property_id) VALUES (o1, ca, pa) RETURNING property_id INTO pid;
  ASSERT pid = pa, 'T5 customer-level document with its property';
  INSERT INTO documents (org_id, job_id, customer_id) VALUES (o1, '50000000-0000-0000-0000-0000000000d1', cb) RETURNING property_id INTO pid;
  ASSERT pid IS NULL, 'T5 document whose customer differs from the job gets none';
  INSERT INTO opportunities (org_id, customer_id, address_text) VALUES (o1, NULL, '1 Nowhere') RETURNING property_id INTO pid;
  ASSERT pid IS NULL, 'T5 no customer no property';

  -- T6 company fence: another company's property is refused on insert and update; another customer's too
  ok := false; BEGIN INSERT INTO opportunities (org_id, customer_id, address_text, property_id) VALUES (o2, c2, 'x', pa); EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  ASSERT ok, 'T6 cross-company insert refused';
  ok := false; BEGIN UPDATE documents SET property_id = (SELECT id FROM properties WHERE customer_id = c2) WHERE id = '70000000-0000-0000-0000-00000000000a'; EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  ASSERT ok, 'T6 cross-company update refused';
  ok := false; BEGIN INSERT INTO production_jobs (org_id, customer_id, property_id) VALUES (o1, cb, pa); EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  ASSERT ok, 'T6 other customer refused';
  ok := false; BEGIN INSERT INTO properties (org_id, customer_id, address_text) VALUES (o2, ca, '5 Elm'); EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  ASSERT ok, 'T6 property for another company customer refused';
  ok := false; BEGIN INSERT INTO properties (org_id, customer_id, address_text) VALUES (o1, ca, '12 OAK ST Concord NC 28025'); EXCEPTION WHEN unique_violation THEN ok := true; END;
  ASSERT ok, 'T6 duplicate address refused';
  ok := false; BEGIN UPDATE properties SET org_id = o2 WHERE id = pa; EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  ASSERT ok, 'T6 cannot move company';

  -- T7 the fill never breaks an insert: a too-long address (CHECK fails inside ensure_property) still inserts the deal
  INSERT INTO opportunities (org_id, customer_id, address_text) VALUES (o1, ca, repeat('a', 600)) RETURNING property_id INTO pid;
  ASSERT pid IS NULL, 'T7 fill failure leaves NULL';

  -- T8 custom field values merge atomically and stay in the company
  v := public.set_custom_field_values('customer', o1, ca, '{"f1": "Gate 4421", "f2": 3}'::jsonb, NULL);
  ASSERT v = '{"f1": "Gate 4421", "f2": 3}'::jsonb, 'T8 set ' || v::text;
  v := public.set_custom_field_values('customer', o1, ca, '{"f3": true}'::jsonb, ARRAY['f1']);
  ASSERT v = '{"f2": 3, "f3": true}'::jsonb, 'T8 merge/remove ' || v::text;
  v := public.set_custom_field_values('customer', o2, ca, '{"f9": 1}'::jsonb, NULL);
  ASSERT v IS NULL, 'T8 other company finds nothing';
  ASSERT (SELECT custom_fields FROM customers WHERE id = ca) = '{"f2": 3, "f3": true}'::jsonb, 'T8 untouched by other company';
  v := public.set_custom_field_values('job', o1, '50000000-0000-0000-0000-00000000000a', '{"j": "x"}'::jsonb, NULL);
  ASSERT v = '{"j": "x"}'::jsonb, 'T8 job';
  v := public.set_custom_field_values('property', o1, pa, '{"p": "2020-01-01"}'::jsonb, NULL);
  ASSERT v = '{"p": "2020-01-01"}'::jsonb, 'T8 property';
  ok := false; BEGIN PERFORM public.set_custom_field_values('users', o1, ca, '{}'::jsonb, NULL); EXCEPTION WHEN OTHERS THEN ok := true; END;
  ASSERT ok, 'T8 unknown entity refused';
  ok := false; BEGIN INSERT INTO custom_field_definitions (org_id, entity, label, field_type, options) VALUES (o1, 'customer', 'A', 'text', '["x"]'); EXCEPTION WHEN check_violation THEN ok := true; END;
  ASSERT ok, 'T8 options only on dropdown';
  INSERT INTO custom_field_definitions (org_id, entity, label, field_type) VALUES (o1, 'customer', 'Gate code', 'text');
  ok := false; BEGIN INSERT INTO custom_field_definitions (org_id, entity, label, field_type) VALUES (o1, 'customer', ' gate CODE ', 'number'); EXCEPTION WHEN unique_violation THEN ok := true; END;
  ASSERT ok, 'T8 duplicate label refused';

  -- T10 moving a deal / job / document to another customer never leaves a property of the old customer on it
  UPDATE opportunities SET customer_id = cb WHERE id = '30000000-0000-0000-0000-0000000000d1' RETURNING property_id INTO pid;
  ASSERT pid IS NOT NULL AND (SELECT customer_id FROM properties WHERE id = pid) = cb, 'T10 deal re-homed to the new customer';
  ASSERT (SELECT address_text FROM properties WHERE id = pid) = '77 New Way, Concord NC', 'T10 same address';
  UPDATE documents SET customer_id = cb WHERE customer_id = ca AND property_id = pa RETURNING property_id INTO pid;
  ASSERT pid IS NULL, 'T10 document cleared (documents never create)';
  UPDATE opportunities SET customer_id = NULL WHERE id = '30000000-0000-0000-0000-0000000000d1' RETURNING property_id INTO pid;
  ASSERT pid IS NULL, 'T10 no customer, no property';
  UPDATE opportunities SET address_text = address_text WHERE id = '30000000-0000-0000-0000-00000000000a' RETURNING property_id INTO pid;
  ASSERT pid = pa, 'T10 an unrelated update leaves it alone';
  UPDATE opportunities SET customer_id = ca WHERE id = '30000000-0000-0000-0000-00000000000a' RETURNING property_id INTO pid;
  ASSERT pid = pa, 'T10 same customer rewritten: unchanged';
  UPDATE opportunities SET customer_id = cb WHERE id = '30000000-0000-0000-0000-0000000000d1' RETURNING property_id INTO pid;  -- NULL -> a customer
  ASSERT pid IS NOT NULL AND (SELECT customer_id FROM properties WHERE id = pid) = cb, 'T10 no customer -> customer fills';

  -- T9 undo: clears only rows still holding the applied value; keeps properties in use or edited
  UPDATE production_jobs SET property_id = pb WHERE id = '50000000-0000-0000-0000-00000000000a';   -- someone moved the job to A's other property since
  un := release_backups.undo_backfill_properties();
  RAISE NOTICE 'undo %', un;
  ASSERT (SELECT property_id FROM production_jobs WHERE id = '50000000-0000-0000-0000-00000000000a') = pb, 'T9 changed row left alone';
  ASSERT (SELECT property_id FROM opportunities WHERE id = '30000000-0000-0000-0000-00000000000a') IS NULL, 'T9 opp cleared';
  ASSERT EXISTS (SELECT 1 FROM properties WHERE id = pa), 'T9 property A kept (in use by the new deal / edited)';
  ASSERT NOT EXISTS (SELECT 1 FROM properties WHERE customer_id = c2), 'T9 unused backfill property deleted';
  ASSERT (un->>'left_alone_changed_since')::int = 1, 'T9 count changed';
  ASSERT (SELECT updated_at FROM work_orders WHERE id = '60000000-0000-0000-0000-00000000000a') = '2026-01-01T00:00:00Z', 'T9 undo kept work order updated_at';
  ASSERT (SELECT property_id FROM work_orders WHERE id = '60000000-0000-0000-0000-00000000000a') IS NULL, 'T9 work order cleared';

  RAISE EXCEPTION 'REPORT (rolled back by design): all assertions passed';
END $t$;
