-- Minimal schema + migration 202611230020, then assertions. Run by run-lead-routing.sh (drops schema public).
DROP SCHEMA public CASCADE; CREATE SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE TABLE orgs (id uuid PRIMARY KEY, settings jsonb);
CREATE TABLE users (id uuid PRIMARY KEY, org_id uuid, active boolean DEFAULT true);
CREATE TABLE leads (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE lead_sources (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid, recipient_user_id uuid, type text, data jsonb);
\i supabase/migrations/202611230020_lead_intake.sql
-- idempotent re-run:
\i supabase/migrations/202611230020_lead_intake.sql

INSERT INTO orgs VALUES ('11111111-1111-4111-8111-111111111111', '{}'), ('22222222-2222-4222-8222-222222222222', '{}');
INSERT INTO users VALUES
 ('00000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111',true),
 ('00000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111',true),
 ('00000000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111',false),
 ('00000000-0000-4000-8000-000000000004','22222222-2222-4222-8222-222222222222',true);

BEGIN;
DO $$
DECLARE o uuid := '11111111-1111-4111-8111-111111111111'; a uuid := '00000000-0000-4000-8000-000000000001'; b uuid := '00000000-0000-4000-8000-000000000002';
  c uuid := '00000000-0000-4000-8000-000000000003'; d uuid := '00000000-0000-4000-8000-000000000004'; got uuid[] := '{}'; i int;
BEGIN
  FOR i IN 1..4 LOOP got := got || lead_routing_next(o, 'org:rotate', ARRAY[a, c, d, b]); END LOOP;
  IF got <> ARRAY[a, b, a, b] THEN RAISE EXCEPTION 'turns wrong (inactive/foreign must be skipped): %', got; END IF;
  IF lead_routing_next(o, 'x', ARRAY[c, d]) IS NOT NULL THEN RAISE EXCEPTION 'nobody eligible must be NULL'; END IF;
  IF EXISTS (SELECT 1 FROM lead_routing_pointers WHERE scope = 'x') THEN RAISE EXCEPTION 'pointer must be left alone when nobody is eligible'; END IF;
  -- scopes are independent
  IF lead_routing_next(o, 'other', ARRAY[b, a]) <> b THEN RAISE EXCEPTION 'new scope starts at the first person'; END IF;
  -- list changed: continue after the last person, else start over
  IF lead_routing_next(o, 'org:rotate', ARRAY[b, a]) <> a THEN RAISE EXCEPTION 'last=b, list [b,a] -> next is a'; END IF;
  -- last person handed a lead went inactive: continue from the NEXT person in list order, not the first
  INSERT INTO lead_routing_pointers (org_id, scope, last_user_id) VALUES (o, 'l2', c);
  IF lead_routing_next(o, 'l2', ARRAY[a, c, b]) <> b THEN RAISE EXCEPTION 'last inactive (c) in [a,c,b] -> next is b, not a'; END IF;
  -- ... and when they were removed from the list altogether, start at the first
  INSERT INTO lead_routing_pointers (org_id, scope, last_user_id) VALUES (o, 'l2b', c);
  IF lead_routing_next(o, 'l2b', ARRAY[b, a]) <> b THEN RAISE EXCEPTION 'last gone from the list -> first'; END IF;
  -- one "lead waiting" bell per lead AND owner
  INSERT INTO notifications (org_id, recipient_user_id, type, data) VALUES (o, a, 'lead_waiting', '{"lead_id":"L1"}');
  BEGIN
    INSERT INTO notifications (org_id, recipient_user_id, type, data) VALUES (o, a, 'lead_waiting', '{"lead_id":"L1"}');
    RAISE EXCEPTION 'second lead_waiting for one lead and owner must fail';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  INSERT INTO notifications (org_id, recipient_user_id, type, data) VALUES (o, b, 'lead_waiting', '{"lead_id":"L1"}');  -- a new owner may be reminded once
  INSERT INTO notifications (org_id, recipient_user_id, type, data) VALUES (o, a, 'new_lead', '{"lead_id":"L1"}'), (o, a, 'new_lead', '{"lead_id":"L1"}');  -- other types unaffected
  RAISE NOTICE 'sequential assertions passed';
END $$;
COMMIT;
