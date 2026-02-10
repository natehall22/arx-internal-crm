-- Add settings JSONB column to orgs for org-level configuration
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{}';

-- Add comment explaining the settings structure
COMMENT ON COLUMN orgs.settings IS 'Organization settings JSON. Keys include:
  - measure_tool_enabled: boolean (default true) - Enable/disable in-house roof measurement tool
  - external_integrations: object - Configuration for external measurement providers
  - proposal_settings: object - Default proposal configuration
  - notification_settings: object - Organization notification preferences
';

-- Create index for JSONB queries
CREATE INDEX IF NOT EXISTS idx_orgs_settings ON orgs USING GIN (settings);
