-- Self-contained DB test for 202611240070_partner_owner_org_timezone. THROWAWAY local Postgres only (run-partner-owner-zone.sh).
-- Minimal copies of the tables write_partner_owner_role reads; referral_partner_owner_as_of is stubbed to record the instant it is
-- asked about. Asserts: the sale day ends at local midnight in the job's company zone, on both 2026 clock-change days; a New York
-- company (and one with no / an invalid zone) gets exactly the instant the old hard-coded body produced.
\set ON_ERROR_STOP 1
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
END $$;
DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;
CREATE TABLE orgs (id uuid PRIMARY KEY, timezone text);
CREATE TABLE users (id uuid PRIMARY KEY, org_id uuid, role text);
CREATE TABLE referral_partners (id uuid PRIMARY KEY, name text);
CREATE TABLE leads (id uuid PRIMARY KEY, closer_user_id uuid);
CREATE TABLE opportunities (id uuid PRIMARY KEY, referral_partner_id uuid, setter_user_id uuid, owner_user_id uuid, assigned_user_id uuid, lead_id uuid);
CREATE TABLE projects (id uuid PRIMARY KEY, opportunity_id uuid);
CREATE TABLE production_jobs (id uuid PRIMARY KEY, org_id uuid, sale_date date, salesperson_id uuid, project_id uuid, job_number text);
CREATE TABLE deal_commission_roles (org_id uuid, job_id uuid, role text, user_id uuid, override_amount numeric, override_percent numeric, UNIQUE (job_id, role, user_id));
CREATE TABLE notifications (org_id uuid, recipient_user_id uuid, type text, title text, body text, link_url text);
CREATE TABLE owner_calls (job_id uuid, at timestamptz);
CREATE FUNCTION referral_partner_owner_as_of(p_partner uuid, p_at timestamptz) RETURNS uuid LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO owner_calls (at) VALUES (p_at);
  RETURN '00000000-0000-0000-0000-0000000000aa'::uuid;
END $$;

\i supabase/migrations/202611240070_partner_owner_org_timezone.sql
-- Idempotent.
\i supabase/migrations/202611240070_partner_owner_org_timezone.sql

INSERT INTO orgs VALUES
  ('00000000-0000-0000-0000-000000000001', 'America/New_York'),
  ('00000000-0000-0000-0000-000000000002', 'America/Chicago'),
  ('00000000-0000-0000-0000-000000000003', NULL),
  ('00000000-0000-0000-0000-000000000004', 'Not/AZone'),
  ('00000000-0000-0000-0000-000000000005', '  ');
INSERT INTO referral_partners VALUES ('00000000-0000-0000-0000-0000000000b1', 'Partner');
INSERT INTO opportunities (id, referral_partner_id) VALUES ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1');
INSERT INTO projects VALUES ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1');

CREATE FUNCTION snap(p_org text, p_sale date) RETURNS timestamptz LANGUAGE plpgsql AS $$
DECLARE v_job uuid := gen_random_uuid(); v_at timestamptz; v_res text;
BEGIN
  DELETE FROM owner_calls;
  INSERT INTO production_jobs VALUES (v_job, ('00000000-0000-0000-0000-00000000000' || p_org)::uuid, p_sale, NULL, '00000000-0000-0000-0000-0000000000d1', 'J');
  v_res := write_partner_owner_role(v_job);
  IF v_res <> 'written' THEN RAISE EXCEPTION 'expected written, got %', v_res; END IF;
  SELECT at INTO v_at FROM owner_calls;
  RETURN v_at;
END $$;

CREATE FUNCTION old_at(p_sale date) RETURNS timestamptz LANGUAGE sql AS $$
  SELECT LEAST(((COALESCE(p_sale, CURRENT_DATE) + 1)::TIMESTAMP AT TIME ZONE 'America/New_York'), NOW())
$$;

DO $$
DECLARE d date;
BEGIN
  -- Spring forward (2026-03-08) and fall back (2026-11-01) plus the days around them.
  FOREACH d IN ARRAY ARRAY['2026-03-07','2026-03-08','2026-03-09','2026-10-31','2026-11-01','2026-11-02']::date[] LOOP
    -- New York, no zone, a blank zone and an invalid zone: byte-for-byte the old instant.
    IF snap('1', d) <> old_at(d) THEN RAISE EXCEPTION 'NY changed on %', d; END IF;
    IF snap('3', d) <> old_at(d) THEN RAISE EXCEPTION 'null zone changed on %', d; END IF;
    IF snap('4', d) <> old_at(d) THEN RAISE EXCEPTION 'invalid zone changed on %', d; END IF;
    IF snap('5', d) <> old_at(d) THEN RAISE EXCEPTION 'blank zone changed on %', d; END IF;
  END LOOP;
  -- New York: the sale day ends at local midnight.
  IF snap('1', '2026-03-08') <> '2026-03-09T04:00:00Z'::timestamptz THEN RAISE EXCEPTION 'NY Mar 8'; END IF;
  IF snap('1', '2026-03-07') <> '2026-03-08T05:00:00Z'::timestamptz THEN RAISE EXCEPTION 'NY Mar 7'; END IF;
  IF snap('1', '2026-11-01') <> '2026-11-02T05:00:00Z'::timestamptz THEN RAISE EXCEPTION 'NY Nov 1'; END IF;
  IF snap('1', '2026-10-31') <> '2026-11-01T04:00:00Z'::timestamptz THEN RAISE EXCEPTION 'NY Oct 31'; END IF;
  -- Chicago: an hour later than New York, on its own clock-change days too.
  IF snap('2', '2026-03-08') <> '2026-03-09T05:00:00Z'::timestamptz THEN RAISE EXCEPTION 'Chicago Mar 8'; END IF;
  IF snap('2', '2026-03-07') <> '2026-03-08T06:00:00Z'::timestamptz THEN RAISE EXCEPTION 'Chicago Mar 7'; END IF;
  IF snap('2', '2026-11-01') <> '2026-11-02T06:00:00Z'::timestamptz THEN RAISE EXCEPTION 'Chicago Nov 1'; END IF;
  IF snap('2', '2026-10-31') <> '2026-11-01T05:00:00Z'::timestamptz THEN RAISE EXCEPTION 'Chicago Oct 31'; END IF;
  -- A sale day still running is capped at now.
  IF snap('2', (now() AT TIME ZONE 'America/Chicago')::date) > now() THEN RAISE EXCEPTION 'not capped at now'; END IF;
  -- Never callable by app roles.
  IF has_function_privilege('authenticated', 'write_partner_owner_role(uuid)', 'EXECUTE') THEN RAISE EXCEPTION 'authenticated can execute'; END IF;
  IF has_function_privilege('anon', 'write_partner_owner_role(uuid)', 'EXECUTE') THEN RAISE EXCEPTION 'anon can execute'; END IF;
  RAISE NOTICE 'REPORT: all assertions passed';
END $$;
