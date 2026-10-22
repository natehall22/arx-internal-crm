-- ════════════════════════════════════════════════════════════════════════════════
-- Data fix 2026-10-22 — money inputs (commission base, sale amount, super admins)
-- Branch fix/money-inputs. Run AFTER migration 202610210010_money_inputs_super_admin_paid_override.sql.
-- CRM payroll has never paid real money, so correcting these rows is safe.
--
-- Rule (Nathan, 2026-10-22): commission base = signed contract total + signed change orders,
-- EXCLUDING sales tax, MINUS the dealer fee. Sale amount stays the tax-included signed total.
-- lib/job-commission-base.ts writes both going forward; this file fixes history.
--   new_base = GREATEST(0, sale_amount − proposals.tax_amount − production_jobs.dealer_fee_amount)
-- (non-commissionable change orders: none exist in prod as of 2026-10-22.)
--
-- Run order: PART A (preview, read-only; run on its own) → PART B (fix, one transaction) → PART C (verify).
-- PART D is the rollback. Backups go to payroll_backup.money_inputs_20261022 (private; no API access).
-- ════════════════════════════════════════════════════════════════════════════════

-- ── PART A: PREVIEW (read-only) ─────────────────────────────────────────────────
-- One row per job whose sale amount or base will change. 26-0013's stored sale added a $450 change
-- order twice (signed docs 17,081.46 + 450.00 and payments 17,531.46 agree).
WITH tgt AS (
  SELECT j.id, j.job_number, j.status, j.sale_amount AS old_sale, j.commission_comp_base AS old_base,
         CASE WHEN j.job_number = '26-0013' AND j.sale_amount = 17981.46 THEN 17531.46 ELSE j.sale_amount END AS new_sale,
         COALESCE(p.tax_amount, 0) AS sales_tax, COALESCE(j.dealer_fee_amount, 0) AS dealer_fee
  FROM production_jobs j
  LEFT JOIN proposals p ON p.id = COALESCE(j.linked_proposal_id, j.accepted_proposal_id) AND p.org_id = j.org_id
  WHERE j.status <> 'cancelled' AND COALESCE(j.sale_amount, 0) > 0
)
SELECT job_number, old_sale, new_sale, sales_tax, dealer_fee, old_base,
       GREATEST(0, new_sale - sales_tax - dealer_fee) AS new_base,
       GREATEST(0, new_sale - sales_tax - dealer_fee) - COALESCE(old_base, 0) AS base_change
FROM tgt
WHERE old_sale IS DISTINCT FROM new_sale
   OR old_base IS DISTINCT FROM GREATEST(0, new_sale - sales_tax - dealer_fee)
ORDER BY job_number;

-- Also flagged, NOT changed: 26-0040 — signed contract on file is 9,457.84 but sale and payments are
-- 14,457.84 (split deal; second contract deleted by the pre-2026-09-26 signing bug). The code never
-- recomputes that job unless a CO chain agrees; its base here is derived from the stored sale amount.

-- ── PART B: FIX (one transaction) ────────────────────────────────────────────────
BEGIN;

CREATE SCHEMA IF NOT EXISTS payroll_backup;
REVOKE ALL ON SCHEMA payroll_backup FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE 'REVOKE ALL ON SCHEMA payroll_backup FROM anon'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN EXECUTE 'REVOKE ALL ON SCHEMA payroll_backup FROM authenticated'; END IF;
END $$;

-- Plain CREATE: a second run fails here instead of overwriting the first backup.
CREATE TABLE payroll_backup.money_inputs_20261022 AS
  SELECT id, org_id, job_number, sale_amount, commission_comp_base, commission_pre_tax_subtotal, updated_at
  FROM production_jobs;
ALTER TABLE payroll_backup.money_inputs_20261022 ENABLE ROW LEVEL SECURITY;

UPDATE production_jobs j
SET sale_amount = 17531.46, updated_at = NOW()
WHERE j.job_number = '26-0013' AND j.sale_amount = 17981.46;

UPDATE production_jobs j
SET commission_comp_base = GREATEST(0, j.sale_amount - COALESCE((
        SELECT p.tax_amount FROM proposals p
        WHERE p.id = COALESCE(j.linked_proposal_id, j.accepted_proposal_id) AND p.org_id = j.org_id), 0)
      - COALESCE(j.dealer_fee_amount, 0)),
    commission_pre_tax_subtotal = NULL,
    updated_at = NOW()
WHERE j.status <> 'cancelled' AND COALESCE(j.sale_amount, 0) > 0
  AND (j.commission_comp_base IS DISTINCT FROM GREATEST(0, j.sale_amount - COALESCE((
        SELECT p.tax_amount FROM proposals p
        WHERE p.id = COALESCE(j.linked_proposal_id, j.accepted_proposal_id) AND p.org_id = j.org_id), 0)
      - COALESCE(j.dealer_fee_amount, 0))
       OR j.commission_pre_tax_subtotal IS NOT NULL);

-- Retire commission_pre_tax_subtotal on every remaining row (the writer clears it from now on).
UPDATE production_jobs SET commission_pre_tax_subtotal = NULL WHERE commission_pre_tax_subtotal IS NOT NULL;

COMMIT;

-- ── PART C: VERIFY ───────────────────────────────────────────────────────────────
SELECT j.job_number, j.sale_amount, j.commission_comp_base, j.commission_pre_tax_subtotal
FROM production_jobs j
WHERE j.status <> 'cancelled' AND COALESCE(j.sale_amount, 0) > 0
  AND (j.commission_comp_base IS NULL OR j.commission_pre_tax_subtotal IS NOT NULL);
-- Expect 0 rows.

-- ── PART D: ROLLBACK (only if needed) ────────────────────────────────────────────
-- BEGIN;
-- UPDATE production_jobs j
-- SET sale_amount = b.sale_amount, commission_comp_base = b.commission_comp_base,
--     commission_pre_tax_subtotal = b.commission_pre_tax_subtotal, updated_at = NOW()
-- FROM payroll_backup.money_inputs_20261022 b WHERE b.id = j.id;
-- COMMIT;

-- ── PART E: SUPER ADMINS (owners) ────────────────────────────────────────────────
-- Nathan Hall, Andrew Waltz, Steve (Stevo Potts) — emails confirmed against users 2026-10-22.
-- Preview (read-only): SELECT id, full_name, email, role, is_super_admin FROM users
--   WHERE role = 'admin' AND lower(email) IN ('nathan@arxroofing.com','andrew@waltz.construction','stpotts2@gmail.com');
BEGIN;
UPDATE users SET is_super_admin = TRUE
WHERE role = 'admin' AND active IS TRUE
  AND lower(email) IN ('nathan@arxroofing.com', 'andrew@waltz.construction', 'stpotts2@gmail.com');
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM users WHERE is_super_admin;
  IF n <> 3 THEN RAISE EXCEPTION 'expected exactly 3 super admins, found %', n; END IF;
END $$;
COMMIT;
-- Rollback: UPDATE users SET is_super_admin = FALSE WHERE lower(email) IN (same list);
