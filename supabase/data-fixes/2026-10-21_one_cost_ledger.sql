-- =====================================================================================
-- Data fix 2026-10-21 — ONE job cost ledger (Known Redundancy #11, BUILD-BRIEF item 3)
-- =====================================================================================
-- Makes job_cost_lines the only place a job's costs live. Nothing is dropped:
-- job_product_orders and production_jobs.material_cost / labor_cost stay as read-only history.
--
-- PREREQUISITE: migration 202610220001_job_cost_ledger_source_order.sql (adds the
-- job_cost_lines.source enum column this file writes).
--
-- What it does (state as read from prod 2026-10-21):
--   A. Mirror every job_product_orders row that has no ledger line yet (today: 1 row, 26-0040
--      $5,707.87). 22 of 23 were already mirrored out-of-band; those are NOT duplicated
--      (matched on job_cost_lines.source_product_order_id, which has a unique index).
--   B. Remove the confirmed double count on 26-0011: "QXO" $3,028.16 typed under Photos & files
--      47 seconds before the same QXO order ($3,028.64) was entered on the Materials tab.
--      The ARX Tracker material figure for the job ($3,554.86) fits ONE order, not two ($6,056.80).
--      Archived (soft), not deleted.
--      26-0041 ($5,421.03 in both tables) and 26-0013 ($918 twice) need no row change: 26-0041's
--      two entries are already ONE ledger line linked to the order, and 26-0013's two extra $918
--      lines are already archived. They stop double counting because every reader now reads only
--      live ledger lines.
--   C. Fix two mirrors typed "material" that are not materials (26-0017 "red bull and wine",
--      26-0029 "unrecoverable insurance") → misc. Totals unchanged; it matters for step D.
--   D. Move production_jobs.material_cost / labor_cost (the 2026-07-08 ARX Tracker import, the
--      ONLY cost record for ~25 jobs) into the ledger, but only where the job has no ledger line
--      of that type. Where it has one, the ledger wins (that is what ops sees on the job) and the
--      job is listed under "Needs a look" in the README.
--   E. Turn deduct_from_commission_base off on the 5 live, non-dealer-fee lines that have it on.
--      The flag is not wired into anyone's pay (deductible_costs_total is read by nothing); its
--      only live effect is BLOCKING payroll when the line is unapproved — 26-0041 is blocked today.
--      Every Materials-tab cost has always been false; new lines are born false (lib/job-cost-ledger.ts).
--   F. Backfill job_cost_lines.source for lines whose origin is known (mirrors, dealer-fee lines).
--
-- Rows this file inserts carry the tag below in notes ONLY as a rollback handle; the reportable
-- fact is job_cost_lines.source.
--   Tag: [datafix 2026-10-21 one-cost-ledger]
--
-- Run order: PART 1 (preview) → PART 2 (apply) → deploy app → PART 2b (catch-up, idempotent).
-- PART 3 rolls everything back.
-- =====================================================================================


-- =====================================================================================
-- PART 1 — PREVIEW (read-only). Every row the fix touches, then cost/profit per job.
-- =====================================================================================

-- 1a. Every affected row, with job number and amount.
WITH
jpo AS (
  SELECT o.*, CASE WHEN o.status = 'returned' THEN -abs(o.amount) ELSE o.amount END AS signed_amount
  FROM job_product_orders o
),
live AS (
  SELECT * FROM job_cost_lines WHERE status = 'active' AND deleted_at IS NULL
),
after_live AS (  -- live lines after A–C (used to decide D)
  SELECT job_id,
         CASE WHEN id IN ('c9e8c9cb-02f3-40f9-9679-c3a81357ee14','d1ec1da8-9ab1-4320-bb34-861b9d2e21d4')
              THEN 'misc' ELSE cost_type END AS cost_type
  FROM live
  WHERE id <> 'e04c17e6-3f6d-4d31-8795-1c22efd2a674'
  UNION ALL
  SELECT o.job_id, CASE WHEN o.description ~* '\mlabor\M' THEN 'labor' ELSE 'material' END
  FROM jpo o
  WHERE NOT EXISTS (SELECT 1 FROM job_cost_lines c WHERE c.source_product_order_id = o.id)
)
SELECT * FROM (
  SELECT 'A mirror legacy Materials-tab order' AS action, pj.job_number, o.id AS row_id,
         o.description || COALESCE(' (' || NULLIF(trim(o.supplier), '') || ')', '') AS description,
         NULL::numeric AS amount_before, o.signed_amount AS amount_after, 'new ledger line' AS change
  FROM jpo o JOIN production_jobs pj ON pj.id = o.job_id
  WHERE NOT EXISTS (SELECT 1 FROM job_cost_lines c WHERE c.source_product_order_id = o.id)
  UNION ALL
  SELECT 'B archive duplicate', pj.job_number, c.id, c.description, c.amount, 0, 'status active → archived'
  FROM job_cost_lines c JOIN production_jobs pj ON pj.id = c.job_id
  WHERE c.id = 'e04c17e6-3f6d-4d31-8795-1c22efd2a674' AND c.status = 'active'
  UNION ALL
  SELECT 'C retype', pj.job_number, c.id, c.description, c.amount, c.amount, 'cost_type material → misc'
  FROM job_cost_lines c JOIN production_jobs pj ON pj.id = c.job_id
  WHERE c.id IN ('c9e8c9cb-02f3-40f9-9679-c3a81357ee14','d1ec1da8-9ab1-4320-bb34-861b9d2e21d4')
    AND c.cost_type = 'material'
  UNION ALL
  SELECT 'D import material_cost column', pj.job_number, pj.id, 'Materials (ARX Tracker import)',
         NULL, pj.material_cost, 'new ledger line'
  FROM production_jobs pj
  WHERE COALESCE(pj.material_cost, 0) <> 0
    AND NOT EXISTS (SELECT 1 FROM after_live a WHERE a.job_id = pj.id AND a.cost_type = 'material')
  UNION ALL
  SELECT 'D import labor_cost column', pj.job_number, pj.id, 'Labor (ARX Tracker import)',
         NULL, pj.labor_cost, 'new ledger line'
  FROM production_jobs pj
  WHERE COALESCE(pj.labor_cost, 0) <> 0
    AND NOT EXISTS (SELECT 1 FROM after_live a WHERE a.job_id = pj.id AND a.cost_type IN ('labor','subcontractor'))
  UNION ALL
  SELECT 'E deduct flag off', pj.job_number, c.id, c.description, c.amount, c.amount,
         'deduct_from_commission_base true → false' || CASE WHEN NOT c.approved THEN ' (unblocks payroll)' ELSE '' END
  FROM job_cost_lines c JOIN production_jobs pj ON pj.id = c.job_id
  WHERE c.id IN ('2fff1947-01ff-4f8b-9063-e1d586169829','31775d56-af94-4594-8fd4-46df157e8573',
                 '8b7553fa-5592-4712-8f51-6b15f3d87ddd','ad040358-1a70-449e-97ff-e58c7928fddf',
                 'd0ad9f9c-42f4-44c5-a78a-1f71eeeef4cd')
    AND c.deduct_from_commission_base
  UNION ALL
  SELECT 'F source backfill', pj.job_number, c.id, c.description, c.amount, c.amount,
         'source NULL → ' || CASE WHEN c.source_product_order_id IS NOT NULL THEN 'product_order_mirror' ELSE 'dealer_fee_sync' END
  FROM job_cost_lines c JOIN production_jobs pj ON pj.id = c.job_id
  WHERE c.source IS NULL
    AND (c.source_product_order_id IS NOT NULL OR c.description = 'Lender / dealer fee')
) x
ORDER BY action, job_number;

-- 1b. Direct cost and profit per job, BEFORE (as each screen computed it) vs AFTER (one ledger).
--   job page   = labor_cost column + Materials-tab order total (0 when none) + dealer fee
--   ops board  = labor_cost + material_cost columns + dealer fee
--   tracker    = material_cost col + labor_cost col + misc live lines (incl. dealer-fee lines);
--                tracker gross profit = sale − cost − 6% sales − 9% OPP
--   AFTER      = live ledger lines (excl. dealer-fee line) + dealer fee, on every screen
-- Only jobs where a number changes are listed.
WITH
jpo AS (
  SELECT job_id, SUM(CASE WHEN status = 'returned' THEN -abs(amount) ELSE amount END) AS total
  FROM job_product_orders GROUP BY job_id
),
live AS (
  SELECT * FROM job_cost_lines WHERE status = 'active' AND deleted_at IS NULL
),
sim AS (  -- the ledger after A–D
  SELECT job_id, amount,
         CASE WHEN id IN ('c9e8c9cb-02f3-40f9-9679-c3a81357ee14','d1ec1da8-9ab1-4320-bb34-861b9d2e21d4')
              THEN 'misc' ELSE cost_type END AS cost_type,
         description
  FROM live WHERE id <> 'e04c17e6-3f6d-4d31-8795-1c22efd2a674'
  UNION ALL
  SELECT o.job_id, CASE WHEN o.status = 'returned' THEN -abs(o.amount) ELSE o.amount END,
         CASE WHEN o.description ~* '\mlabor\M' THEN 'labor' ELSE 'material' END, o.description
  FROM job_product_orders o
  WHERE NOT EXISTS (SELECT 1 FROM job_cost_lines c WHERE c.source_product_order_id = o.id)
),
sim_full AS (
  SELECT * FROM sim
  UNION ALL
  SELECT pj.id, pj.material_cost, 'material', 'import'
  FROM production_jobs pj
  WHERE COALESCE(pj.material_cost, 0) <> 0
    AND NOT EXISTS (SELECT 1 FROM sim s WHERE s.job_id = pj.id AND s.cost_type = 'material')
  UNION ALL
  SELECT pj.id, pj.labor_cost, 'labor', 'import'
  FROM production_jobs pj
  WHERE COALESCE(pj.labor_cost, 0) <> 0
    AND NOT EXISTS (SELECT 1 FROM sim s WHERE s.job_id = pj.id AND s.cost_type IN ('labor','subcontractor'))
),
per_job AS (
  SELECT pj.id, pj.job_number, pj.status,
         COALESCE(pj.sale_amount, 0) AS sale,
         COALESCE(pj.dealer_fee_amount, 0) AS dealer,
         COALESCE(pj.labor_cost, 0) + COALESCE(j.total, 0) + COALESCE(pj.dealer_fee_amount, 0) AS cost_job_page,
         COALESCE(pj.labor_cost, 0) + COALESCE(pj.material_cost, 0) + COALESCE(pj.dealer_fee_amount, 0) AS cost_ops_board,
         COALESCE(pj.material_cost, j.total,
                  (SELECT SUM(amount) FROM live l WHERE l.job_id = pj.id AND l.cost_type = 'material'), 0)
         + COALESCE(pj.labor_cost,
                  (SELECT SUM(amount) FROM live l WHERE l.job_id = pj.id AND l.cost_type IN ('labor','subcontractor')), 0)
         + COALESCE((SELECT SUM(amount) FROM live l WHERE l.job_id = pj.id
                     AND l.cost_type NOT IN ('material','labor','subcontractor')), 0) AS cost_tracker,
         COALESCE((SELECT SUM(amount) FROM sim_full s WHERE s.job_id = pj.id
                   AND s.description IS DISTINCT FROM 'Lender / dealer fee'), 0)
         + COALESCE(pj.dealer_fee_amount, 0) AS cost_after
  FROM production_jobs pj LEFT JOIN jpo j ON j.job_id = pj.id
)
SELECT job_number, status, sale,
       round(cost_job_page, 2)  AS cost_before_job_page,
       round(cost_ops_board, 2) AS cost_before_ops_board,
       round(cost_tracker, 2)   AS cost_before_tracker,
       round(cost_after, 2)     AS cost_after_all_screens,
       round(sale - cost_job_page, 2)  AS profit_before_job_page,
       round(sale - cost_ops_board, 2) AS profit_before_ops_board,
       round(sale - cost_after, 2)     AS profit_after,
       round(sale - cost_tracker - 0.06 * GREATEST(0, sale - dealer) - 0.09 * sale, 2) AS tracker_gp_before,
       round(sale - cost_after   - 0.06 * GREATEST(0, sale - dealer) - 0.09 * sale, 2) AS tracker_gp_after
FROM per_job
WHERE round(cost_job_page, 2) <> round(cost_after, 2)
   OR round(cost_ops_board, 2) <> round(cost_after, 2)
   OR round(cost_tracker, 2) <> round(cost_after, 2)
ORDER BY job_number;


-- =====================================================================================
-- PART 2 — APPLY (one transaction; any guard failure rolls the whole thing back)
-- =====================================================================================
BEGIN;

-- A. Mirror legacy Materials-tab orders not yet in the ledger (idempotent).
INSERT INTO job_cost_lines (
  org_id, job_id, description, amount, cost_type, status, notes,
  created_by, created_at, updated_at, incurred_on, approved, approved_at,
  deduct_from_commission_base, source_product_order_id, source
)
SELECT o.org_id, o.job_id,
       o.description || COALESCE(' (' || NULLIF(trim(o.supplier), '') || ')', ''),
       CASE WHEN o.status = 'returned' THEN -abs(o.amount) ELSE o.amount END,
       CASE WHEN o.description ~* '\mlabor\M' THEN 'labor' ELSE 'material' END,
       'active',
       'Mirrored from legacy Materials-tab order (' || o.status || '); original entry '
         || to_char(o.created_at, 'YYYY-MM-DD') || '. [datafix 2026-10-21 one-cost-ledger]',
       o.created_by, o.created_at, o.created_at, o.created_at::date, true, now(),
       false, o.id, 'product_order_mirror'
FROM job_product_orders o
WHERE NOT EXISTS (SELECT 1 FROM job_cost_lines c WHERE c.source_product_order_id = o.id);

-- B. Archive the confirmed 26-0011 duplicate.
DO $$
DECLARE n int;
BEGIN
  UPDATE job_cost_lines
     SET status = 'archived', deleted_at = now()
   WHERE id = 'e04c17e6-3f6d-4d31-8795-1c22efd2a674'
     AND status = 'active' AND deleted_at IS NULL AND amount = 3028.16;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'B: expected 1 live 26-0011 "QXO" $3,028.16 line, found %. Re-run the preview.', n; END IF;
END $$;

-- C. Retype two non-material mirrors.
DO $$
DECLARE n int;
BEGIN
  UPDATE job_cost_lines SET cost_type = 'misc'
   WHERE id IN ('c9e8c9cb-02f3-40f9-9679-c3a81357ee14','d1ec1da8-9ab1-4320-bb34-861b9d2e21d4')
     AND cost_type = 'material';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 2 THEN RAISE EXCEPTION 'C: expected 2 lines to retype, found %. Re-run the preview.', n; END IF;
END $$;

-- D. Move the legacy cost columns into the ledger where the job has no line of that type (idempotent).
INSERT INTO job_cost_lines (
  org_id, job_id, description, amount, cost_type, status, notes,
  approved, approved_at, deduct_from_commission_base, source, created_at, updated_at
)
SELECT pj.org_id, pj.id, 'Materials (ARX Tracker import)', pj.material_cost, 'material', 'active',
       'Moved from production_jobs.material_cost (2026-07-08 ARX Tracker import). [datafix 2026-10-21 one-cost-ledger]',
       true, now(), false, 'legacy_column_import', timestamptz '2026-07-08', timestamptz '2026-07-08'
FROM production_jobs pj
WHERE COALESCE(pj.material_cost, 0) <> 0
  AND NOT EXISTS (SELECT 1 FROM job_cost_lines c
                  WHERE c.job_id = pj.id AND c.status = 'active' AND c.deleted_at IS NULL
                    AND c.cost_type = 'material');

INSERT INTO job_cost_lines (
  org_id, job_id, description, amount, cost_type, status, notes,
  approved, approved_at, deduct_from_commission_base, source, created_at, updated_at
)
SELECT pj.org_id, pj.id, 'Labor (ARX Tracker import)', pj.labor_cost, 'labor', 'active',
       'Moved from production_jobs.labor_cost (2026-07-08 ARX Tracker import). [datafix 2026-10-21 one-cost-ledger]',
       true, now(), false, 'legacy_column_import', timestamptz '2026-07-08', timestamptz '2026-07-08'
FROM production_jobs pj
WHERE COALESCE(pj.labor_cost, 0) <> 0
  AND NOT EXISTS (SELECT 1 FROM job_cost_lines c
                  WHERE c.job_id = pj.id AND c.status = 'active' AND c.deleted_at IS NULL
                    AND c.cost_type IN ('labor','subcontractor'));

-- E. Deduct flag off on the 5 live non-dealer-fee lines that have it on.
DO $$
DECLARE n int;
BEGIN
  UPDATE job_cost_lines SET deduct_from_commission_base = false
   WHERE id IN ('2fff1947-01ff-4f8b-9063-e1d586169829','31775d56-af94-4594-8fd4-46df157e8573',
                '8b7553fa-5592-4712-8f51-6b15f3d87ddd','ad040358-1a70-449e-97ff-e58c7928fddf',
                'd0ad9f9c-42f4-44c5-a78a-1f71eeeef4cd')
     AND deduct_from_commission_base;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 5 THEN RAISE EXCEPTION 'E: expected 5 lines with the deduct flag on, found %. Re-run the preview.', n; END IF;
END $$;

-- F. Record known origins.
UPDATE job_cost_lines SET source = 'product_order_mirror'
 WHERE source IS NULL AND source_product_order_id IS NOT NULL;
UPDATE job_cost_lines SET source = 'dealer_fee_sync'
 WHERE source IS NULL AND description = 'Lender / dealer fee';

-- Verify: every legacy order has exactly one ledger line; no live unapproved deductible line remains.
DO $$
DECLARE unmirrored int; blockers int;
BEGIN
  SELECT count(*) INTO unmirrored FROM job_product_orders o
   WHERE NOT EXISTS (SELECT 1 FROM job_cost_lines c WHERE c.source_product_order_id = o.id);
  SELECT count(*) INTO blockers FROM job_cost_lines
   WHERE status = 'active' AND deleted_at IS NULL AND NOT approved AND deduct_from_commission_base;
  IF unmirrored <> 0 THEN RAISE EXCEPTION 'verify: % legacy orders still unmirrored', unmirrored; END IF;
  IF blockers <> 0 THEN RAISE EXCEPTION 'verify: % unapproved deductible lines still block payroll', blockers; END IF;
END $$;

COMMIT;


-- =====================================================================================
-- PART 2b — CATCH-UP after the app deploy (idempotent; safe to run any number of times)
-- Picks up any Materials-tab order entered on the OLD code between PART 2 and the deploy.
-- =====================================================================================
BEGIN;
INSERT INTO job_cost_lines (
  org_id, job_id, description, amount, cost_type, status, notes,
  created_by, created_at, updated_at, incurred_on, approved, approved_at,
  deduct_from_commission_base, source_product_order_id, source
)
SELECT o.org_id, o.job_id,
       o.description || COALESCE(' (' || NULLIF(trim(o.supplier), '') || ')', ''),
       CASE WHEN o.status = 'returned' THEN -abs(o.amount) ELSE o.amount END,
       CASE WHEN o.description ~* '\mlabor\M' THEN 'labor' ELSE 'material' END,
       'active',
       'Mirrored from legacy Materials-tab order (' || o.status || '); original entry '
         || to_char(o.created_at, 'YYYY-MM-DD') || '. [datafix 2026-10-21 one-cost-ledger]',
       o.created_by, o.created_at, o.created_at, o.created_at::date, true, now(),
       false, o.id, 'product_order_mirror'
FROM job_product_orders o
WHERE NOT EXISTS (SELECT 1 FROM job_cost_lines c WHERE c.source_product_order_id = o.id);
COMMIT;


-- Rollback is commented out so running this whole file can never apply and then undo the fix.
-- To roll back, copy PART 3 into its own run and remove the leading '-- ' from each line.
-- =====================================================================================
-- PART 3 — ROLLBACK (one transaction). Restores the exact pre-fix state of every row above.
-- Lines people add through the new app after the fix are not touched.
-- =====================================================================================
-- BEGIN;

-- Refuse if receipts were attached to rows this fix inserted (deleting them would cascade).
-- DO $$
-- DECLARE n int;
-- BEGIN
--   SELECT count(*) INTO n FROM cost_attachments a
--     JOIN job_cost_lines c ON c.id = a.job_cost_line_id
--    WHERE c.notes LIKE '%[datafix 2026-10-21 one-cost-ledger]%';
--   IF n > 0 THEN RAISE EXCEPTION 'rollback: % attachments sit on lines this fix inserted; move them first', n; END IF;
-- END $$;

-- A + D: remove inserted lines.
-- DELETE FROM job_cost_lines WHERE notes LIKE '%[datafix 2026-10-21 one-cost-ledger]%';

-- B: un-archive the 26-0011 line.
-- UPDATE job_cost_lines SET status = 'active', deleted_at = NULL, deleted_by = NULL
--  WHERE id = 'e04c17e6-3f6d-4d31-8795-1c22efd2a674';

-- C: restore cost_type.
-- UPDATE job_cost_lines SET cost_type = 'material'
--  WHERE id IN ('c9e8c9cb-02f3-40f9-9679-c3a81357ee14','d1ec1da8-9ab1-4320-bb34-861b9d2e21d4');

-- E: restore the deduct flag.
-- UPDATE job_cost_lines SET deduct_from_commission_base = true
--  WHERE id IN ('2fff1947-01ff-4f8b-9063-e1d586169829','31775d56-af94-4594-8fd4-46df157e8573',
--               '8b7553fa-5592-4712-8f51-6b15f3d87ddd','ad040358-1a70-449e-97ff-e58c7928fddf',
--               'd0ad9f9c-42f4-44c5-a78a-1f71eeeef4cd');

-- F: clear backfilled origins (no app code writes these two values).
-- UPDATE job_cost_lines SET source = NULL
--  WHERE source IN ('product_order_mirror', 'dealer_fee_sync');

-- COMMIT;
