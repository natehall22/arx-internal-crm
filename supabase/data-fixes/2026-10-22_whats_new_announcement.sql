-- The first "What's new" announcement. Run AFTER migration 202610220040_announcements.sql, at release time:
-- it shows from the moment it is inserted for 14 days, then stops on its own.
-- Copy approved by Nathan before merge (see PR description).

-- PREVIEW (read-only): nothing exists yet.
SELECT count(*) AS existing_announcements FROM announcements WHERE org_id = '9089d4ad-f46c-405b-9798-6751d45a7051';

BEGIN;
INSERT INTO announcements (org_id, slug, title, body, link_url, starts_at, ends_at, active)
SELECT '9089d4ad-f46c-405b-9798-6751d45a7051', 'whats-new-2026-10', 'What''s new',
  jsonb_build_object(
    'owner', jsonb_build_array(
      'Payroll is now one screen. Review ''Needs you'', then press Approve.',
      'Suppliers live in Settings → Suppliers: add ABC''s order email.',
      'Reports: start from a template in Reports.'),
    'ops', jsonb_build_array(
      'Send material orders from the job''s order sheet. Each supplier gets its own PO.',
      '''Needs you'' lists jobs missing info. Fix them there.',
      'Costs: one place now, the Materials tab.'),
    'closer', jsonb_build_array(
      'Confirm setter and closer credit when the contract is signed. It locks after signing.',
      'Your pay shows each job as Coming, This week or Paid.'),
    'setter', jsonb_build_array(
      'Your pay now shows each job and why it''s waiting.',
      'Tap ''Something''s wrong?'' on any line to ask the office.')
  ),
  '/whats-new', now(), now() + interval '14 days', true
WHERE NOT EXISTS (SELECT 1 FROM announcements WHERE org_id = '9089d4ad-f46c-405b-9798-6751d45a7051' AND slug = 'whats-new-2026-10');
COMMIT;

-- Rollback: DELETE FROM announcements WHERE org_id = '9089d4ad-f46c-405b-9798-6751d45a7051' AND slug = 'whats-new-2026-10';  -- dismissals cascade
