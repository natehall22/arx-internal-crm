-- Money inputs (2026-10-21): super admin flag, "paid in full" override audit, reporting view.
-- Additive only. Do not apply by hand outside the normal migration flow.
-- Data corrections for existing rows live in supabase/data-fixes/2026-10-21_money_inputs.sql.

-- ── 1. Super admin (= an ARX owner) ─────────────────────────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS super_admin_granted_at TIMESTAMPTZ;

COMMENT ON COLUMN users.is_super_admin IS
  'Owner flag. Only super admins may force a job paid in full with a balance or change sale credit after signing. See lib/super-admin.ts.';
COMMENT ON COLUMN users.super_admin_granted_at IS
  'When is_super_admin last became true (null when false). Set by trigger.';

-- Admins/managers can UPDATE users rows through RLS ("Admins can update users"), so without
-- this guard any manager could make themselves a super admin with a direct API call. Only the
-- service role (server code) or a direct database session (migrations / data-fixes) may change it.
CREATE OR REPLACE FUNCTION guard_users_is_super_admin()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_role TEXT := COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''),
                          (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'),
                          '');
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF COALESCE(NEW.is_super_admin, FALSE) AND v_role NOT IN ('service_role', '') THEN
      RAISE EXCEPTION 'is_super_admin can only be set by the server' USING ERRCODE = '42501';
    END IF;
    NEW.super_admin_granted_at := CASE WHEN COALESCE(NEW.is_super_admin, FALSE) THEN NOW() ELSE NULL END;
    RETURN NEW;
  END IF;

  IF NEW.is_super_admin IS DISTINCT FROM OLD.is_super_admin THEN
    IF v_role NOT IN ('service_role', '') THEN
      RAISE EXCEPTION 'is_super_admin can only be changed by the server' USING ERRCODE = '42501';
    END IF;
    NEW.super_admin_granted_at := CASE WHEN COALESCE(NEW.is_super_admin, FALSE) THEN NOW() ELSE NULL END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_users_is_super_admin ON users;
CREATE TRIGGER trg_guard_users_is_super_admin
  BEFORE INSERT OR UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION guard_users_is_super_admin();

-- ── 2. Who/when forced a job "paid in full" (reason stays in close_balance_reason) ──
ALTER TABLE production_jobs
  ADD COLUMN IF NOT EXISTS close_balance_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS close_balance_at TIMESTAMPTZ;

COMMENT ON COLUMN production_jobs.close_balance_by IS
  'Super admin who forced this job paid in full despite a balance over $0.05. Null = not forced (a legacy allow_close_with_balance without this does not count).';
COMMENT ON COLUMN production_jobs.close_balance_at IS
  'When the paid-in-full override was set.';
COMMENT ON COLUMN production_jobs.commission_comp_base IS
  'Commission base = signed contract total + signed commissionable change orders, minus sales tax and dealer fee (dollars). One writer: lib/job-commission-base.ts.';
COMMENT ON COLUMN production_jobs.commission_pre_tax_subtotal IS
  'RETIRED 2026-10-21. Cleared by lib/job-commission-base.ts; the base is no longer a pre-tax proposal figure.';

-- ── 3. Audit types for the two new owner overrides ─────────────────────────────
ALTER TABLE payroll_override_audit DROP CONSTRAINT IF EXISTS payroll_override_audit_override_type_check;
ALTER TABLE payroll_override_audit ADD CONSTRAINT payroll_override_audit_override_type_check
  CHECK (override_type IN (
    'include_after_cutoff',
    'off_cycle_payout',
    'waive_missing_cost',
    'manual_adjustment',
    'push_chargeback_next_period',
    'override_pay_date',
    'force_paid_in_full',
    'sale_credit_change'
  ));

CREATE INDEX IF NOT EXISTS idx_payroll_override_audit_job_type
  ON payroll_override_audit (job_id, override_type, created_at DESC);

-- ── 4. Reporting: collection status per job, same rule as lib/job-collection.ts ─────
-- Money in cents (USD). Pending payments do not count. Tolerance 5 cents.
CREATE OR REPLACE VIEW job_collection_status
WITH (security_invoker = true) AS
SELECT
  j.org_id,
  j.id AS job_id,
  j.job_number,
  'USD'::text AS currency,
  ROUND(COALESCE(j.sale_amount, 0) * 100)::bigint AS sale_amount_cents,
  ROUND(COALESCE(j.commission_comp_base, 0) * 100)::bigint AS commission_base_cents,
  COALESCE(p.collected_cents, 0)::bigint AS collected_cents,
  (ROUND(COALESCE(j.sale_amount, 0) * 100) - COALESCE(p.collected_cents, 0))::bigint AS remaining_cents,
  CASE
    WHEN COALESCE(j.sale_amount, 0) <= 0 THEN 'no_sale_amount'
    WHEN ROUND(j.sale_amount * 100) - COALESCE(p.collected_cents, 0) <= 5 THEN 'paid_in_full'
    WHEN j.allow_close_with_balance IS TRUE AND j.close_balance_by IS NOT NULL THEN 'forced_paid_in_full'
    WHEN COALESCE(p.collected_cents, 0) > 0 THEN 'partially_paid'
    ELSE 'unpaid'
  END AS collection_status,
  j.close_balance_by AS forced_paid_by,
  j.close_balance_at AS forced_paid_at,
  p.last_payment_at
FROM production_jobs j
LEFT JOIN (
  SELECT job_id,
         SUM(amount_cents) FILTER (WHERE funding_status IS DISTINCT FROM 'pending') AS collected_cents,
         MAX(created_at) AS last_payment_at
  FROM job_payments
  GROUP BY job_id
) p ON p.job_id = j.id;

COMMENT ON VIEW job_collection_status IS
  'One row per job: sale amount, payments and the paid-in-full answer (lib/job-collection.ts). Cents, USD.';

SELECT pg_notify('pgrst', 'reload schema');
