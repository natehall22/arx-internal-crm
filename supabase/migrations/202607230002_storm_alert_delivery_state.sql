-- Retry state for storm alert activity/notifications and digest email delivery.

ALTER TABLE storm_opportunity_alerts
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS email_sent_at TIMESTAMPTZ NULL;
