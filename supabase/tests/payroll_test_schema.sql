-- Shared minimal mirror of the prod payroll shape for the payroll DB tests.
-- DESTRUCTIVE (drops schema public): only ever \ir'd by a test file that has already
-- checked current_database() LIKE 'payroll_guard_test_%'.

-- Supabase API roles (cluster-wide; created once on a local test cluster).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;

DROP SCHEMA IF EXISTS payroll_backup CASCADE;
DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Keys, FKs and cascades that matter. payroll_periods has prod's exact 10 columns.
CREATE TABLE payroll_periods (
  id uuid PRIMARY KEY, org_id uuid NOT NULL, period_label text,
  cutoff_at timestamptz, lock_at timestamptz, scheduled_pay_date date,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','locked','paid','cancelled')),
  locked_at timestamptz, paid_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE production_jobs (id uuid PRIMARY KEY, org_id uuid NOT NULL, job_number text);
CREATE TABLE payroll_job_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL,
  payroll_period_id uuid NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,
  job_id uuid NOT NULL, net_payout_total numeric, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payroll_period_id, job_id));
CREATE TABLE payroll_payout_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL,
  payroll_period_id uuid NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,
  payroll_job_snapshot_id uuid NOT NULL REFERENCES payroll_job_snapshots(id) ON DELETE CASCADE,
  job_id uuid NOT NULL, user_id uuid NOT NULL, participant_role text NOT NULL,
  gross_amount numeric NOT NULL DEFAULT 0, net_amount numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX idx_payroll_payout_lines_period_job_user_role
  ON payroll_payout_lines(payroll_period_id, job_id, user_id, participant_role);
CREATE TABLE payroll_chargeback_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), chargeback_id uuid NOT NULL,
  payroll_period_id uuid NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,
  payout_line_id uuid NOT NULL REFERENCES payroll_payout_lines(id) ON DELETE CASCADE,
  applied_amount numeric NOT NULL DEFAULT 0);
CREATE TABLE job_payroll_state (
  job_id uuid PRIMARY KEY, org_id uuid NOT NULL,
  current_payroll_period_id uuid REFERENCES payroll_periods(id) ON DELETE SET NULL,
  payroll_cutoff_at timestamptz, scheduled_pay_date date, payroll_eligible_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE payroll_override_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, override_type text NOT NULL,
  job_id uuid, payroll_period_id uuid REFERENCES payroll_periods(id) ON DELETE SET NULL,
  actor_user_id uuid NOT NULL, reason text NOT NULL, before_value jsonb, after_value jsonb,
  created_at timestamptz NOT NULL DEFAULT now());

-- Prod grants: Supabase gives anon/authenticated table-level privileges on public tables.
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
