-- Self-contained DB test for the portal sharing-column guard (202611150010). THROWAWAY local Postgres only (run-portal-roofing-guard.sh).
\set ON_ERROR_STOP 1
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
END $$;
DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;
CREATE TABLE customers (id uuid PRIMARY KEY, name text);
CREATE TABLE production_jobs (id uuid PRIMARY KEY, status text);
CREATE TABLE photos (id uuid PRIMARY KEY, job_id uuid, shared_with_customer boolean NOT NULL DEFAULT false);
CREATE TABLE documents (id uuid PRIMARY KEY, shared_with_customer boolean NOT NULL DEFAULT false);
-- The migration's ADD COLUMNs + guard (the file also has begin/commit, harmless here).
\i supabase/migrations/202611150010_portal_roofing.sql
INSERT INTO customers (id) VALUES ('00000000-0000-0000-0000-000000000001');
INSERT INTO production_jobs (id) VALUES ('00000000-0000-0000-0000-000000000002');
INSERT INTO photos (id, job_id) VALUES ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000002');
INSERT INTO documents (id) VALUES ('00000000-0000-0000-0000-000000000004');

CREATE OR REPLACE FUNCTION pg_temp.refused(sql text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE sql; RETURN false; EXCEPTION WHEN insufficient_privilege THEN RETURN true; END $$;

DO $$
DECLARE r boolean;
BEGIN
  -- A signed-in member (authenticated token): every one of the four changes is refused.
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated"}', false);
  IF NOT pg_temp.refused($q$UPDATE customers SET portal_invited_at = now()$q$) THEN RAISE EXCEPTION 'member invited a customer'; END IF;
  IF NOT pg_temp.refused($q$UPDATE photos SET shared_with_customer = true$q$) THEN RAISE EXCEPTION 'member shared a photo'; END IF;
  IF NOT pg_temp.refused($q$UPDATE production_jobs SET portal_show_crew_photos = true$q$) THEN RAISE EXCEPTION 'member shared crew photos'; END IF;
  IF NOT pg_temp.refused($q$UPDATE documents SET shared_with_customer = true$q$) THEN RAISE EXCEPTION 'member shared a document'; END IF;
  IF NOT pg_temp.refused($q$INSERT INTO photos (id, job_id, shared_with_customer) VALUES (gen_random_uuid(), gen_random_uuid(), true)$q$) THEN RAISE EXCEPTION 'member inserted a shared photo'; END IF;
  -- Other edits on the same rows still work, and an insert in the default state works.
  UPDATE customers SET name = 'ok';
  UPDATE photos SET shared_with_customer = false;
  INSERT INTO photos (id, job_id) VALUES (gen_random_uuid(), gen_random_uuid());
  -- The server (service role) may.
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', false);
  UPDATE customers SET portal_invited_at = now();
  UPDATE photos SET shared_with_customer = true;
  UPDATE production_jobs SET portal_show_crew_photos = true;
  UPDATE documents SET shared_with_customer = true;
  -- A direct database session (no token) may too.
  PERFORM set_config('request.jwt.claims', '', false);
  UPDATE photos SET shared_with_customer = false;
END $$;
SELECT 'REPORT: all assertions passed';
