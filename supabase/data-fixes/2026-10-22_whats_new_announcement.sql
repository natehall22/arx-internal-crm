-- The first "What's new" announcement. Run AFTER migration 202610220040_announcements.sql, at release time:
-- it shows from the moment it is inserted for 14 days, then stops on its own.
-- Copy approved by Nathan 2026-10-22: live-only features. No setter line (nothing live for setters yet).

-- PREVIEW (read-only): nothing exists yet.
SELECT count(*) AS existing_announcements FROM announcements WHERE org_id = '9089d4ad-f46c-405b-9798-6751d45a7051';

BEGIN;
INSERT INTO announcements (org_id, slug, title, body, link_url, starts_at, ends_at, active)
SELECT '9089d4ad-f46c-405b-9798-6751d45a7051', 'whats-new-2026-10', 'What''s new',
  jsonb_build_object(
    'owner', jsonb_build_array(
      'Suppliers now live in Settings → Suppliers. Add ABC''s order email there.',
      'Reports: start from a template, then save or schedule it.',
      'Payroll no longer lets the same job be paid to the same rep twice.'),
    'ops', jsonb_build_array(
      'Send material orders to suppliers from the job''s order sheet. Each supplier gets its own PO, with a preview before you send.',
      '''Needs you'' on the Ops dashboard lists jobs missing info. Fix them there.',
      'Job costs now live in one place, so each cost is counted once.'),
    'closer', jsonb_build_array(
      'Confirm setter and closer credit when the contract is signed. It locks after signing.',
      'Commission is on the full sale amount minus sales tax. Dealer fees are not taken out.')
  ),
  '/whats-new', now(), now() + interval '14 days', true
WHERE NOT EXISTS (SELECT 1 FROM announcements WHERE org_id = '9089d4ad-f46c-405b-9798-6751d45a7051' AND slug = 'whats-new-2026-10');
COMMIT;

-- Rollback: DELETE FROM announcements WHERE org_id = '9089d4ad-f46c-405b-9798-6751d45a7051' AND slug = 'whats-new-2026-10';  -- dismissals cascade
