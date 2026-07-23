-- Additive: document Website Instant Estimate lead source for ARX org.
-- Runtime also upserts this row on first unlock if missing.
-- Safe to re-run: ON CONFLICT (org_id, name) DO NOTHING.

INSERT INTO lead_sources (
  org_id,
  name,
  source_type,
  webhook_enabled,
  is_active,
  notify_on_new_lead,
  notification_emails
)
VALUES (
  '9089d4ad-f46c-405b-9798-6751d45a7051',
  'Website Instant Estimate',
  'website',
  true,
  true,
  true,
  ARRAY['nathan@arxroofing.com']
)
ON CONFLICT (org_id, name) DO NOTHING;
