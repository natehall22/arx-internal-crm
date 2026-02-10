-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create enums
CREATE TYPE user_role AS ENUM ('admin', 'manager', 'rep');
CREATE TYPE lead_status AS ENUM ('new', 'contacted', 'appointment', 'inspection', 'estimate_sent', 'won', 'lost');
CREATE TYPE job_status AS ENUM ('open', 'in_progress', 'on_hold', 'complete', 'collected');
CREATE TYPE job_type AS ENUM ('roofing', 'siding', 'windows', 'mixed');
CREATE TYPE activity_type AS ENUM ('note', 'call', 'text', 'email', 'visit', 'status_change');
CREATE TYPE file_tag AS ENUM ('photo', 'document', 'proposal', 'other');
CREATE TYPE pricebook_category AS ENUM ('roofing', 'siding', 'windows', 'addons');
CREATE TYPE pricebook_item_type AS ENUM ('install', 'tearoff', 'material', 'addon', 'disposal', 'cleanup', 'dumpster', 'decking', 'flashing');
CREATE TYPE unit AS ENUM ('square', 'each', 'lf', 'sheet', 'job');
CREATE TYPE estimate_status AS ENUM ('draft', 'sent', 'approved', 'declined');

-- Organizations
CREATE TABLE orgs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Users (linked to auth.users)
CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  role user_role NOT NULL DEFAULT 'rep',
  full_name TEXT,
  phone TEXT,
  email TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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

-- Jobs
CREATE TABLE jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
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
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((lead_id IS NOT NULL) OR (job_id IS NOT NULL))
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
  is_labor BOOLEAN NOT NULL DEFAULT false,
  is_taxable BOOLEAN NOT NULL DEFAULT true,
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

-- Indexes for performance
CREATE INDEX idx_users_org_id ON users(org_id);
CREATE INDEX idx_leads_org_id ON leads(org_id);
CREATE INDEX idx_leads_owner_user_id ON leads(owner_user_id);
CREATE INDEX idx_leads_status ON leads(status);
CREATE INDEX idx_customers_org_id ON customers(org_id);
CREATE INDEX idx_jobs_org_id ON jobs(org_id);
CREATE INDEX idx_jobs_customer_id ON jobs(customer_id);
CREATE INDEX idx_jobs_lead_id ON jobs(lead_id);
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_activities_org_id ON activities(org_id);
CREATE INDEX idx_activities_lead_id ON activities(lead_id);
CREATE INDEX idx_activities_job_id ON activities(job_id);
CREATE INDEX idx_files_org_id ON files(org_id);
CREATE INDEX idx_files_lead_id ON files(lead_id);
CREATE INDEX idx_files_job_id ON files(job_id);
CREATE INDEX idx_pricebooks_org_id ON pricebooks(org_id);
CREATE INDEX idx_pricebook_items_org_id ON pricebook_items(org_id);
CREATE INDEX idx_pricebook_items_pricebook_id ON pricebook_items(pricebook_id);
CREATE INDEX idx_pricebook_items_category ON pricebook_items(category);
CREATE INDEX idx_pricebook_items_active ON pricebook_items(active);
CREATE INDEX idx_estimates_org_id ON estimates(org_id);
CREATE INDEX idx_estimates_job_id ON estimates(job_id);
CREATE INDEX idx_estimate_lines_org_id ON estimate_lines(org_id);
CREATE INDEX idx_estimate_lines_estimate_id ON estimate_lines(estimate_id);

-- Function to get user's org_id
CREATE OR REPLACE FUNCTION get_user_org_id(user_uuid UUID)
RETURNS UUID AS $$
  SELECT org_id FROM users WHERE id = user_uuid;
$$ LANGUAGE sql SECURITY DEFINER;

-- Function to check if user is admin or manager
CREATE OR REPLACE FUNCTION is_admin_or_manager(user_uuid UUID)
RETURNS BOOLEAN AS $$
  SELECT role IN ('admin', 'manager') FROM users WHERE id = user_uuid;
$$ LANGUAGE sql SECURITY DEFINER;

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at triggers
CREATE TRIGGER update_orgs_updated_at BEFORE UPDATE ON orgs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_leads_updated_at BEFORE UPDATE ON leads FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_customers_updated_at BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_jobs_updated_at BEFORE UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_activities_updated_at BEFORE UPDATE ON activities FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_files_updated_at BEFORE UPDATE ON files FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_pricebooks_updated_at BEFORE UPDATE ON pricebooks FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_pricebook_items_updated_at BEFORE UPDATE ON pricebook_items FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_estimates_updated_at BEFORE UPDATE ON estimates FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_estimate_lines_updated_at BEFORE UPDATE ON estimate_lines FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
