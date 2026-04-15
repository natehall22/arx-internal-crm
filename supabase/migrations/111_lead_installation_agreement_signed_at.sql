-- When a customer signs an Installation Agreement (order form), canvass map can show a sold marker on the linked lead.
-- Migration: 111_lead_installation_agreement_signed_at.sql

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS installation_agreement_signed_at TIMESTAMPTZ;

COMMENT ON COLUMN leads.installation_agreement_signed_at IS
  'Set when the Installation Agreement (non-contingency order form) is signed; used for canvass sold ($) pin styling.';

CREATE INDEX IF NOT EXISTS idx_leads_installation_agreement_signed_at
  ON leads (org_id, installation_agreement_signed_at)
  WHERE installation_agreement_signed_at IS NOT NULL;
