-- Migration: 036_org_contact_fields.sql
-- Add contact information fields to orgs table

ALTER TABLE orgs ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'America/New_York';
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS date_format TEXT DEFAULT 'MM/DD/YYYY';
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'USD';

-- Comments for documentation
COMMENT ON COLUMN orgs.phone IS 'Organization primary phone number';
COMMENT ON COLUMN orgs.email IS 'Organization primary email address';
COMMENT ON COLUMN orgs.address IS 'Organization physical address';
COMMENT ON COLUMN orgs.timezone IS 'Organization timezone (e.g., America/New_York)';
COMMENT ON COLUMN orgs.date_format IS 'Preferred date format (e.g., MM/DD/YYYY)';
COMMENT ON COLUMN orgs.currency IS 'Default currency code (e.g., USD)';
