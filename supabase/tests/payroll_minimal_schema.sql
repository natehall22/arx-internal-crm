-- Minimal payroll schema (roles + tables) shared by the payroll DB tests (phase 1, phase 2). Throwaway databases only.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;

CREATE TABLE orgs (id uuid PRIMARY KEY, name text, settings jsonb DEFAULT '{}'::jsonb, timezone text);
CREATE TABLE users (id uuid PRIMARY KEY, org_id uuid REFERENCES orgs(id), full_name text, role text, active boolean DEFAULT true, is_super_admin boolean, is_test_account boolean DEFAULT false);
CREATE TABLE comp_plans (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid, name text);
CREATE TABLE user_comp_plans (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid, user_id uuid, comp_plan_id uuid, effective_from date, effective_to date);
CREATE TABLE payroll_periods (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES orgs(id), period_label text, cutoff_at timestamptz, lock_at timestamptz,
  scheduled_pay_date date, status text NOT NULL DEFAULT 'open', locked_at timestamptz, paid_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  lock_claimed_at timestamptz, lock_claim_token uuid, UNIQUE (org_id, period_label));
CREATE TABLE production_jobs (id uuid PRIMARY KEY, org_id uuid, job_number text, status text, sale_amount numeric, commission_comp_base numeric, payroll_settled_externally_at timestamptz);
CREATE TABLE payroll_period_snapshots (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid, payroll_period_id uuid UNIQUE, locked_at timestamptz, locked_by uuid);
CREATE TABLE payroll_job_snapshots (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid, payroll_period_snapshot_id uuid, payroll_period_id uuid, job_id uuid,
  contract_total numeric, signed_change_orders_total numeric, commissionable_change_orders_total numeric, dealer_fee numeric, deductible_costs_total numeric,
  commission_base numeric, comp_plan_version text, participants jsonb, gross_payout_total numeric, net_payout_total numeric, pay_date date, payload jsonb, UNIQUE (payroll_period_id, job_id));
CREATE TABLE payroll_payout_lines (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid, payroll_period_id uuid REFERENCES payroll_periods(id), payroll_job_snapshot_id uuid,
  job_id uuid, user_id uuid, participant_role text, gross_amount numeric, net_amount numeric, chargeback_applied_amount numeric, comp_plan_snapshot jsonb);
CREATE TABLE job_payroll_state (job_id uuid PRIMARY KEY, org_id uuid, install_completed_at timestamptz, fully_funded_at timestamptz, costs_ready_at timestamptz,
  payroll_eligible_at timestamptz, payroll_cutoff_at timestamptz, scheduled_pay_date date, current_payroll_period_id uuid, updated_at timestamptz);
CREATE TABLE payroll_rep_hours (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid, payroll_period_id uuid REFERENCES payroll_periods(id), user_id uuid,
  regular_hours numeric, overtime_hours numeric, hourly_earnings numeric, UNIQUE (payroll_period_id, user_id));
CREATE TABLE payroll_bonus_lines (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid, payroll_period_id uuid REFERENCES payroll_periods(id), user_id uuid,
  amount numeric, status text, bonus_type text, source_id uuid);
CREATE TABLE payroll_adjustments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid, payroll_period_id uuid REFERENCES payroll_periods(id), user_id uuid, amount numeric,
  reason text, kind text DEFAULT 'fix', status text DEFAULT 'pending', source_period_id uuid, created_by uuid, applied_at timestamptz, job_id uuid);
CREATE UNIQUE INDEX ON payroll_adjustments (source_period_id, user_id) WHERE kind = 'balance' AND status <> 'void';
CREATE TABLE deal_commission_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid, job_id uuid, role text, user_id uuid, override_amount numeric(14,2),
  override_percent numeric(5,2), created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), UNIQUE (job_id, role, user_id));
CREATE TABLE payroll_override_audit (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid, override_type text, job_id uuid, payroll_period_id uuid, actor_user_id uuid,
  reason text NOT NULL, before_value jsonb, after_value jsonb, created_at timestamptz DEFAULT now());
