-- Campaigns and Lead Sources System
-- Migration: 031_campaigns_lead_sources.sql
-- Tracks marketing campaigns and inbound lead sources for reporting

-- Lead source types enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lead_source_type') THEN
    CREATE TYPE lead_source_type AS ENUM (
      'website',
      'google_ads',
      'facebook',
      'instagram',
      'tiktok',
      'youtube',
      'bing_ads',
      'referral',
      'canvass',
      'door_knock',
      'phone_call',
      'walk_in',
      'home_show',
      'partner',
      'other'
    );
  END IF;
END $$;

-- Lead channel (inbound vs outbound)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lead_channel') THEN
    CREATE TYPE lead_channel AS ENUM (
      'inbound',   -- Website, ads, calls coming in
      'outbound'   -- Canvassing, door knocking, cold calls
    );
  END IF;
END $$;

-- Marketing campaigns table
CREATE TABLE campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  source_type lead_source_type NOT NULL DEFAULT 'other',
  channel lead_channel NOT NULL DEFAULT 'inbound',
  
  -- Budget tracking
  budget NUMERIC(12, 2),
  spent NUMERIC(12, 2) DEFAULT 0,
  
  -- UTM parameters for tracking
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_term TEXT,
  utm_content TEXT,
  
  -- External IDs for integration
  google_campaign_id TEXT,
  facebook_campaign_id TEXT,
  external_id TEXT, -- Generic external ID
  
  -- Status
  is_active BOOLEAN NOT NULL DEFAULT true,
  start_date DATE,
  end_date DATE,
  
  -- Metrics (updated via triggers or scheduled jobs)
  total_leads INTEGER NOT NULL DEFAULT 0,
  total_appointments INTEGER NOT NULL DEFAULT 0,
  total_sales INTEGER NOT NULL DEFAULT 0,
  total_revenue NUMERIC(12, 2) NOT NULL DEFAULT 0,
  cost_per_lead NUMERIC(10, 2) GENERATED ALWAYS AS (
    CASE WHEN total_leads > 0 AND spent > 0 THEN spent / total_leads ELSE NULL END
  ) STORED,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  
  UNIQUE(org_id, name)
);

CREATE INDEX idx_campaigns_org_id ON campaigns(org_id);
CREATE INDEX idx_campaigns_source_type ON campaigns(source_type);
CREATE INDEX idx_campaigns_channel ON campaigns(channel);
CREATE INDEX idx_campaigns_is_active ON campaigns(is_active);
CREATE INDEX idx_campaigns_utm_source ON campaigns(utm_source);
CREATE INDEX idx_campaigns_utm_campaign ON campaigns(utm_campaign);

-- Lead sources configuration (for webhook endpoints)
CREATE TABLE lead_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  source_type lead_source_type NOT NULL,
  
  -- Webhook configuration
  webhook_token TEXT NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  webhook_enabled BOOLEAN NOT NULL DEFAULT true,
  
  -- Default campaign for this source
  default_campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  
  -- Field mapping for incoming webhooks (JSON schema)
  field_mapping JSONB DEFAULT '{
    "name": "name",
    "email": "email",
    "phone": "phone",
    "address": "address",
    "message": "notes"
  }'::jsonb,
  
  -- Auto-assignment rules
  auto_assign_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  auto_assign_team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  round_robin_enabled BOOLEAN NOT NULL DEFAULT false,
  
  -- Notification settings
  notify_on_new_lead BOOLEAN NOT NULL DEFAULT true,
  notification_emails TEXT[], -- Additional emails to notify
  
  is_active BOOLEAN NOT NULL DEFAULT true,
  total_leads_received INTEGER NOT NULL DEFAULT 0,
  last_lead_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  UNIQUE(org_id, name)
);

CREATE INDEX idx_lead_sources_org_id ON lead_sources(org_id);
CREATE INDEX idx_lead_sources_webhook_token ON lead_sources(webhook_token);
CREATE INDEX idx_lead_sources_source_type ON lead_sources(source_type);

-- Add campaign and source tracking to leads table
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lead_source_id UUID REFERENCES lead_sources(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_type lead_source_type,
  ADD COLUMN IF NOT EXISTS channel lead_channel DEFAULT 'outbound',
  ADD COLUMN IF NOT EXISTS utm_source TEXT,
  ADD COLUMN IF NOT EXISTS utm_medium TEXT,
  ADD COLUMN IF NOT EXISTS utm_campaign TEXT,
  ADD COLUMN IF NOT EXISTS utm_term TEXT,
  ADD COLUMN IF NOT EXISTS utm_content TEXT,
  ADD COLUMN IF NOT EXISTS external_lead_id TEXT, -- ID from external system
  ADD COLUMN IF NOT EXISTS landing_page TEXT,
  ADD COLUMN IF NOT EXISTS referrer_url TEXT,
  ADD COLUMN IF NOT EXISTS ip_address INET,
  ADD COLUMN IF NOT EXISTS user_agent TEXT,
  ADD COLUMN IF NOT EXISTS raw_payload JSONB; -- Store original webhook data

CREATE INDEX idx_leads_campaign_id ON leads(campaign_id);
CREATE INDEX idx_leads_lead_source_id ON leads(lead_source_id);
CREATE INDEX idx_leads_source_type ON leads(source_type);
CREATE INDEX idx_leads_channel ON leads(channel);
CREATE INDEX idx_leads_external_lead_id ON leads(external_lead_id);

-- Inbound lead queue (for leads that need assignment)
CREATE TABLE inbound_lead_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  lead_source_id UUID REFERENCES lead_sources(id) ON DELETE SET NULL,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  
  -- Queue status
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'assigned', 'claimed', 'expired')),
  priority INTEGER NOT NULL DEFAULT 0, -- Higher = more urgent
  
  -- Assignment tracking
  assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ,
  claimed_at TIMESTAMPTZ,
  
  -- SLA tracking
  sla_deadline TIMESTAMPTZ, -- When lead must be contacted by
  first_contact_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  UNIQUE(lead_id)
);

CREATE INDEX idx_inbound_lead_queue_org_id ON inbound_lead_queue(org_id);
CREATE INDEX idx_inbound_lead_queue_status ON inbound_lead_queue(status);
CREATE INDEX idx_inbound_lead_queue_assigned_to ON inbound_lead_queue(assigned_to);
CREATE INDEX idx_inbound_lead_queue_priority ON inbound_lead_queue(priority DESC);

-- Add new permissions for inbound leads
INSERT INTO permissions (name, display_name, description, category) VALUES
  ('leads:view_inbound', 'View Inbound Leads', 'Access leads from website, ads, and other inbound sources', 'Leads'),
  ('leads:manage_inbound', 'Manage Inbound Leads', 'Assign and manage inbound lead queue', 'Leads'),
  ('leads:claim_inbound', 'Claim Inbound Leads', 'Claim leads from the inbound queue', 'Leads'),
  ('campaigns:view', 'View Campaigns', 'See marketing campaign data', 'Campaigns'),
  ('campaigns:create', 'Create Campaigns', 'Create new marketing campaigns', 'Campaigns'),
  ('campaigns:edit', 'Edit Campaigns', 'Modify campaign settings', 'Campaigns'),
  ('campaigns:delete', 'Delete Campaigns', 'Remove campaigns', 'Campaigns'),
  ('campaigns:view_reports', 'View Campaign Reports', 'Access campaign performance reports', 'Campaigns'),
  ('lead_sources:view', 'View Lead Sources', 'See lead source configurations', 'Leads'),
  ('lead_sources:manage', 'Manage Lead Sources', 'Configure webhook endpoints and field mappings', 'Leads')
ON CONFLICT (name) DO NOTHING;

-- Triggers
CREATE TRIGGER update_campaigns_updated_at 
  BEFORE UPDATE ON campaigns 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_lead_sources_updated_at 
  BEFORE UPDATE ON lead_sources 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_inbound_lead_queue_updated_at 
  BEFORE UPDATE ON inbound_lead_queue 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to update campaign metrics when a lead is added
CREATE OR REPLACE FUNCTION update_campaign_lead_count()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.campaign_id IS NOT NULL THEN
    UPDATE campaigns 
    SET total_leads = (
      SELECT COUNT(*) FROM leads WHERE campaign_id = NEW.campaign_id
    )
    WHERE id = NEW.campaign_id;
  END IF;
  
  -- Also update old campaign if changed
  IF TG_OP = 'UPDATE' AND OLD.campaign_id IS NOT NULL AND OLD.campaign_id != NEW.campaign_id THEN
    UPDATE campaigns 
    SET total_leads = (
      SELECT COUNT(*) FROM leads WHERE campaign_id = OLD.campaign_id
    )
    WHERE id = OLD.campaign_id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_campaign_lead_count
  AFTER INSERT OR UPDATE OF campaign_id ON leads
  FOR EACH ROW EXECUTE FUNCTION update_campaign_lead_count();

-- Function to update lead source stats
CREATE OR REPLACE FUNCTION update_lead_source_stats()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.lead_source_id IS NOT NULL THEN
    UPDATE lead_sources 
    SET 
      total_leads_received = total_leads_received + 1,
      last_lead_at = NOW()
    WHERE id = NEW.lead_source_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_lead_source_stats
  AFTER INSERT ON leads
  FOR EACH ROW 
  WHEN (NEW.lead_source_id IS NOT NULL)
  EXECUTE FUNCTION update_lead_source_stats();

-- RLS Policies
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbound_lead_queue ENABLE ROW LEVEL SECURITY;

-- Campaigns: Users with permission can view, admins can manage
CREATE POLICY "Users can view campaigns in their org"
  ON campaigns FOR SELECT
  USING (
    org_id = get_user_org_id(auth.uid())
    AND (
      get_user_role(auth.uid()) IN ('admin', 'regional_manager')
      OR user_has_permission(auth.uid(), 'campaigns:view')
    )
  );

CREATE POLICY "Admins can manage campaigns"
  ON campaigns FOR ALL
  USING (
    org_id = get_user_org_id(auth.uid())
    AND (
      get_user_role(auth.uid()) IN ('admin', 'regional_manager')
      OR user_has_permission(auth.uid(), 'campaigns:edit')
    )
  );

-- Lead sources: Only admins can view/manage
CREATE POLICY "Admins can view lead sources"
  ON lead_sources FOR SELECT
  USING (
    org_id = get_user_org_id(auth.uid())
    AND (
      get_user_role(auth.uid()) IN ('admin', 'regional_manager')
      OR user_has_permission(auth.uid(), 'lead_sources:view')
    )
  );

CREATE POLICY "Admins can manage lead sources"
  ON lead_sources FOR ALL
  USING (
    org_id = get_user_org_id(auth.uid())
    AND (
      get_user_role(auth.uid()) IN ('admin', 'regional_manager')
      OR user_has_permission(auth.uid(), 'lead_sources:manage')
    )
  );

-- Inbound lead queue: Based on permissions
CREATE POLICY "Users can view inbound queue based on permissions"
  ON inbound_lead_queue FOR SELECT
  USING (
    org_id = get_user_org_id(auth.uid())
    AND (
      get_user_role(auth.uid()) IN ('admin', 'regional_manager', 'operations')
      OR user_has_permission(auth.uid(), 'leads:view_inbound')
      OR assigned_to = auth.uid()
    )
  );

CREATE POLICY "Users can update their assigned leads"
  ON inbound_lead_queue FOR UPDATE
  USING (
    org_id = get_user_org_id(auth.uid())
    AND (
      get_user_role(auth.uid()) IN ('admin', 'regional_manager')
      OR user_has_permission(auth.uid(), 'leads:manage_inbound')
      OR assigned_to = auth.uid()
    )
  );

CREATE POLICY "Admins can manage inbound queue"
  ON inbound_lead_queue FOR ALL
  USING (
    org_id = get_user_org_id(auth.uid())
    AND (
      get_user_role(auth.uid()) IN ('admin', 'regional_manager')
      OR user_has_permission(auth.uid(), 'leads:manage_inbound')
    )
  );

-- Update leads RLS to consider inbound permissions
-- Users can only see inbound leads if they have permission
CREATE POLICY "Users can view inbound leads with permission"
  ON leads FOR SELECT
  USING (
    org_id = get_user_org_id(auth.uid())
    AND (
      -- Outbound leads: normal access
      channel = 'outbound'
      OR channel IS NULL
      -- Inbound leads: need permission or be assigned
      OR (
        channel = 'inbound'
        AND (
          get_user_role(auth.uid()) IN ('admin', 'regional_manager', 'operations')
          OR user_has_permission(auth.uid(), 'leads:view_inbound')
          OR owner_user_id = auth.uid()
        )
      )
      -- Or user owns the lead
      OR owner_user_id = auth.uid()
    )
  );

COMMENT ON TABLE campaigns IS 'Marketing campaigns for tracking lead sources and ROI';
COMMENT ON TABLE lead_sources IS 'Webhook endpoints and configurations for receiving inbound leads';
COMMENT ON TABLE inbound_lead_queue IS 'Queue for managing and assigning inbound leads';
COMMENT ON COLUMN leads.channel IS 'Whether lead came from inbound (website/ads) or outbound (canvassing) efforts';
