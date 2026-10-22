-- Correction (Nathan, 2026-10-22): the dealer (lender) fee is NOT deducted from the commission base.
-- Commission and OPP are on the full sale amount. Base = signed contract + signed change orders, minus SALES TAX only.
-- (The earlier fix 2026-10-22_money_inputs.sql also took the dealer fee off; this puts it back.)
--   new_base = GREATEST(0, sale_amount − proposals.tax_amount)
-- Backup: payroll_backup.commission_base_no_fee_20261022 (private). Rollback restores from it.

-- PREVIEW (read-only): every job whose base changes.
SELECT j.job_number, j.sale_amount, COALESCE(p.tax_amount, 0) AS sales_tax, COALESCE(j.dealer_fee_amount, 0) AS dealer_fee,
       j.commission_comp_base AS base_now,
       GREATEST(0, j.sale_amount - COALESCE(p.tax_amount, 0)) AS base_new,
       GREATEST(0, j.sale_amount - COALESCE(p.tax_amount, 0)) - COALESCE(j.commission_comp_base, 0) AS change
FROM production_jobs j
LEFT JOIN proposals p ON p.id = COALESCE(j.linked_proposal_id, j.accepted_proposal_id) AND p.org_id = j.org_id
WHERE j.status <> 'cancelled' AND COALESCE(j.sale_amount, 0) > 0
  AND j.commission_comp_base IS DISTINCT FROM GREATEST(0, j.sale_amount - COALESCE(p.tax_amount, 0))
ORDER BY j.job_number;

-- FIX
BEGIN;
CREATE TABLE payroll_backup.commission_base_no_fee_20261022 AS
  SELECT id, org_id, job_number, sale_amount, commission_comp_base, updated_at FROM production_jobs;
ALTER TABLE payroll_backup.commission_base_no_fee_20261022 ENABLE ROW LEVEL SECURITY;

UPDATE production_jobs j
SET commission_comp_base = GREATEST(0, j.sale_amount - COALESCE((
        SELECT p.tax_amount FROM proposals p
        WHERE p.id = COALESCE(j.linked_proposal_id, j.accepted_proposal_id) AND p.org_id = j.org_id), 0)),
    updated_at = NOW()
WHERE j.status <> 'cancelled' AND COALESCE(j.sale_amount, 0) > 0
  AND j.commission_comp_base IS DISTINCT FROM GREATEST(0, j.sale_amount - COALESCE((
        SELECT p.tax_amount FROM proposals p
        WHERE p.id = COALESCE(j.linked_proposal_id, j.accepted_proposal_id) AND p.org_id = j.org_id), 0));
COMMIT;

-- VERIFY: no job's base is below sale − tax because of a dealer fee (expect 0 rows)
SELECT j.job_number FROM production_jobs j
LEFT JOIN proposals p ON p.id = COALESCE(j.linked_proposal_id, j.accepted_proposal_id) AND p.org_id = j.org_id
WHERE j.status <> 'cancelled' AND COALESCE(j.sale_amount, 0) > 0
  AND j.commission_comp_base IS DISTINCT FROM GREATEST(0, j.sale_amount - COALESCE(p.tax_amount, 0));

-- Rollback: UPDATE production_jobs j SET commission_comp_base = b.commission_comp_base, updated_at = NOW()
--           FROM payroll_backup.commission_base_no_fee_20261022 b WHERE b.id = j.id;
