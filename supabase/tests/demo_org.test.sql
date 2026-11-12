-- DB test for 202611180010_demo_org (orgs.is_demo, its guard trigger, demo_reset_org). Throwaway local Postgres only
-- (see run-demo-org.sh): builds a minimal schema with two companies and proves the reset can never touch the other one.
\set ON_ERROR_STOP 1
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
END $$;
DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;
GRANT USAGE ON SCHEMA public TO authenticated, service_role;
CREATE TABLE orgs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, settings jsonb NOT NULL DEFAULT '{}'::jsonb);
CREATE TABLE users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid REFERENCES orgs(id));
CREATE TABLE customers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES orgs(id), name text);
-- A foreign-key chain whose PARENT sorts first (accounts < zebra_items): pass 1 cannot delete accounts, pass 2 can.
CREATE TABLE accounts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES orgs(id));
CREATE TABLE zebra_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES orgs(id), account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT);
-- A table that is not uuid-org keyed (never touched) and one with a non-uuid org_id column.
CREATE TABLE no_org (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), note text);
GRANT SELECT, UPDATE, INSERT ON orgs TO authenticated;

\i supabase/migrations/202611180010_demo_org.sql

DO $t$
DECLARE
  demo uuid := '00000000-0000-0000-0000-0000000000d0';
  real uuid := '00000000-0000-0000-0000-0000000000a1';
  flagless uuid := '00000000-0000-0000-0000-0000000000b2';
  acc uuid; r jsonb; failed boolean; code text;
BEGIN
  INSERT INTO orgs (id, name, settings) VALUES (demo, 'Demo Co', '{"features":{"x":true}}');
  UPDATE orgs SET is_demo = true WHERE id = demo;                    -- session role is the owner: allowed (no JWT claim)
  INSERT INTO orgs (id, name, settings) VALUES (real, 'Real Co', '{"keep":"me"}'), (flagless, 'Other Co', '{}');
  ASSERT (SELECT is_demo FROM orgs WHERE id = real) = false, 'T0 default is not a demo';
  INSERT INTO users (org_id) VALUES (demo), (demo), (real);
  INSERT INTO customers (org_id, name) VALUES (demo, 'd1'), (demo, 'd2'), (real, 'r1'), (real, 'r2'), (flagless, 'f1');
  INSERT INTO accounts (org_id) VALUES (demo) RETURNING id INTO acc;
  INSERT INTO zebra_items (org_id, account_id) VALUES (demo, acc);
  INSERT INTO accounts (org_id) VALUES (real) RETURNING id INTO acc;
  INSERT INTO zebra_items (org_id, account_id) VALUES (real, acc);
  INSERT INTO no_org (note) VALUES ('untouched');

  -- T1 the reset empties the demo company (incl. the FK chain, over several passes) and nothing else
  r := demo_reset_org(demo);
  ASSERT r->'blocked' = '{}'::jsonb, 'T1 nothing blocked: ' || r::text;
  ASSERT (r->>'passes')::int >= 2, 'T1 the foreign-key chain needed another pass';
  ASSERT (SELECT count(*) FROM customers WHERE org_id = demo) = 0 AND (SELECT count(*) FROM users WHERE org_id = demo) = 0
     AND (SELECT count(*) FROM accounts WHERE org_id = demo) = 0 AND (SELECT count(*) FROM zebra_items WHERE org_id = demo) = 0, 'T1 demo rows gone';
  ASSERT (SELECT count(*) FROM customers WHERE org_id = real) = 2 AND (SELECT count(*) FROM users WHERE org_id = real) = 1
     AND (SELECT count(*) FROM accounts WHERE org_id = real) = 1 AND (SELECT count(*) FROM zebra_items WHERE org_id = real) = 1, 'T1 the real company is untouched';
  ASSERT (SELECT count(*) FROM customers WHERE org_id = flagless) = 1, 'T1 the other company is untouched';
  ASSERT (SELECT count(*) FROM no_org) = 1, 'T1 tables without an org are untouched';
  ASSERT (SELECT count(*) FROM orgs) = 3, 'T1 org rows stay';
  ASSERT (SELECT settings FROM orgs WHERE id = demo) = '{}'::jsonb, 'T1 demo settings cleared';
  ASSERT (SELECT settings FROM orgs WHERE id = real) = '{"keep":"me"}'::jsonb, 'T1 real settings kept';
  ASSERT (SELECT is_demo FROM orgs WHERE id = demo), 'T1 the demo flag stays';

  -- T2 a company without the flag is refused (and nothing changes); so is an unknown id and NULL
  FOREACH code IN ARRAY ARRAY['real', 'flagless', 'unknown', 'null'] LOOP
    failed := false;
    BEGIN
      PERFORM demo_reset_org(CASE code WHEN 'real' THEN real WHEN 'flagless' THEN flagless WHEN 'unknown' THEN gen_random_uuid() ELSE NULL END);
    EXCEPTION WHEN insufficient_privilege THEN failed := true; END;
    ASSERT failed, 'T2 refused: ' || code;
  END LOOP;
  ASSERT (SELECT count(*) FROM customers WHERE org_id = real) = 2 AND (SELECT settings FROM orgs WHERE id = real) = '{"keep":"me"}'::jsonb, 'T2 nothing deleted';

  -- T3 the flag cannot be flipped by a browser role (neither real -> demo, which would make it wipeable, nor demo -> real)
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;
  failed := false;
  BEGIN UPDATE orgs SET is_demo = true WHERE id = real; EXCEPTION WHEN insufficient_privilege THEN failed := true; END;
  ASSERT failed, 'T3 authenticated cannot make a real company a demo';
  failed := false;
  BEGIN UPDATE orgs SET is_demo = false WHERE id = demo; EXCEPTION WHEN insufficient_privilege THEN failed := true; END;
  ASSERT failed, 'T3 authenticated cannot un-demo';
  failed := false;
  BEGIN INSERT INTO orgs (name, is_demo) VALUES ('Sneaky', true); EXCEPTION WHEN insufficient_privilege THEN failed := true; END;
  ASSERT failed, 'T3 authenticated cannot insert a demo company';
  failed := false;
  BEGIN PERFORM demo_reset_org(demo); EXCEPTION WHEN insufficient_privilege THEN failed := true; END;
  ASSERT failed, 'T3 authenticated cannot call the reset at all (EXECUTE revoked)';
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.role', '', true);
  ASSERT (SELECT is_demo FROM orgs WHERE id = demo) AND NOT (SELECT is_demo FROM orgs WHERE id = real), 'T3 flags unchanged';

  -- T4 the service role (what the seed script uses) may set the flag and call the reset
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  UPDATE orgs SET is_demo = true WHERE id = flagless;
  INSERT INTO customers (org_id, name) VALUES (flagless, 'again');
  r := demo_reset_org(flagless);
  ASSERT (SELECT count(*) FROM customers WHERE org_id = flagless) = 0, 'T4 service role wipes a flagged company';
  ASSERT (SELECT count(*) FROM customers WHERE org_id = real) = 2, 'T4 and still not the real one';
  PERFORM set_config('request.jwt.claim.role', '', true);

  -- T5 a table that refuses the delete (append-only) is reported as blocked, others still emptied
  CREATE TABLE audit_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES orgs(id));
  CREATE FUNCTION audit_no_delete() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'append-only'; END $f$;
  CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_no_delete();
  INSERT INTO audit_log (org_id) VALUES (demo), (real);
  INSERT INTO customers (org_id, name) VALUES (demo, 'x');
  r := demo_reset_org(demo);
  ASSERT r->'blocked' ? 'audit_log', 'T5 blocked table reported: ' || r::text;
  ASSERT (SELECT count(*) FROM customers WHERE org_id = demo) = 0, 'T5 other tables still emptied';
  ASSERT (SELECT count(*) FROM audit_log WHERE org_id = real) = 1, 'T5 the real company audit row untouched';

  RAISE EXCEPTION 'REPORT (rolled back by design): all assertions passed';
END $t$;
