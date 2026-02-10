-- ============================================================
-- RESET AND INITIALIZE - Clean slate migration
-- WARNING: This will DROP all existing tables and data!
-- ============================================================

-- Drop all tables in reverse dependency order
DROP TABLE IF EXISTS job_files CASCADE;
DROP TABLE IF EXISTS preset_permissions CASCADE;
DROP TABLE IF EXISTS permission_presets CASCADE;
DROP TABLE IF EXISTS user_permissions CASCADE;
DROP TABLE IF EXISTS lead_sources CASCADE;
DROP TABLE IF EXISTS campaigns CASCADE;
DROP TABLE IF EXISTS inbound_lead_queue CASCADE;
DROP TABLE IF EXISTS work_order_status_history CASCADE;
DROP TABLE IF EXISTS work_order_comments CASCADE;
DROP TABLE IF EXISTS work_orders CASCADE;
DROP TABLE IF EXISTS sub_contractors CASCADE;
DROP TABLE IF EXISTS measurement_requests CASCADE;
DROP TABLE IF EXISTS roof_facets CASCADE;
DROP TABLE IF EXISTS roof_measurements CASCADE;
DROP TABLE IF EXISTS integration_configs CASCADE;
DROP TABLE IF EXISTS proposal_photos CASCADE;
DROP TABLE IF EXISTS proposal_line_items CASCADE;
DROP TABLE IF EXISTS proposal_templates CASCADE;
DROP TABLE IF EXISTS proposals CASCADE;
DROP TABLE IF EXISTS adder_categories CASCADE;
DROP TABLE IF EXISTS ai_suggestions CASCADE;
DROP TABLE IF EXISTS ai_conversations CASCADE;
DROP TABLE IF EXISTS user_settings CASCADE;
DROP TABLE IF EXISTS commissions CASCADE;
DROP TABLE IF EXISTS user_comp_plans CASCADE;
DROP TABLE IF EXISTS comp_plans CASCADE;
DROP TABLE IF EXISTS saved_report_filters CASCADE;
DROP TABLE IF EXISTS report_schedules CASCADE;
DROP TABLE IF EXISTS report_role_access CASCADE;
DROP TABLE IF EXISTS custom_reports CASCADE;
DROP TABLE IF EXISTS dashboard_settings CASCADE;
DROP TABLE IF EXISTS pending_status_prompts CASCADE;
DROP TABLE IF EXISTS inspection_status_updates CASCADE;
DROP TABLE IF EXISTS role_permissions CASCADE;
DROP TABLE IF EXISTS custom_roles CASCADE;
DROP TABLE IF EXISTS permissions CASCADE;
DROP TABLE IF EXISTS scheduled_appointments CASCADE;
DROP TABLE IF EXISTS user_google_tokens CASCADE;
DROP TABLE IF EXISTS team_closer_queue CASCADE;
DROP TABLE IF EXISTS contract_signatures CASCADE;
DROP TABLE IF EXISTS contract_templates CASCADE;
DROP TABLE IF EXISTS contracts CASCADE;
DROP TABLE IF EXISTS notifications CASCADE;
DROP TABLE IF EXISTS referrals CASCADE;
DROP TABLE IF EXISTS estimate_lines CASCADE;
DROP TABLE IF EXISTS estimates CASCADE;
DROP TABLE IF EXISTS pricebook_items CASCADE;
DROP TABLE IF EXISTS pricebooks CASCADE;
DROP TABLE IF EXISTS files CASCADE;
DROP TABLE IF EXISTS activities CASCADE;
DROP TABLE IF EXISTS opportunities CASCADE;
DROP TABLE IF EXISTS projects CASCADE;
DROP TABLE IF EXISTS jobs CASCADE;
DROP TABLE IF EXISTS customers CASCADE;
DROP TABLE IF EXISTS leads CASCADE;
DROP TABLE IF EXISTS teams CASCADE;
DROP TABLE IF EXISTS regions CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS orgs CASCADE;

-- Drop all custom types
DROP TYPE IF EXISTS job_file_type CASCADE;
DROP TYPE IF EXISTS lead_channel CASCADE;
DROP TYPE IF EXISTS lead_source_type CASCADE;
DROP TYPE IF EXISTS referral_status CASCADE;
DROP TYPE IF EXISTS work_order_priority CASCADE;
DROP TYPE IF EXISTS work_order_status CASCADE;
DROP TYPE IF EXISTS work_order_type CASCADE;
DROP TYPE IF EXISTS measurement_status CASCADE;
DROP TYPE IF EXISTS roof_material CASCADE;
DROP TYPE IF EXISTS integration_provider CASCADE;
DROP TYPE IF EXISTS pricing_visibility CASCADE;
DROP TYPE IF EXISTS proposal_status CASCADE;
DROP TYPE IF EXISTS commission_status CASCADE;
DROP TYPE IF EXISTS comp_plan_type CASCADE;
DROP TYPE IF EXISTS report_data_source CASCADE;
DROP TYPE IF EXISTS report_type CASCADE;
DROP TYPE IF EXISTS inspection_outcome CASCADE;
DROP TYPE IF EXISTS canvass_disposition CASCADE;
DROP TYPE IF EXISTS opportunity_status CASCADE;
DROP TYPE IF EXISTS project_status CASCADE;
DROP TYPE IF EXISTS project_type CASCADE;
DROP TYPE IF EXISTS estimate_status CASCADE;
DROP TYPE IF EXISTS unit CASCADE;
DROP TYPE IF EXISTS pricebook_item_type CASCADE;
DROP TYPE IF EXISTS pricebook_category CASCADE;
DROP TYPE IF EXISTS file_tag CASCADE;
DROP TYPE IF EXISTS activity_type CASCADE;
DROP TYPE IF EXISTS job_type CASCADE;
DROP TYPE IF EXISTS job_status CASCADE;
DROP TYPE IF EXISTS lead_status CASCADE;
DROP TYPE IF EXISTS user_role CASCADE;

-- Drop functions
DROP FUNCTION IF EXISTS get_user_org_id CASCADE;
DROP FUNCTION IF EXISTS is_admin_or_manager CASCADE;
DROP FUNCTION IF EXISTS get_user_role CASCADE;
DROP FUNCTION IF EXISTS user_has_permission CASCADE;
DROP FUNCTION IF EXISTS update_updated_at_column CASCADE;
DROP FUNCTION IF EXISTS get_next_job_file_version CASCADE;

-- ============================================================
-- NOW CREATE EVERYTHING FRESH
-- ============================================================

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Create enums
CREATE TYPE user_role AS ENUM ('admin', 'manager', 'rep');
CREATE TYPE lead_status AS ENUM ('new', 'contacted', 'appointment', 'inspection', 'estimate_sent', 'won', 'lost');
CREATE TYPE job_status AS ENUM ('open', 'in_progress', 'on_hold', 'complete', 'collected');
CREATE TYPE job_type AS ENUM ('roofing', 'siding', 'windows', 'mixed');
CREATE TYPE activity_type AS ENUM ('note', 'call', 'text', 'email', 'visit', 'status_change');
CREATE TYPE file_tag AS ENUM ('photo', 'document', 'proposal', 'contract', 'other');
CREATE TYPE pricebook_category AS ENUM ('roofing', 'siding', 'windows', 'addons');
CREATE TYPE pricebook_item_type AS ENUM ('install', 'tearoff', 'material', 'addon', 'disposal', 'cleanup', 'dumpster', 'decking', 'flashing');
CREATE TYPE unit AS ENUM ('square', 'each', 'lf', 'sheet', 'job');
CREATE TYPE estimate_status AS ENUM ('draft', 'sent', 'approved', 'declined');
CREATE TYPE canvass_disposition AS ENUM ('not_home', 'bad_roof', 'renter', 'go_back', 'hot_lead', 'not_interested');
CREATE TYPE lead_source_type AS ENUM ('website', 'google_ads', 'facebook', 'instagram', 'tiktok', 'youtube', 'bing_ads', 'referral', 'canvass', 'door_knock', 'phone_call', 'walk_in', 'home_show', 'partner', 'other');
CREATE TYPE lead_channel AS ENUM ('inbound', 'outbound');
CREATE TYPE job_file_type AS ENUM ('contract', 'change_order', 'proposal', 'invoice', 'permit', 'inspection_report', 'warranty', 'other');

-- ============================================================
-- CORE TABLES
-- ============================================================

-- Organizations
CREATE TABLE orgs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Users
CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  role user_role NOT NULL DEFAULT 'rep',
  full_name TEXT,
  phone TEXT,
  email TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  manager_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  team_id UUID,
  region_id UUID,
  custom_role_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Regions
CREATE TABLE regions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Teams
CREATE TABLE teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  region_id UUID REFERENCES regions(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add foreign keys to users after teams/regions exist
ALTER TABLE users ADD CONSTRAINT fk_users_team FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL;
ALTER TABLE users ADD CONSTRAINT fk_users_region FOREIGN KEY (region_id) REFERENCES regions(id) ON DELETE SET NULL;

-- Customers
CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name TEXT,
  phone TEXT,
  email TEXT,
  address_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Leads
CREATE TABLE leads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  status lead_status NOT NULL DEFAULT 'new',
  source TEXT,
  address_text TEXT,
  lat NUMERIC(10, 8),
  lng NUMERIC(11, 8),
  homeowner_name TEXT,
  phone TEXT,
  email TEXT,
  notes TEXT,
  inspection_scheduled_at TIMESTAMPTZ,
  inspection_scheduled_for TIMESTAMPTZ,
  canvass_disposition canvass_disposition,
  canvass_notes TEXT,
  closer_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  campaign_id UUID,
  lead_source_id UUID,
  source_type lead_source_type,
  channel lead_channel DEFAULT 'outbound',
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  external_lead_id TEXT,
  raw_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Jobs
CREATE TABLE jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  status job_status NOT NULL DEFAULT 'open',
  job_type job_type NOT NULL DEFAULT 'roofing',
  address_text TEXT,
  lat NUMERIC(10, 8),
  lng NUMERIC(11, 8),
  roof_squares NUMERIC(10, 2),
  siding_squares NUMERIC(10, 2),
  vents_count INTEGER NOT NULL DEFAULT 0,
  layers INTEGER NOT NULL DEFAULT 1,
  total_windows INTEGER NOT NULL DEFAULT 0,
  windows_by_type JSONB,
  notes TEXT,
  scope_of_work TEXT,
  permits_status TEXT,
  product_summary TEXT,
  install_date DATE,
  ops_notes TEXT,
  contract_pdf_path TEXT,
  contract_sent_at TIMESTAMPTZ,
  contract_uploaded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Activities
CREATE TABLE activities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type activity_type NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Files
CREATE TABLE files (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  tag file_tag NOT NULL DEFAULT 'other',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Pricebooks
CREATE TABLE pricebooks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Pricebook Items
CREATE TABLE pricebook_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  pricebook_id UUID NOT NULL REFERENCES pricebooks(id) ON DELETE CASCADE,
  category pricebook_category NOT NULL,
  item_type pricebook_item_type NOT NULL,
  name TEXT NOT NULL,
  unit unit NOT NULL,
  unit_price NUMERIC(10, 2) NOT NULL,
  cost_price NUMERIC(10, 2),
  price_type TEXT DEFAULT 'fixed',
  is_labor BOOLEAN NOT NULL DEFAULT false,
  is_taxable BOOLEAN NOT NULL DEFAULT true,
  is_commissionable BOOLEAN DEFAULT false,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Estimates
CREATE TABLE estimates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  status estimate_status NOT NULL DEFAULT 'draft',
  steep_multiplier_pct NUMERIC(5, 2) NOT NULL DEFAULT 0,
  high_multiplier_pct NUMERIC(5, 2) NOT NULL DEFAULT 0,
  tax_rate NUMERIC(5, 4) NOT NULL DEFAULT 0.08,
  discount_amount NUMERIC(10, 2) NOT NULL DEFAULT 0,
  subtotal NUMERIC(10, 2) NOT NULL DEFAULT 0,
  tax NUMERIC(10, 2) NOT NULL DEFAULT 0,
  total NUMERIC(10, 2) NOT NULL DEFAULT 0,
  scope_text TEXT,
  proposal_pdf_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Estimate Lines
CREATE TABLE estimate_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  estimate_id UUID NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  pricebook_item_id UUID REFERENCES pricebook_items(id) ON DELETE SET NULL,
  category pricebook_category NOT NULL,
  name TEXT NOT NULL,
  unit unit NOT NULL,
  qty NUMERIC(10, 2) NOT NULL,
  unit_price NUMERIC(10, 2) NOT NULL,
  line_total NUMERIC(10, 2) NOT NULL GENERATED ALWAYS AS (qty * unit_price) STORED,
  is_labor BOOLEAN NOT NULL,
  is_taxable BOOLEAN NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Notifications
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  recipient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  link_url TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Contracts
CREATE TABLE contracts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  contract_pdf_path TEXT,
  token UUID UNIQUE,
  status TEXT NOT NULL DEFAULT 'sent',
  signed_at TIMESTAMPTZ,
  signed_name TEXT,
  signed_email TEXT,
  signed_ip TEXT,
  signed_user_agent TEXT,
  signed_location_text TEXT,
  audit_pdf_path TEXT,
  sent_to_email TEXT,
  sent_at TIMESTAMPTZ,
  contract_payload JSONB,
  rep_signed_at TIMESTAMPTZ,
  customer_signed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Contract Templates
CREATE TABLE contract_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Contract Signatures
CREATE TABLE contract_signatures (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('rep', 'customer')),
  signed_name TEXT,
  signed_title TEXT,
  signed_email TEXT,
  signature_type TEXT,
  signature_data TEXT,
  signed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  signed_ip TEXT,
  signed_user_agent TEXT,
  signed_location_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Team Closer Queue
CREATE TABLE team_closer_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  priority INTEGER NOT NULL DEFAULT 0,
  buffer_minutes INTEGER NOT NULL DEFAULT 60,
  active BOOLEAN NOT NULL DEFAULT true,
  last_assigned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(team_id, user_id)
);

-- User Google Tokens
CREATE TABLE user_google_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_type TEXT NOT NULL DEFAULT 'Bearer',
  expires_at TIMESTAMPTZ NOT NULL,
  scope TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id)
);

-- Scheduled Appointments
CREATE TABLE scheduled_appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  closer_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  canvasser_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  google_event_id TEXT,
  scheduled_for TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 60,
  status TEXT NOT NULL DEFAULT 'scheduled',
  address_text TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Custom Roles
CREATE TABLE custom_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT,
  hierarchy_level INTEGER NOT NULL DEFAULT 0,
  is_system_role BOOLEAN NOT NULL DEFAULT false,
  parent_role_id UUID REFERENCES custom_roles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, name)
);

-- Add foreign key to users for custom_role_id
ALTER TABLE users ADD CONSTRAINT fk_users_custom_role FOREIGN KEY (custom_role_id) REFERENCES custom_roles(id) ON DELETE SET NULL;

-- Permissions
CREATE TABLE permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Role Permissions
CREATE TABLE role_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id UUID NOT NULL REFERENCES custom_roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(role_id, permission_id)
);

-- User Permissions
CREATE TABLE user_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  granted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  notes TEXT,
  UNIQUE(user_id, permission_id)
);

-- Permission Presets
CREATE TABLE permission_presets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  base_role TEXT NOT NULL DEFAULT 'rep',
  icon TEXT,
  color TEXT DEFAULT 'gray',
  is_system BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE(org_id, name)
);

-- Preset Permissions
CREATE TABLE preset_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  preset_id UUID NOT NULL REFERENCES permission_presets(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(preset_id, permission_id)
);

-- Campaigns
CREATE TABLE campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  source_type lead_source_type NOT NULL DEFAULT 'other',
  channel lead_channel NOT NULL DEFAULT 'inbound',
  budget NUMERIC(12, 2),
  spent NUMERIC(12, 2) DEFAULT 0,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  start_date DATE,
  end_date DATE,
  total_leads INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE(org_id, name)
);

-- Lead Sources
CREATE TABLE lead_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  source_type lead_source_type NOT NULL,
  webhook_token TEXT NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  webhook_enabled BOOLEAN NOT NULL DEFAULT true,
  default_campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  field_mapping JSONB DEFAULT '{"name": "name", "email": "email", "phone": "phone", "address": "address", "message": "notes"}'::jsonb,
  auto_assign_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  total_leads_received INTEGER NOT NULL DEFAULT 0,
  last_lead_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, name)
);

-- Add foreign keys to leads for campaigns
ALTER TABLE leads ADD CONSTRAINT fk_leads_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE SET NULL;
ALTER TABLE leads ADD CONSTRAINT fk_leads_source FOREIGN KEY (lead_source_id) REFERENCES lead_sources(id) ON DELETE SET NULL;

-- Job Files
CREATE TABLE job_files (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  file_type job_file_type NOT NULL,
  storage_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size INTEGER,
  mime_type TEXT NOT NULL DEFAULT 'application/pdf',
  version INTEGER NOT NULL DEFAULT 1,
  is_signed BOOLEAN NOT NULL DEFAULT false,
  signed_at TIMESTAMPTZ,
  signed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX idx_users_org_id ON users(org_id);
CREATE INDEX idx_users_team_id ON users(team_id);
CREATE INDEX idx_users_region_id ON users(region_id);
CREATE INDEX idx_users_manager_user_id ON users(manager_user_id);
CREATE INDEX idx_users_custom_role_id ON users(custom_role_id);
CREATE INDEX idx_regions_org_id ON regions(org_id);
CREATE INDEX idx_teams_org_id ON teams(org_id);
CREATE INDEX idx_teams_region_id ON teams(region_id);
CREATE INDEX idx_leads_org_id ON leads(org_id);
CREATE INDEX idx_leads_owner_user_id ON leads(owner_user_id);
CREATE INDEX idx_leads_status ON leads(status);
CREATE INDEX idx_leads_canvass_disposition ON leads(canvass_disposition);
CREATE INDEX idx_leads_closer_user_id ON leads(closer_user_id);
CREATE INDEX idx_leads_campaign_id ON leads(campaign_id);
CREATE INDEX idx_leads_channel ON leads(channel);
CREATE INDEX idx_customers_org_id ON customers(org_id);
CREATE INDEX idx_jobs_org_id ON jobs(org_id);
CREATE INDEX idx_jobs_customer_id ON jobs(customer_id);
CREATE INDEX idx_jobs_lead_id ON jobs(lead_id);
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_owner_user_id ON jobs(owner_user_id);
CREATE INDEX idx_activities_org_id ON activities(org_id);
CREATE INDEX idx_activities_lead_id ON activities(lead_id);
CREATE INDEX idx_activities_job_id ON activities(job_id);
CREATE INDEX idx_files_org_id ON files(org_id);
CREATE INDEX idx_files_lead_id ON files(lead_id);
CREATE INDEX idx_files_job_id ON files(job_id);
CREATE INDEX idx_pricebooks_org_id ON pricebooks(org_id);
CREATE INDEX idx_pricebook_items_org_id ON pricebook_items(org_id);
CREATE INDEX idx_pricebook_items_pricebook_id ON pricebook_items(pricebook_id);
CREATE INDEX idx_estimates_org_id ON estimates(org_id);
CREATE INDEX idx_estimates_job_id ON estimates(job_id);
CREATE INDEX idx_estimate_lines_org_id ON estimate_lines(org_id);
CREATE INDEX idx_estimate_lines_estimate_id ON estimate_lines(estimate_id);
CREATE INDEX idx_notifications_org_id ON notifications(org_id);
CREATE INDEX idx_notifications_recipient ON notifications(recipient_user_id);
CREATE INDEX idx_contracts_org_id ON contracts(org_id);
CREATE INDEX idx_contracts_job_id ON contracts(job_id);
CREATE INDEX idx_contract_templates_org_id ON contract_templates(org_id);
CREATE INDEX idx_contract_signatures_contract_id ON contract_signatures(contract_id);
CREATE INDEX idx_contract_signatures_org_id ON contract_signatures(org_id);
CREATE INDEX idx_team_closer_queue_team_id ON team_closer_queue(team_id);
CREATE INDEX idx_team_closer_queue_user_id ON team_closer_queue(user_id);
CREATE INDEX idx_scheduled_appointments_closer ON scheduled_appointments(closer_user_id, scheduled_for);
CREATE INDEX idx_scheduled_appointments_lead ON scheduled_appointments(lead_id);
CREATE INDEX idx_custom_roles_org_id ON custom_roles(org_id);
CREATE INDEX idx_role_permissions_role_id ON role_permissions(role_id);
CREATE INDEX idx_role_permissions_permission_id ON role_permissions(permission_id);
CREATE INDEX idx_user_permissions_user_id ON user_permissions(user_id);
CREATE INDEX idx_user_permissions_org_id ON user_permissions(org_id);
CREATE INDEX idx_permission_presets_org_id ON permission_presets(org_id);
CREATE INDEX idx_preset_permissions_preset_id ON preset_permissions(preset_id);
CREATE INDEX idx_campaigns_org_id ON campaigns(org_id);
CREATE INDEX idx_lead_sources_org_id ON lead_sources(org_id);
CREATE INDEX idx_lead_sources_webhook_token ON lead_sources(webhook_token);
CREATE INDEX idx_job_files_org_id ON job_files(org_id);
CREATE INDEX idx_job_files_job_id ON job_files(job_id);
CREATE INDEX idx_job_files_file_type ON job_files(file_type);
CREATE INDEX idx_job_files_created_at ON job_files(created_at DESC);

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================

CREATE OR REPLACE FUNCTION get_user_org_id(user_uuid UUID)
RETURNS UUID AS $$
  SELECT org_id FROM users WHERE id = user_uuid;
$$ LANGUAGE sql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION is_admin_or_manager(user_uuid UUID)
RETURNS BOOLEAN AS $$
  SELECT role IN ('admin', 'manager') FROM users WHERE id = user_uuid;
$$ LANGUAGE sql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_user_role(user_uuid UUID)
RETURNS user_role AS $$
  SELECT role FROM users WHERE id = user_uuid;
$$ LANGUAGE sql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION user_has_permission(user_uuid UUID, permission_name TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  user_record RECORD;
BEGIN
  SELECT role, custom_role_id INTO user_record
  FROM users WHERE id = user_uuid;
  
  IF NOT FOUND THEN RETURN FALSE; END IF;
  IF user_record.role = 'admin' THEN RETURN TRUE; END IF;
  
  -- Check user-specific grants
  IF EXISTS (
    SELECT 1 FROM user_permissions up
    JOIN permissions p ON p.id = up.permission_id
    WHERE up.user_id = user_uuid AND p.name = permission_name
    AND (up.expires_at IS NULL OR up.expires_at > NOW())
  ) THEN RETURN TRUE; END IF;
  
  -- Check custom role
  IF user_record.custom_role_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM role_permissions rp
      JOIN permissions p ON p.id = rp.permission_id
      WHERE rp.role_id = user_record.custom_role_id
      AND (p.name = permission_name OR p.name = 'admin:full')
    ) THEN RETURN TRUE; END IF;
  END IF;
  
  -- Legacy role check
  RETURN CASE user_record.role
    WHEN 'manager' THEN permission_name IN (
      'canvass:view', 'leads:view', 'opportunities:view', 'opportunities:edit',
      'proposals:view', 'proposals:edit', 'contracts:view', 'contracts:send',
      'projects:view', 'reports:view_own', 'reports:view_team', 'reports:export',
      'teams:view', 'teams:create', 'teams:edit', 'users:view', 'users:manage_team',
      'scheduling:view', 'scheduling:manage_team', 'pricebook:view'
    )
    WHEN 'rep' THEN permission_name IN (
      'canvass:view', 'leads:view', 'opportunities:view', 'opportunities:edit',
      'proposals:view', 'proposals:edit', 'contracts:view', 'contracts:send',
      'projects:view', 'reports:view_own', 'teams:view', 'users:view',
      'scheduling:view', 'pricebook:view'
    )
    ELSE FALSE
  END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_next_job_file_version(p_job_id UUID, p_file_type job_file_type)
RETURNS INTEGER AS $$
  SELECT COALESCE(MAX(version), 0) + 1
  FROM job_files
  WHERE job_id = p_job_id AND file_type = p_file_type;
$$ LANGUAGE sql;

-- ============================================================
-- TRIGGERS
-- ============================================================

CREATE TRIGGER update_orgs_updated_at BEFORE UPDATE ON orgs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_regions_updated_at BEFORE UPDATE ON regions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_teams_updated_at BEFORE UPDATE ON teams FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_leads_updated_at BEFORE UPDATE ON leads FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_customers_updated_at BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_jobs_updated_at BEFORE UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_activities_updated_at BEFORE UPDATE ON activities FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_files_updated_at BEFORE UPDATE ON files FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_pricebooks_updated_at BEFORE UPDATE ON pricebooks FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_pricebook_items_updated_at BEFORE UPDATE ON pricebook_items FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_estimates_updated_at BEFORE UPDATE ON estimates FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_estimate_lines_updated_at BEFORE UPDATE ON estimate_lines FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_team_closer_queue_updated_at BEFORE UPDATE ON team_closer_queue FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_user_google_tokens_updated_at BEFORE UPDATE ON user_google_tokens FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_scheduled_appointments_updated_at BEFORE UPDATE ON scheduled_appointments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_custom_roles_updated_at BEFORE UPDATE ON custom_roles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_permission_presets_updated_at BEFORE UPDATE ON permission_presets FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_campaigns_updated_at BEFORE UPDATE ON campaigns FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_lead_sources_updated_at BEFORE UPDATE ON lead_sources FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_job_files_updated_at BEFORE UPDATE ON job_files FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE orgs ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE regions ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE files ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricebooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricebook_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE estimates ENABLE ROW LEVEL SECURITY;
ALTER TABLE estimate_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_signatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_closer_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_google_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE permission_presets ENABLE ROW LEVEL SECURITY;
ALTER TABLE preset_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_files ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- RLS POLICIES
-- ============================================================

-- Orgs
CREATE POLICY "Users can read their own org" ON orgs FOR SELECT USING (id = get_user_org_id(auth.uid()));

-- Users
CREATE POLICY "Users can read users in their org" ON users FOR SELECT USING (org_id = get_user_org_id(auth.uid()));
CREATE POLICY "Admins can update users" ON users FOR UPDATE USING (org_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));
CREATE POLICY "Admins can insert users" ON users FOR INSERT WITH CHECK (org_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

-- Regions
CREATE POLICY "Users can view regions" ON regions FOR SELECT USING (org_id = get_user_org_id(auth.uid()));
CREATE POLICY "Admins can manage regions" ON regions FOR ALL USING (org_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

-- Teams
CREATE POLICY "Users can view teams" ON teams FOR SELECT USING (org_id = get_user_org_id(auth.uid()));
CREATE POLICY "Admins can manage teams" ON teams FOR ALL USING (org_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

-- Leads
CREATE POLICY "Users can read leads" ON leads FOR SELECT USING (org_id = get_user_org_id(auth.uid()));
CREATE POLICY "Users can insert leads" ON leads FOR INSERT WITH CHECK (org_id = get_user_org_id(auth.uid()));
CREATE POLICY "Users can update leads" ON leads FOR UPDATE USING (org_id = get_user_org_id(auth.uid()));
CREATE POLICY "Admins can delete leads" ON leads FOR DELETE USING (org_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

-- Customers
CREATE POLICY "Users can read customers" ON customers FOR SELECT USING (org_id = get_user_org_id(auth.uid()));
CREATE POLICY "Users can insert customers" ON customers FOR INSERT WITH CHECK (org_id = get_user_org_id(auth.uid()));
CREATE POLICY "Users can update customers" ON customers FOR UPDATE USING (org_id = get_user_org_id(auth.uid()));
CREATE POLICY "Admins can delete customers" ON customers FOR DELETE USING (org_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

-- Jobs
CREATE POLICY "Users can read jobs" ON jobs FOR SELECT USING (org_id = get_user_org_id(auth.uid()));
CREATE POLICY "Users can insert jobs" ON jobs FOR INSERT WITH CHECK (org_id = get_user_org_id(auth.uid()));
CREATE POLICY "Users can update jobs" ON jobs FOR UPDATE USING (org_id = get_user_org_id(auth.uid()));
CREATE POLICY "Admins can delete jobs" ON jobs FOR DELETE USING (org_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

-- Activities
CREATE POLICY "Users can read activities" ON activities FOR SELECT USING (org_id = get_user_org_id(auth.uid()));
CREATE POLICY "Users can insert activities" ON activities FOR INSERT WITH CHECK (org_id = get_user_org_id(auth.uid()) AND user_id = auth.uid());
CREATE POLICY "Users can update own activities" ON activities FOR UPDATE USING (org_id = get_user_org_id(auth.uid()) AND user_id = auth.uid());
CREATE POLICY "Users can delete own activities" ON activities FOR DELETE USING (org_id = get_user_org_id(auth.uid()) AND user_id = auth.uid());

-- Files
CREATE POLICY "Users can read files" ON files FOR SELECT USING (org_id = get_user_org_id(auth.uid()));
CREATE POLICY "Users can insert files" ON files FOR INSERT WITH CHECK (org_id = get_user_org_id(auth.uid()) AND user_id = auth.uid());
CREATE POLICY "Users can update own files" ON files FOR UPDATE USING (org_id = get_user_org_id(auth.uid()) AND user_id = auth.uid());
CREATE POLICY "Users can delete own files" ON files FOR DELETE USING (org_id = get_user_org_id(auth.uid()) AND user_id = auth.uid());

-- Pricebooks
CREATE POLICY "Users can read pricebooks" ON pricebooks FOR SELECT USING (org_id = get_user_org_id(auth.uid()));
CREATE POLICY "Admins can insert pricebooks" ON pricebooks FOR INSERT WITH CHECK (org_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));
CREATE POLICY "Admins can update pricebooks" ON pricebooks FOR UPDATE USING (org_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));
CREATE POLICY "Admins can delete pricebooks" ON pricebooks FOR DELETE USING (org_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

-- Pricebook Items
CREATE POLICY "Users can read pricebook items" ON pricebook_items FOR SELECT USING (org_id = get_user_org_id(auth.uid()));
CREATE POLICY "Admins can insert pricebook items" ON pricebook_items FOR INSERT WITH CHECK (org_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));
CREATE POLICY "Admins can update pricebook items" ON pricebook_items FOR UPDATE USING (org_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));
CREATE POLICY "Admins can delete pricebook items" ON pricebook_items FOR DELETE USING (org_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

-- Estimates
CREATE POLICY "Users can read estimates" ON estimates FOR SELECT USING (org_id = get_user_org_id(auth.uid()));
CREATE POLICY "Users can insert estimates" ON estimates FOR INSERT WITH CHECK (org_id = get_user_org_id(auth.uid()));
CREATE POLICY "Users can update estimates" ON estimates FOR UPDATE USING (org_id = get_user_org_id(auth.uid()));
CREATE POLICY "Admins can delete estimates" ON estimates FOR DELETE USING (org_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

-- Estimate Lines
CREATE POLICY "Users can read estimate lines" ON estimate_lines FOR SELECT USING (org_id = get_user_org_id(auth.uid()));
CREATE POLICY "Users can insert estimate lines" ON estimate_lines FOR INSERT WITH CHECK (org_id = get_user_org_id(auth.uid()));
CREATE POLICY "Users can update estimate lines" ON estimate_lines FOR UPDATE USING (org_id = get_user_org_id(auth.uid()));
CREATE POLICY "Users can delete estimate lines" ON estimate_lines FOR DELETE USING (org_id = get_user_org_id(auth.uid()));

-- Notifications
CREATE POLICY "Users can read notifications" ON notifications FOR SELECT USING (org_id = get_user_org_id(auth.uid()));
CREATE POLICY "Users can insert notifications" ON notifications FOR INSERT WITH CHECK (org_id = get_user_org_id(auth.uid()));
CREATE POLICY "Users can update own notifications" ON notifications FOR UPDATE USING (recipient_user_id = auth.uid());

-- Contracts
CREATE POLICY "Users can read contracts" ON contracts FOR SELECT USING (org_id = get_user_org_id(auth.uid()));
CREATE POLICY "Users can insert contracts" ON contracts FOR INSERT WITH CHECK (org_id = get_user_org_id(auth.uid()));
CREATE POLICY "Users can update contracts" ON contracts FOR UPDATE USING (org_id = get_user_org_id(auth.uid()));

-- Contract Templates
CREATE POLICY "Users can read contract templates" ON contract_templates FOR SELECT USING (org_id = get_user_org_id(auth.uid()));
CREATE POLICY "Admins can insert contract templates" ON contract_templates FOR INSERT WITH CHECK (org_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));
CREATE POLICY "Admins can update contract templates" ON contract_templates FOR UPDATE USING (org_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

-- Contract Signatures
CREATE POLICY "Users can read contract signatures" ON contract_signatures FOR SELECT USING (org_id = get_user_org_id(auth.uid()));
CREATE POLICY "Users can insert contract signatures" ON contract_signatures FOR INSERT WITH CHECK (org_id = get_user_org_id(auth.uid()));
CREATE POLICY "Users can update contract signatures" ON contract_signatures FOR UPDATE USING (org_id = get_user_org_id(auth.uid()));

-- Team Closer Queue
CREATE POLICY "Users can view closer queue" ON team_closer_queue FOR SELECT USING (org_id = get_user_org_id(auth.uid()));
CREATE POLICY "Admins can manage closer queue" ON team_closer_queue FOR ALL USING (org_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

-- User Google Tokens
CREATE POLICY "Users can manage own tokens" ON user_google_tokens FOR ALL USING (user_id = auth.uid());

-- Scheduled Appointments
CREATE POLICY "Users can view appointments" ON scheduled_appointments FOR SELECT USING (org_id = get_user_org_id(auth.uid()));
CREATE POLICY "Users can create appointments" ON scheduled_appointments FOR INSERT WITH CHECK (org_id = get_user_org_id(auth.uid()));
CREATE POLICY "Users can update appointments" ON scheduled_appointments FOR UPDATE USING (org_id = get_user_org_id(auth.uid()));

-- Custom Roles
CREATE POLICY "Users can view roles" ON custom_roles FOR SELECT USING (org_id = get_user_org_id(auth.uid()));
CREATE POLICY "Admins can manage roles" ON custom_roles FOR ALL USING (org_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

-- Permissions
CREATE POLICY "Authenticated can view permissions" ON permissions FOR SELECT USING (auth.uid() IS NOT NULL);

-- Role Permissions
CREATE POLICY "Users can view role permissions" ON role_permissions FOR SELECT USING (
  EXISTS (SELECT 1 FROM custom_roles cr WHERE cr.id = role_permissions.role_id AND cr.org_id = get_user_org_id(auth.uid()))
);
CREATE POLICY "Admins can manage role permissions" ON role_permissions FOR ALL USING (
  EXISTS (SELECT 1 FROM custom_roles cr WHERE cr.id = role_permissions.role_id AND cr.org_id = get_user_org_id(auth.uid()))
  AND is_admin_or_manager(auth.uid())
);

-- User Permissions
CREATE POLICY "Users can view own permissions" ON user_permissions FOR SELECT USING (user_id = auth.uid() OR org_id = get_user_org_id(auth.uid()));
CREATE POLICY "Admins can manage user permissions" ON user_permissions FOR ALL USING (org_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

-- Permission Presets
CREATE POLICY "Users can view presets" ON permission_presets FOR SELECT USING (org_id = get_user_org_id(auth.uid()));
CREATE POLICY "Admins can manage presets" ON permission_presets FOR ALL USING (org_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

-- Preset Permissions
CREATE POLICY "Users can view preset permissions" ON preset_permissions FOR SELECT USING (
  EXISTS (SELECT 1 FROM permission_presets pp WHERE pp.id = preset_permissions.preset_id AND pp.org_id = get_user_org_id(auth.uid()))
);
CREATE POLICY "Admins can manage preset permissions" ON preset_permissions FOR ALL USING (
  EXISTS (SELECT 1 FROM permission_presets pp WHERE pp.id = preset_permissions.preset_id AND pp.org_id = get_user_org_id(auth.uid()))
  AND is_admin_or_manager(auth.uid())
);

-- Campaigns
CREATE POLICY "Users can view campaigns" ON campaigns FOR SELECT USING (org_id = get_user_org_id(auth.uid()));
CREATE POLICY "Admins can manage campaigns" ON campaigns FOR ALL USING (org_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

-- Lead Sources
CREATE POLICY "Users can view lead sources" ON lead_sources FOR SELECT USING (org_id = get_user_org_id(auth.uid()));
CREATE POLICY "Admins can manage lead sources" ON lead_sources FOR ALL USING (org_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

-- Job Files
CREATE POLICY "Users can view job files" ON job_files FOR SELECT USING (org_id = get_user_org_id(auth.uid()));
CREATE POLICY "Users can create job files" ON job_files FOR INSERT WITH CHECK (org_id = get_user_org_id(auth.uid()));
CREATE POLICY "Users can update job files" ON job_files FOR UPDATE USING (org_id = get_user_org_id(auth.uid()));
CREATE POLICY "Admins can delete job files" ON job_files FOR DELETE USING (org_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

-- ============================================================
-- STORAGE BUCKETS
-- ============================================================

INSERT INTO storage.buckets (id, name, public) VALUES ('files', 'files', false) ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('job-files', 'job-files', false, 52428800, ARRAY['application/pdf', 'image/png', 'image/jpeg'])
ON CONFLICT (id) DO UPDATE SET file_size_limit = 52428800, allowed_mime_types = ARRAY['application/pdf', 'image/png', 'image/jpeg'];

-- Storage policies for files bucket
CREATE POLICY "Users can read files storage" ON storage.objects FOR SELECT
  USING (bucket_id = 'files' AND (storage.foldername(name))[1] = 'org' AND (storage.foldername(name))[2] = get_user_org_id(auth.uid())::text);
CREATE POLICY "Users can upload files storage" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'files' AND (storage.foldername(name))[1] = 'org' AND (storage.foldername(name))[2] = get_user_org_id(auth.uid())::text);
CREATE POLICY "Users can update files storage" ON storage.objects FOR UPDATE
  USING (bucket_id = 'files' AND (storage.foldername(name))[1] = 'org' AND (storage.foldername(name))[2] = get_user_org_id(auth.uid())::text);
CREATE POLICY "Users can delete files storage" ON storage.objects FOR DELETE
  USING (bucket_id = 'files' AND (storage.foldername(name))[1] = 'org' AND (storage.foldername(name))[2] = get_user_org_id(auth.uid())::text);

-- Storage policies for job-files bucket
CREATE POLICY "Users can read job files storage" ON storage.objects FOR SELECT
  USING (bucket_id = 'job-files' AND (storage.foldername(name))[1] = 'orgs' AND (storage.foldername(name))[2] = get_user_org_id(auth.uid())::text);
CREATE POLICY "Users can upload job files storage" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'job-files' AND (storage.foldername(name))[1] = 'orgs' AND (storage.foldername(name))[2] = get_user_org_id(auth.uid())::text);
CREATE POLICY "Users can update job files storage" ON storage.objects FOR UPDATE
  USING (bucket_id = 'job-files' AND (storage.foldername(name))[1] = 'orgs' AND (storage.foldername(name))[2] = get_user_org_id(auth.uid())::text);
CREATE POLICY "Admins can delete job files storage" ON storage.objects FOR DELETE
  USING (bucket_id = 'job-files' AND (storage.foldername(name))[1] = 'orgs' AND (storage.foldername(name))[2] = get_user_org_id(auth.uid())::text AND is_admin_or_manager(auth.uid()));

-- ============================================================
-- INSERT DEFAULT PERMISSIONS
-- ============================================================

INSERT INTO permissions (name, display_name, description, category) VALUES
('canvass:view', 'View Canvass Map', 'Access the canvassing map interface', 'Canvassing'),
('canvass:create', 'Create Canvass Pins', 'Drop new pins on the canvass map', 'Canvassing'),
('canvass:edit', 'Edit Canvass Pins', 'Modify existing canvass pins', 'Canvassing'),
('canvass:delete', 'Delete Canvass Pins', 'Remove canvass pins', 'Canvassing'),
('canvass:import', 'Import Leads CSV', 'Bulk import leads from CSV', 'Canvassing'),
('canvass:export', 'Export Leads CSV', 'Export leads to CSV', 'Canvassing'),
('leads:view', 'View Leads', 'Access lead records', 'Leads'),
('leads:create', 'Create Leads', 'Create new lead records', 'Leads'),
('leads:edit', 'Edit Leads', 'Modify lead information', 'Leads'),
('leads:delete', 'Delete Leads', 'Remove lead records', 'Leads'),
('leads:assign', 'Assign Leads', 'Assign leads to other users', 'Leads'),
('leads:view_inbound', 'View Inbound Leads', 'Access leads from website, ads, and other inbound sources', 'Leads'),
('leads:manage_inbound', 'Manage Inbound Leads', 'Assign and manage inbound lead queue', 'Leads'),
('leads:claim_inbound', 'Claim Inbound Leads', 'Claim leads from the inbound queue', 'Leads'),
('opportunities:view', 'View Opportunities', 'Access opportunity records', 'Opportunities'),
('opportunities:edit', 'Edit Opportunities', 'Modify opportunity information', 'Opportunities'),
('opportunities:delete', 'Delete Opportunities', 'Remove opportunity records', 'Opportunities'),
('proposals:view', 'View Proposals', 'Access proposal documents', 'Proposals'),
('proposals:create', 'Create Proposals', 'Generate new proposals', 'Proposals'),
('proposals:edit', 'Edit Proposals', 'Modify proposal content', 'Proposals'),
('proposals:send', 'Send Proposals', 'Send proposals to customers', 'Proposals'),
('contracts:view', 'View Contracts', 'Access contract documents', 'Contracts'),
('contracts:create', 'Create Contracts', 'Generate new contracts', 'Contracts'),
('contracts:send', 'Send Contracts', 'Send contracts for signature', 'Contracts'),
('projects:view', 'View Projects', 'Access project records', 'Projects'),
('projects:edit', 'Edit Projects', 'Modify project information', 'Projects'),
('projects:delete', 'Delete Projects', 'Remove project records', 'Projects'),
('projects:complete', 'Complete Projects', 'Mark projects as complete', 'Projects'),
('reports:view_own', 'View Own Reports', 'See personal performance metrics', 'Reports'),
('reports:view_team', 'View Team Reports', 'See team performance metrics', 'Reports'),
('reports:view_region', 'View Region Reports', 'See regional performance metrics', 'Reports'),
('reports:view_all', 'View All Reports', 'See organization-wide metrics', 'Reports'),
('reports:export', 'Export Reports', 'Download reports as Excel/CSV', 'Reports'),
('reports:create', 'Create Custom Reports', 'Build custom report templates', 'Reports'),
('teams:view', 'View Teams', 'See team information', 'Teams'),
('teams:create', 'Create Teams', 'Create new teams', 'Teams'),
('teams:edit', 'Edit Teams', 'Modify team settings', 'Teams'),
('teams:delete', 'Delete Teams', 'Remove teams', 'Teams'),
('teams:manage_members', 'Manage Team Members', 'Add/remove team members', 'Teams'),
('regions:view', 'View Regions', 'See region information', 'Regions'),
('regions:create', 'Create Regions', 'Create new regions', 'Regions'),
('regions:edit', 'Edit Regions', 'Modify region settings', 'Regions'),
('regions:delete', 'Delete Regions', 'Remove regions', 'Regions'),
('users:view', 'View Users', 'See user profiles', 'Users'),
('users:create', 'Create Users', 'Add new user accounts', 'Users'),
('users:edit', 'Edit Users', 'Modify user information', 'Users'),
('users:edit_roles', 'Edit User Roles', 'Change user role assignments', 'Users'),
('users:deactivate', 'Deactivate Users', 'Disable user accounts', 'Users'),
('users:manage_team', 'Manage Team Users', 'Manage users in own team', 'Users'),
('users:manage_region', 'Manage Region Users', 'Manage users in own region', 'Users'),
('users:manage_all', 'Manage All Users', 'Full user management access', 'Users'),
('scheduling:view', 'View Schedule', 'See appointment calendar', 'Scheduling'),
('scheduling:create', 'Create Appointments', 'Schedule new appointments', 'Scheduling'),
('scheduling:edit', 'Edit Appointments', 'Modify appointments', 'Scheduling'),
('scheduling:manage_team', 'Manage Team Schedule', 'Configure team scheduling', 'Scheduling'),
('scheduling:manage_region', 'Manage Region Schedule', 'Configure regional scheduling', 'Scheduling'),
('scheduling:manage_queue', 'Manage Closer Queue', 'Configure round-robin queue', 'Scheduling'),
('pricebook:view', 'View Pricebook', 'Access pricing information', 'Pricebook'),
('pricebook:edit', 'Edit Pricebook', 'Modify pricing and items', 'Pricebook'),
('campaigns:view', 'View Campaigns', 'See marketing campaign data', 'Campaigns'),
('campaigns:create', 'Create Campaigns', 'Create new marketing campaigns', 'Campaigns'),
('campaigns:edit', 'Edit Campaigns', 'Modify campaign settings', 'Campaigns'),
('campaigns:delete', 'Delete Campaigns', 'Remove campaigns', 'Campaigns'),
('campaigns:view_reports', 'View Campaign Reports', 'Access campaign performance reports', 'Campaigns'),
('lead_sources:view', 'View Lead Sources', 'See lead source configurations', 'Leads'),
('lead_sources:manage', 'Manage Lead Sources', 'Configure webhook endpoints and field mappings', 'Leads'),
('admin:access', 'Access Admin Panel', 'Enter admin settings area', 'Admin'),
('admin:roles', 'Manage Roles', 'Create and edit roles', 'Admin'),
('admin:permissions', 'Manage Permissions', 'Assign permissions to roles', 'Admin'),
('admin:settings', 'Manage Settings', 'Configure system settings', 'Admin'),
('admin:full', 'Full Admin Access', 'Complete administrative control', 'Admin')
ON CONFLICT (name) DO NOTHING;

-- ============================================================
-- DONE! Database initialized successfully.
-- ============================================================
