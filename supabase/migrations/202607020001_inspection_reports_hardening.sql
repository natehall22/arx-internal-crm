-- Bug-review hardening for inspection reports (additive only).
-- 1) One report per opportunity is the product model — enforce it so a select-then-insert
--    race on two devices can't mint duplicates (table is empty; index is safe to add).
CREATE UNIQUE INDEX IF NOT EXISTS idx_inspection_reports_opportunity_unique
  ON inspection_reports(opportunity_id);

-- 2) Snapshot of how many photos the stored PDF actually contains, taken at finalize time,
--    so the public share page can't drift from the PDF after later edits.
ALTER TABLE inspection_reports ADD COLUMN IF NOT EXISTS pdf_photo_count INTEGER;

-- 3) Concurrency token for the report document itself. updated_at doubles as the retention
--    cron's activity signal (photo uploads, PDF finalize, send all bump it), so it can't also
--    be the optimistic-lock base — a device would 409 against its own photo uploads.
ALTER TABLE inspection_reports ADD COLUMN IF NOT EXISTS doc_updated_at TIMESTAMPTZ;
UPDATE inspection_reports SET doc_updated_at = updated_at WHERE doc_updated_at IS NULL;
