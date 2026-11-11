-- DB test for migration 202611110070 (time clock) on a THROWAWAY Postgres: stubs the tables it touches, applies the
-- migration twice (idempotent), then checks the triggers, the one-open-clock indexes, the lease functions and the
-- typed-vs-clocked columns. Run with supabase/tests/run-time-tracking.sh.
\set ON_ERROR_STOP 1
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE TABLE orgs (id uuid PRIMARY KEY);
CREATE TABLE users (id uuid PRIMARY KEY, org_id uuid REFERENCES orgs(id));
CREATE TABLE sub_contractors (id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES orgs(id));
CREATE TABLE production_jobs (id uuid PRIMARY KEY, org_id uuid NOT NULL);
CREATE TABLE work_orders (id uuid PRIMARY KEY, org_id uuid NOT NULL, job_id uuid);
CREATE TABLE pricebook_items (id uuid PRIMARY KEY, org_id uuid NOT NULL);
CREATE TYPE job_cost_line_source AS ENUM ('manual', 'product_order_mirror', 'legacy_column_import', 'dealer_fee_sync');
CREATE TABLE job_cost_lines (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, job_id uuid NOT NULL, source job_cost_line_source);
CREATE TABLE payroll_periods (id uuid PRIMARY KEY);
CREATE TABLE payroll_rep_hours (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid, payroll_period_id uuid, user_id uuid, regular_hours numeric(7,2) NOT NULL DEFAULT 0, overtime_hours numeric(7,2) NOT NULL DEFAULT 0);

INSERT INTO orgs VALUES ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b');
INSERT INTO users VALUES ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000000b');
INSERT INTO sub_contractors VALUES ('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-00000000000a');
INSERT INTO production_jobs VALUES ('00000000-0000-0000-0000-00000000a0b1', '00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000b0b1', '00000000-0000-0000-0000-00000000000b');
INSERT INTO work_orders VALUES ('00000000-0000-0000-0000-0000000a0001', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000a0b1');

\i supabase/migrations/202611110070_time_tracking.sql
\i supabase/migrations/202611110070_time_tracking.sql

\set ON_ERROR_STOP 0
DO $$
DECLARE ok boolean; n int; v_job uuid;
BEGIN
  -- job filled from the work order
  INSERT INTO time_entries (org_id, user_id, work_order_id, kind, started_at, source)
  VALUES ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000a0001', 'work', now(), 'lead_tap')
  RETURNING production_job_id INTO v_job;
  IF v_job IS DISTINCT FROM '00000000-0000-0000-0000-00000000a0b1' THEN RAISE EXCEPTION 'FAIL job not filled'; END IF;
  -- a second open clock for the same person is refused
  BEGIN
    INSERT INTO time_entries (org_id, user_id, production_job_id, kind, started_at, source)
    VALUES ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a0b1', 'work', now(), 'self_tap');
    RAISE EXCEPTION 'FAIL second open clock allowed';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  -- another company's job / person refused
  BEGIN
    INSERT INTO time_entries (org_id, user_id, production_job_id, kind, started_at, source, ended_at)
    VALUES ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000b0b1', 'work', now() - interval '2 days', 'typed', now() - interval '47 hours');
    RAISE EXCEPTION 'FAIL foreign job allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO time_entries (org_id, user_id, production_job_id, kind, started_at, source, ended_at)
    VALUES ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000a0b1', 'work', now() - interval '2 days', 'typed', now() - interval '47 hours');
    RAISE EXCEPTION 'FAIL foreign person allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  -- end before start refused
  BEGIN
    INSERT INTO time_entries (org_id, user_id, production_job_id, kind, started_at, source, ended_at)
    VALUES ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a0b1', 'break', now(), 'typed', now() - interval '1 hour');
    RAISE EXCEPTION 'FAIL end before start allowed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  -- lease: second holder refused until released
  ok := time_feed_try_lock('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000111', 30);
  IF ok IS NOT TRUE THEN RAISE EXCEPTION 'FAIL first lock'; END IF;
  ok := time_feed_try_lock('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000222', 30);
  IF ok IS TRUE THEN RAISE EXCEPTION 'FAIL second lock while held'; END IF;
  PERFORM time_feed_unlock('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000111');
  ok := time_feed_try_lock('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000222', 30);
  IF ok IS NOT TRUE THEN RAISE EXCEPTION 'FAIL lock after release'; END IF;
  -- typed vs clocked columns
  INSERT INTO payroll_rep_hours (org_id, user_id, hours_source, typed_regular_hours) VALUES ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1', 'clock', 30);
  BEGIN
    INSERT INTO payroll_rep_hours (org_id, user_id, hours_source) VALUES ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1', 'guess');
    RAISE EXCEPTION 'FAIL bad hours_source allowed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  SELECT count(*) INTO n FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'job_cost_line_source' AND e.enumlabel = 'time_entries';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL enum value'; END IF;
  RAISE NOTICE 'REPORT: all assertions passed';
END $$;
