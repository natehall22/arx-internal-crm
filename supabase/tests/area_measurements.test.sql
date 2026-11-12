-- Self-contained DB test for 202611230040_area_measurements (Measure yard). THROWAWAY local Postgres only
-- (run-area-measurements.sh). Minimal parent tables + the real migration, then: deleting a lead / deal / property never
-- trips the has_owner CHECK (a measurement with no other parent goes with it, one with another parent keeps it), the
-- order of a lead's and its deal's deletion does not matter, a customer that still has measurements cannot be deleted,
-- a company delete still cascades, and the company / customer fences on INSERT hold.
\set ON_ERROR_STOP 1
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
END $$;
DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;
CREATE TABLE orgs (id uuid PRIMARY KEY);
CREATE TABLE users (id uuid PRIMARY KEY, org_id uuid REFERENCES orgs(id) ON DELETE CASCADE);
CREATE TABLE customers (id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE);
CREATE TABLE properties (id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE, customer_id uuid REFERENCES customers(id) ON DELETE CASCADE);
CREATE TABLE leads (id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE, customer_id uuid REFERENCES customers(id) ON DELETE SET NULL);
CREATE TABLE opportunities (id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE, lead_id uuid REFERENCES leads(id) ON DELETE CASCADE, customer_id uuid REFERENCES customers(id) ON DELETE SET NULL);

\i supabase/migrations/202611230040_area_measurements.sql
-- applying twice must be harmless
\i supabase/migrations/202611230040_area_measurements.sql

INSERT INTO orgs VALUES ('00000000-0000-0000-0000-0000000000a1'), ('00000000-0000-0000-0000-0000000000b1');
INSERT INTO users VALUES ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a1');
INSERT INTO customers VALUES ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000a1'), ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000b1');
INSERT INTO properties VALUES ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a3');
INSERT INTO leads VALUES
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', NULL),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a3'),
  ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000a1', NULL),
  ('00000000-0000-0000-0000-0000000000c4', '00000000-0000-0000-0000-0000000000a1', NULL),
  ('00000000-0000-0000-0000-0000000000cb', '00000000-0000-0000-0000-0000000000b1', NULL);
INSERT INTO opportunities VALUES
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c3', NULL),
  ('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c4', NULL),
  ('00000000-0000-0000-0000-0000000000d5', '00000000-0000-0000-0000-0000000000a1', NULL, NULL);

CREATE FUNCTION pg_temp.m(label text, lead uuid, opp uuid, cust uuid, prop uuid) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.area_measurements (id, org_id, customer_id, property_id, opportunity_id, lead_id, shapes, address_text)
  VALUES (gen_random_uuid(), '00000000-0000-0000-0000-0000000000a1', cust, prop, opp, lead, '[{"type":"lawn"}]'::jsonb, label) $$;
CREATE FUNCTION pg_temp.expect(cond boolean, what text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF NOT cond THEN RAISE EXCEPTION 'ASSERT FAILED: %', what; END IF; END $$;
CREATE FUNCTION pg_temp.fails(sql text, what text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  BEGIN EXECUTE sql; EXCEPTION WHEN OTHERS THEN RETURN; END;
  RAISE EXCEPTION 'ASSERT FAILED (should have been refused): %', what; END $$;

-- 1. a lead-only measurement: deleting the lead deletes it (no CHECK error)
SELECT pg_temp.m('lead-only', '00000000-0000-0000-0000-0000000000c1', NULL, NULL, NULL);
DELETE FROM leads WHERE id = '00000000-0000-0000-0000-0000000000c1';
SELECT pg_temp.expect((SELECT count(*) FROM area_measurements WHERE address_text = 'lead-only') = 0, 'lead-only row removed with its lead');

-- 2. a lead + customer measurement: the lead goes, the customer's row stays with lead_id cleared
SELECT pg_temp.m('lead-and-customer', '00000000-0000-0000-0000-0000000000c2', NULL, '00000000-0000-0000-0000-0000000000a3', NULL);
DELETE FROM leads WHERE id = '00000000-0000-0000-0000-0000000000c2';
SELECT pg_temp.expect((SELECT count(*) FROM area_measurements WHERE address_text = 'lead-and-customer' AND lead_id IS NULL AND customer_id IS NOT NULL) = 1, 'customer row kept, lead id cleared');

-- 3. a row on a lead AND its deal: lead first, then the deal
SELECT pg_temp.m('lead-and-deal', '00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000d3', NULL, NULL);
DELETE FROM leads WHERE id = '00000000-0000-0000-0000-0000000000c3';  -- cascades to deal d3 in the same statement
SELECT pg_temp.expect((SELECT count(*) FROM area_measurements WHERE address_text = 'lead-and-deal') = 0, 'lead + cascaded deal deleted together: row gone, no CHECK error');

-- 4. same row, deal deleted first, then the lead
SELECT pg_temp.m('deal-then-lead', '00000000-0000-0000-0000-0000000000c4', '00000000-0000-0000-0000-0000000000d4', NULL, NULL);
DELETE FROM opportunities WHERE id = '00000000-0000-0000-0000-0000000000d4';
SELECT pg_temp.expect((SELECT count(*) FROM area_measurements WHERE address_text = 'deal-then-lead' AND opportunity_id IS NULL AND lead_id IS NOT NULL) = 1, 'row kept on the lead after its deal went');
DELETE FROM leads WHERE id = '00000000-0000-0000-0000-0000000000c4';
SELECT pg_temp.expect((SELECT count(*) FROM area_measurements WHERE address_text = 'deal-then-lead') = 0, 'row gone with the last parent');

-- 5. a deal-only row goes with its deal; a property row of a customer keeps the customer
SELECT pg_temp.m('deal-only', NULL, '00000000-0000-0000-0000-0000000000d5', NULL, NULL);
DELETE FROM opportunities WHERE id = '00000000-0000-0000-0000-0000000000d5';
SELECT pg_temp.expect((SELECT count(*) FROM area_measurements WHERE address_text = 'deal-only') = 0, 'deal-only row removed');
SELECT pg_temp.m('property-and-customer', NULL, NULL, '00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000a4');
DELETE FROM properties WHERE id = '00000000-0000-0000-0000-0000000000a4';
SELECT pg_temp.expect((SELECT count(*) FROM area_measurements WHERE address_text = 'property-and-customer' AND property_id IS NULL) = 1, 'property cleared, customer row kept');

-- 6. a customer that still has measurements cannot be deleted; the history is intact
SELECT pg_temp.fails($q$DELETE FROM customers WHERE id = '00000000-0000-0000-0000-0000000000a3'$q$, 'customer delete with measurements');
SELECT pg_temp.expect((SELECT count(*) FROM area_measurements WHERE address_text = 'property-and-customer') = 1, 'history survived the refused delete');

-- 7. the owner CHECK and the company fences still hold on INSERT
SELECT pg_temp.fails($q$INSERT INTO area_measurements (org_id, shapes) VALUES ('00000000-0000-0000-0000-0000000000a1', '[{"type":"lawn"}]')$q$, 'row with no owner');
SELECT pg_temp.fails($q$INSERT INTO area_measurements (org_id, lead_id, shapes) VALUES ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000cb', '[{"type":"lawn"}]')$q$, 'other company lead');
SELECT pg_temp.fails($q$INSERT INTO area_measurements (org_id, lead_id, shapes) VALUES ('00000000-0000-0000-0000-0000000000a1', gen_random_uuid(), '[{"type":"lawn"}]')$q$, 'lead that does not exist');
SELECT pg_temp.fails($q$INSERT INTO area_measurements (org_id, customer_id, shapes) VALUES ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b3', '[{"type":"lawn"}]')$q$, 'other company customer');

-- 8. deleting a whole company still works (its customers and their measurements go together)
DELETE FROM orgs WHERE id = '00000000-0000-0000-0000-0000000000a1';
SELECT pg_temp.expect((SELECT count(*) FROM area_measurements) = 0, 'company delete cascades');

SELECT 'REPORT: all assertions passed';
