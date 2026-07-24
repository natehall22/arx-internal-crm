-- Additive: seed Website Instant Estimate — Manual Measure lead source for ARX org.
-- Complex roofs (no dollar estimate to customer) must NOT inherit inside-sales auto_assign.
-- Runtime also upserts this row on first manual unlock if missing.
-- Live schema does NOT have notify_on_new_lead / notification_emails.
-- Safe to re-run: ON CONFLICT (org_id, name) DO NOTHING.

INSERT INTO lead_sources (
  org_id,
  name,
  source_type,
  webhook_enabled,
  is_active,
  auto_assign_user_id,
  default_campaign_id
)
SELECT
  '9089d4ad-f46c-405b-9798-6751d45a7051',
  'Website Instant Estimate — Manual Measure',
  'website',
  true,
  true,
  NULL,
  (
    SELECT default_campaign_id
    FROM lead_sources
    WHERE org_id = '9089d4ad-f46c-405b-9798-6751d45a7051'
      AND name = 'Website Instant Estimate'
    LIMIT 1
  )
ON CONFLICT (org_id, name) DO NOTHING;
