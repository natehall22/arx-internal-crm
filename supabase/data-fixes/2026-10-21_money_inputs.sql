-- ════════════════════════════════════════════════════════════════════════════════
-- Data fix 2026-10-21 — money inputs (commission base, sale amount, super admins)
-- Branch fix/money-inputs. Run AFTER migration 202610210010_money_inputs_super_admin_paid_override.sql.
-- CRM payroll has never paid real money (brief item 7), so correcting these rows is safe.
--
-- Rule (Nathan, 2026-10-21): commission base = sale amount = signed contract total + signed
-- change orders. lib/job-commission-base.ts writes it going forward; this file fixes history.
--
-- Run order: PART A (preview, read-only) → PART B (fix, one transaction) → PART C (verify).
-- PART D is the rollback. PART E (super admins) needs Nathan to fill in emails first.
-- Every UPDATE is guarded on the row's CURRENT values, so a row someone has since changed is
-- left alone (the verify step will show it).
-- ════════════════════════════════════════════════════════════════════════════════

-- Target values. new_* = what the job should hold. old_* = what it held on 2026-10-21 (guard + rollback).
-- why: signed_docs  = contract total + signed CO deltas found and agree with the stored sale amount
--      sale_fixed   = sale_amount itself was wrong; signed docs + payments both say otherwise
--      fee_removed  = base had the dealer fee taken off (old rule); new rule is base = sale amount
--      legacy_kept  = signed contract on file is incomplete or missing (deleted by the pre-2026-09-26
--                     signing bug, or pre-CRM job); payments match the stored sale amount, so it is
--                     kept and base = sale amount. Listed for a human look, not changed in amount.
CREATE TEMP TABLE money_inputs_fix (
  job_number TEXT PRIMARY KEY,
  old_sale NUMERIC(12,2), new_sale NUMERIC(12,2),
  old_base NUMERIC(12,2), new_base NUMERIC(12,2),
  why TEXT
) ON COMMIT PRESERVE ROWS;

INSERT INTO money_inputs_fix VALUES
  -- 14 jobs with NO commission base
  ('26-0002', 25932.00, 25932.00, NULL, 25932.00, 'legacy_kept'),   -- no signed contract in CRM at all
  ('26-0008', 17020.47, 17020.47, NULL, 17020.47, 'signed_docs'),   -- 15,625.27 + CO 1,395.20
  ('26-0009',  3099.56,  3099.56, NULL,  3099.56, 'signed_docs'),
  ('26-0010', 15501.00, 15501.00, NULL, 15501.00, 'legacy_kept'),   -- only 7,939.12 contract left (split deal); paid 15,501.00
  ('26-0011', 11280.00, 11280.00, NULL, 11280.00, 'signed_docs'),   -- 9,684.12 + 3 COs
  ('26-0012', 11409.17, 11409.17, NULL, 11409.17, 'signed_docs'),
  ('26-0013', 17981.46, 17531.46, NULL, 17531.46, 'sale_fixed'),    -- 17,081.46 + CO 450.00; paid 17,531.46. Stored sale had the CO added twice
  ('26-0016', 24225.11, 24225.11, NULL, 24225.11, 'signed_docs'),
  ('26-0017', 12523.79, 12523.79, NULL, 12523.79, 'signed_docs'),
  ('26-0018', 12421.63, 12421.63, NULL, 12421.63, 'signed_docs'),
  ('26-0019',  2239.76,  2239.76, NULL,  2239.76, 'signed_docs'),
  ('26-0021',   250.00,   250.00, NULL,   250.00, 'signed_docs'),   -- repair agreement
  ('26-0024',  1100.00,  1100.00, NULL,  1100.00, 'legacy_kept'),   -- contract says 1,099.00; paid 1,100.00
  ('26-0032', 18865.00, 18865.00, NULL, 18865.00, 'signed_docs'),
  -- 7 jobs whose base differed from the sale amount — all = sale minus dealer fee (old rule)
  ('26-0014', 18959.39, 18959.39, 18202.91, 18959.39, 'fee_removed'), -- fee 756.48
  ('26-0015', 25894.28, 25894.28, 24537.42, 25894.28, 'fee_removed'), -- fee 1,356.86
  ('26-0020', 12998.56, 12998.56, 12317.44, 12998.56, 'fee_removed'), -- fee 681.12
  ('26-0027',  7442.54,  7442.54,  7145.58,  7442.54, 'fee_removed'), -- fee 296.96
  ('26-0031', 11574.64, 11574.64, 10968.13, 11574.64, 'fee_removed'), -- fee 606.51
  ('26-0033',  6622.79,  6622.79,  5630.03,  6622.79, 'fee_removed'), -- fee 992.76
  ('26-0037', 34957.69, 34957.69, 34008.62, 34957.69, 'fee_removed'); -- fee 949.07; 23,786.11 + 2 COs

-- ── PART A: PREVIEW (read-only) ─────────────────────────────────────────────────
SELECT f.job_number, f.why,
       j.sale_amount            AS sale_now,   f.new_sale AS sale_after,
       j.commission_comp_base   AS base_now,   f.new_base AS base_after,
       j.commission_pre_tax_subtotal AS pretax_now,
       (j.sale_amount IS NOT DISTINCT FROM f.old_sale
        AND j.commission_comp_base IS NOT DISTINCT FROM f.old_base) AS will_update
FROM money_inputs_fix f
JOIN production_jobs j ON j.job_number = f.job_number
ORDER BY f.job_number;

-- Also flagged, NOT changed (base already = sale amount): 26-0040 — signed contract on file is
-- 9,457.84 but sale, base and payments are 14,457.84 (split deal; second contract deleted by the
-- old signing bug). Recomputing from documents would drop $5,000, so the code refuses to (it only
-- recomputes when a contract or CO is signed, and a CO chain that disagrees is never written).

-- ── PART B: FIX (one transaction) ────────────────────────────────────────────────
BEGIN;

-- Exactly one org today; refuse to run blind if that changes.
DO $$
BEGIN
  IF (SELECT COUNT(DISTINCT org_id) FROM production_jobs WHERE job_number IN (SELECT job_number FROM money_inputs_fix)) <> 1 THEN
    RAISE EXCEPTION 'job numbers span more than one org — scope this fix by org_id first';
  END IF;
END $$;

UPDATE production_jobs j
SET sale_amount = f.new_sale,
    commission_comp_base = f.new_base,
    updated_at = NOW()
FROM money_inputs_fix f
WHERE j.job_number = f.job_number
  AND j.sale_amount IS NOT DISTINCT FROM f.old_sale
  AND j.commission_comp_base IS NOT DISTINCT FROM f.old_base;

-- Retire commission_pre_tax_subtotal everywhere (the writer clears it from now on).
-- Old values are kept in money_inputs_pretax_backup for the rollback.
CREATE TEMP TABLE money_inputs_pretax_backup ON COMMIT PRESERVE ROWS AS
  SELECT id, org_id, job_number, commission_pre_tax_subtotal
  FROM production_jobs WHERE commission_pre_tax_subtotal IS NOT NULL;
UPDATE production_jobs SET commission_pre_tax_subtotal = NULL
WHERE commission_pre_tax_subtotal IS NOT NULL;

COMMIT;
-- NOTE: the temp backup lives only in this session. If you want the rollback later, first run:
--   SELECT job_number, commission_pre_tax_subtotal FROM money_inputs_pretax_backup;
-- and save the output (as of 2026-10-21 it equals sale_amount on every row that had one, except
-- the 7 fee rows where it also equals sale_amount — i.e. it can be restored from sale_amount).

-- ── PART C: VERIFY ───────────────────────────────────────────────────────────────
SELECT j.job_number, j.sale_amount, j.commission_comp_base, j.commission_pre_tax_subtotal
FROM production_jobs j
WHERE j.status <> 'cancelled'
  AND (j.commission_comp_base IS NULL OR j.commission_comp_base <> j.sale_amount OR j.commission_pre_tax_subtotal IS NOT NULL);
-- Expect 0 rows.

-- ── PART D: ROLLBACK (only if needed) ────────────────────────────────────────────
-- BEGIN;
-- UPDATE production_jobs j
-- SET sale_amount = f.old_sale, commission_comp_base = f.old_base, updated_at = NOW()
-- FROM money_inputs_fix f
-- WHERE j.job_number = f.job_number
--   AND j.sale_amount IS NOT DISTINCT FROM f.new_sale
--   AND j.commission_comp_base IS NOT DISTINCT FROM f.new_base;
-- -- pre-tax: every non-null value on 2026-10-21 equalled the job's (pre-fix) sale_amount.
-- UPDATE production_jobs j SET commission_pre_tax_subtotal = b.commission_pre_tax_subtotal
-- FROM money_inputs_pretax_backup b WHERE b.id = j.id;   -- same session, or rebuild from saved output
-- COMMIT;

-- ── PART E: SUPER ADMINS (owners) — NATHAN FILLS IN THE EMAILS ───────────────────
-- Super admin = every ARX owner. Six users share role 'admin'; we can't tell which are owners
-- from the data, so nobody is guessed. Put the owners' login emails in the list, then run.
-- Preview first:
-- SELECT id, full_name, email, role, is_super_admin FROM users
-- WHERE role = 'admin' AND lower(email) IN (lower('OWNER_EMAIL_1'), lower('OWNER_EMAIL_2'), lower('OWNER_EMAIL_3'));
--
-- BEGIN;
-- UPDATE users SET is_super_admin = TRUE
-- WHERE role = 'admin'
--   AND active IS TRUE
--   AND lower(email) IN (lower('OWNER_EMAIL_1'), lower('OWNER_EMAIL_2'), lower('OWNER_EMAIL_3'));
-- -- Expect exactly one row per email listed. If not, ROLLBACK.
-- COMMIT;
--
-- Rollback: UPDATE users SET is_super_admin = FALSE WHERE lower(email) IN (... same list ...);
