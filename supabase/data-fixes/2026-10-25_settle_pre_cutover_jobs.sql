-- Cutover: every job that was completed/collected with a sale date before 2026-10-23 was paid outside the CRM (or, for the
-- ones with a CRM snapshot, through the August CRM runs). Mark them so the CRM never pays them again and Needs you stops
-- flagging them. Run AFTER migration 202610250030. NOT applied until Nathan approves the preview.

-- PREVIEW (read-only): what will be marked.
SELECT j.job_number, j.status, j.sale_date,
       CASE WHEN EXISTS (SELECT 1 FROM payroll_job_snapshots s WHERE s.job_id = j.id)
            THEN 'settled before cutover (paid through the CRM)'
            ELSE 'paid outside CRM before cutover' END AS reason
FROM production_jobs j
WHERE j.status IN ('complete', 'collected')
  AND j.sale_date < DATE '2026-10-23'
  AND j.payroll_settled_externally_at IS NULL
ORDER BY j.job_number;

BEGIN;
UPDATE production_jobs j
   SET payroll_settled_externally_at = NOW(),
       settled_externally_reason = CASE WHEN EXISTS (SELECT 1 FROM payroll_job_snapshots s WHERE s.job_id = j.id)
                                        THEN 'settled before cutover (paid through the CRM)'
                                        ELSE 'paid outside CRM before cutover' END
 WHERE j.status IN ('complete', 'collected')
   AND j.sale_date < DATE '2026-10-23'
   AND j.payroll_settled_externally_at IS NULL;
COMMIT;

-- Rollback: UPDATE production_jobs SET payroll_settled_externally_at = NULL, settled_externally_reason = NULL
--           WHERE settled_externally_reason IN ('paid outside CRM before cutover', 'settled before cutover (paid through the CRM)');
