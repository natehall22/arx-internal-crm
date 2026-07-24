-- Additive: seed Website Instant Estimate lead source for ARX org.
-- Runtime also upserts this row on first unlock if missing.
-- Live schema does NOT have notify_on_new_lead / notification_emails.
-- Safe to re-run: ON CONFLICT (org_id, name) DO NOTHING.

INSERT INTO lead_sources (
  org_id,
  name,
  source_type,
  webhook_enabled,
  is_active,
  auto_assign_user_id
)
SELECT
  '9089d4ad-f46c-405b-9798-6751d45a7051',
  'Website Instant Estimate',
  'website',
  true,
  true,
  (
    SELECT auto_assign_user_id
    FROM lead_sources
    WHERE org_id = '9089d4ad-f46c-405b-9798-6751d45a7051'
      AND name = 'Website Contact Form'
    LIMIT 1
  )
ON CONFLICT (org_id, name) DO NOTHING;
