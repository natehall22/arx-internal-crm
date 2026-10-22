-- Seed ARX's suppliers (vendors is empty in prod as of 2026-10-22).
--   ABC Supply  — active, NO order email yet (add it in Settings → Suppliers), default supplier for roofing, sent by email
--   QXO         — inactive (kept for later), no email
-- Run AFTER migrations 202610210060 (supplier columns) and 202610220020 (supplier_audit_log).

-- PREVIEW (read-only): what exists now (expect 0 rows) and what will be created.
SELECT 'existing' AS kind, name, active FROM vendors WHERE org_id = '9089d4ad-f46c-405b-9798-6751d45a7051' AND deleted_at IS NULL
UNION ALL SELECT 'will create', 'ABC Supply', true
UNION ALL SELECT 'will create', 'QXO', false;

BEGIN;
WITH ins AS (
  INSERT INTO vendors (org_id, name, active, order_email, order_cc_emails, default_for_trades, connection_type)
  SELECT o.id, v.name, v.active, NULL, '{}', v.trades, 'email'
  FROM orgs o
  CROSS JOIN (VALUES ('ABC Supply', true, ARRAY['roofing']::text[]), ('QXO', false, ARRAY[]::text[])) AS v(name, active, trades)
  WHERE o.id = '9089d4ad-f46c-405b-9798-6751d45a7051'
    AND NOT EXISTS (SELECT 1 FROM vendors x WHERE x.org_id = o.id AND lower(x.name) = lower(v.name) AND x.deleted_at IS NULL)
  RETURNING id, org_id, name
)
INSERT INTO supplier_audit_log (org_id, vendor_id, action, changed_by, changes)
SELECT org_id, id, 'created', NULL,
       jsonb_build_array(jsonb_build_object('field', 'name', 'label', 'Name', 'old', NULL, 'new', name), jsonb_build_object('field', 'note', 'label', 'Note', 'old', NULL, 'new', 'Seeded 2026-10-22 (data fix)'))
FROM ins;
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM vendors WHERE org_id = '9089d4ad-f46c-405b-9798-6751d45a7051' AND name IN ('ABC Supply', 'QXO');
  IF n <> 2 THEN RAISE EXCEPTION 'expected ABC Supply and QXO, found %', n; END IF;
END $$;
COMMIT;

-- Rollback: DELETE FROM vendors WHERE org_id = '9089d4ad-f46c-405b-9798-6751d45a7051' AND name IN ('ABC Supply','QXO')
--           AND NOT EXISTS (SELECT 1 FROM supplier_orders s WHERE s.vendor_id = vendors.id);   -- audit rows cascade
