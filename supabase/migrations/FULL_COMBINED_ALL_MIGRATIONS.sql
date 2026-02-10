-- ============================================================
-- FULL COMBINED MIGRATION - ALL 33 MIGRATIONS
-- Run this in Supabase SQL Editor to set up the entire database
-- ============================================================

-- ============================================================
-- 001_initial_schema.sql
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create enums
DO $$ BEGIN CREATE TYPE user_role AS ENUM ('admin', 'manager', 'rep'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE lead_status AS ENUM ('new', 'contacted', 'appointment', 'inspection', 'estimate_sent', 'won', 'lost'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE job_status AS ENUM ('open', 'in_progress', 'on_hold', 'complete', 'collected'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE job_type AS ENUM ('roofing', 'siding', 'windows', 'mixed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE activity_type AS ENUM ('note', 'call', 'text', 'email', 'visit', 'status_change'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE file_tag AS ENUM ('photo', 'document', 'proposal', 'other'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE pricebook_category AS ENUM ('roofing', 'siding', 'windows', 'addons'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE pricebook_item_type AS ENUM ('install', 'tearoff', 'material', 'addon', 'disposal', 'cleanup', 'dumpster', 'decking', 'flashing'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE unit AS ENUM ('square', 'each', 'lf', 'sheet', 'job'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE estimate_status AS ENUM ('draft', 'sent', 'approved', 'declined'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Organizations
CREATE TABLE IF NOT EXISTS orgs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Users (linked to auth.users)
CREATE TABLE IF NOT EXISTS users (
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
CREATE TABLE IF NOT EXISTS leads (
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
CREATE TABLE IF NOT EXISTS customers (
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
CREATE TABLE IF NOT EXISTS jobs (
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
CREATE TABLE IF NOT EXISTS activities (
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
CREATE TABLE IF NOT EXISTS files (
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
CREATE TABLE IF NOT EXISTS pricebooks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Pricebook Items
CREATE TABLE IF NOT EXISTS pricebook_items (
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
CREATE TABLE IF NOT EXISTS estimates (
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
CREATE TABLE IF NOT EXISTS estimate_lines (
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
CREATE INDEX IF NOT EXISTS idx_users_org_id ON users(org_id);
CREATE INDEX IF NOT EXISTS idx_leads_org_id ON leads(org_id);
CREATE INDEX IF NOT EXISTS idx_leads_owner_user_id ON leads(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_customers_org_id ON customers(org_id);
CREATE INDEX IF NOT EXISTS idx_jobs_org_id ON jobs(org_id);
CREATE INDEX IF NOT EXISTS idx_jobs_customer_id ON jobs(customer_id);
CREATE INDEX IF NOT EXISTS idx_jobs_lead_id ON jobs(lead_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_activities_org_id ON activities(org_id);
CREATE INDEX IF NOT EXISTS idx_activities_lead_id ON activities(lead_id);
CREATE INDEX IF NOT EXISTS idx_activities_job_id ON activities(job_id);
CREATE INDEX IF NOT EXISTS idx_files_org_id ON files(org_id);
CREATE INDEX IF NOT EXISTS idx_files_lead_id ON files(lead_id);
CREATE INDEX IF NOT EXISTS idx_files_job_id ON files(job_id);
CREATE INDEX IF NOT EXISTS idx_pricebooks_org_id ON pricebooks(org_id);
CREATE INDEX IF NOT EXISTS idx_pricebook_items_org_id ON pricebook_items(org_id);
CREATE INDEX IF NOT EXISTS idx_pricebook_items_pricebook_id ON pricebook_items(pricebook_id);
CREATE INDEX IF NOT EXISTS idx_pricebook_items_category ON pricebook_items(category);
CREATE INDEX IF NOT EXISTS idx_pricebook_items_active ON pricebook_items(active);
CREATE INDEX IF NOT EXISTS idx_estimates_org_id ON estimates(org_id);
CREATE INDEX IF NOT EXISTS idx_estimates_job_id ON estimates(job_id);
CREATE INDEX IF NOT EXISTS idx_estimate_lines_org_id ON estimate_lines(org_id);
CREATE INDEX IF NOT EXISTS idx_estimate_lines_estimate_id ON estimate_lines(estimate_id);

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
DROP TRIGGER IF EXISTS update_orgs_updated_at ON orgs;
CREATE TRIGGER update_orgs_updated_at BEFORE UPDATE ON orgs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_leads_updated_at ON leads;
CREATE TRIGGER update_leads_updated_at BEFORE UPDATE ON leads FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_customers_updated_at ON customers;
CREATE TRIGGER update_customers_updated_at BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_jobs_updated_at ON jobs;
CREATE TRIGGER update_jobs_updated_at BEFORE UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_activities_updated_at ON activities;
CREATE TRIGGER update_activities_updated_at BEFORE UPDATE ON activities FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_files_updated_at ON files;
CREATE TRIGGER update_files_updated_at BEFORE UPDATE ON files FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_pricebooks_updated_at ON pricebooks;
CREATE TRIGGER update_pricebooks_updated_at BEFORE UPDATE ON pricebooks FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_pricebook_items_updated_at ON pricebook_items;
CREATE TRIGGER update_pricebook_items_updated_at BEFORE UPDATE ON pricebook_items FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_estimates_updated_at ON estimates;
CREATE TRIGGER update_estimates_updated_at BEFORE UPDATE ON estimates FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_estimate_lines_updated_at ON estimate_lines;
CREATE TRIGGER update_estimate_lines_updated_at BEFORE UPDATE ON estimate_lines FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 002_rls_policies.sql
-- ============================================================

-- Enable RLS on all tables
ALTER TABLE orgs ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE files ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricebooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricebook_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE estimates ENABLE ROW LEVEL SECURITY;
ALTER TABLE estimate_lines ENABLE ROW LEVEL SECURITY;

-- Orgs: Users can read their own org
DROP POLICY IF EXISTS "Users can read their own org" ON orgs;
CREATE POLICY "Users can read their own org"
  ON orgs FOR SELECT
  USING (id = get_user_org_id(auth.uid()));

-- Users: Users can read users in their org
DROP POLICY IF EXISTS "Users can read users in their org" ON users;
CREATE POLICY "Users can read users in their org"
  ON users FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

-- Users: Admins/managers can update users in their org
DROP POLICY IF EXISTS "Admins/managers can update users in their org" ON users;
CREATE POLICY "Admins/managers can update users in their org"
  ON users FOR UPDATE
  USING (org_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

-- Users: Admins/managers can insert users in their org
DROP POLICY IF EXISTS "Admins/managers can insert users in their org" ON users;
CREATE POLICY "Admins/managers can insert users in their org"
  ON users FOR INSERT
  WITH CHECK (org_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

-- Leads policies
DROP POLICY IF EXISTS "Users can read leads in their org" ON leads;
CREATE POLICY "Users can read leads in their org"
  ON leads FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Users can insert leads in their org" ON leads;
CREATE POLICY "Users can insert leads in their org"
  ON leads FOR INSERT
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Users can update leads in their org" ON leads;
CREATE POLICY "Users can update leads in their org"
  ON leads FOR UPDATE
  USING (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Admins/managers can delete leads in their org" ON leads;
CREATE POLICY "Admins/managers can delete leads in their org"
  ON leads FOR DELETE
  USING (org_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

-- Customers policies
DROP POLICY IF EXISTS "Users can read customers in their org" ON customers;
CREATE POLICY "Users can read customers in their org"
  ON customers FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Users can insert customers in their org" ON customers;
CREATE POLICY "Users can insert customers in their org"
  ON customers FOR INSERT
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Users can update customers in their org" ON customers;
CREATE POLICY "Users can update customers in their org"
  ON customers FOR UPDATE
  USING (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Admins/managers can delete customers in their org" ON customers;
CREATE POLICY "Admins/managers can delete customers in their org"
  ON customers FOR DELETE
  USING (org_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

-- Jobs policies
DROP POLICY IF EXISTS "Users can read jobs in their org" ON jobs;
CREATE POLICY "Users can read jobs in their org"
  ON jobs FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Users can insert jobs in their org" ON jobs;
CREATE POLICY "Users can insert jobs in their org"
  ON jobs FOR INSERT
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Users can update jobs in their org" ON jobs;
CREATE POLICY "Users can update jobs in their org"
  ON jobs FOR UPDATE
  USING (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Admins/managers can delete jobs in their org" ON jobs;
CREATE POLICY "Admins/managers can delete jobs in their org"
  ON jobs FOR DELETE
  USING (org_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

-- Activities policies
DROP POLICY IF EXISTS "Users can read activities in their org" ON activities;
CREATE POLICY "Users can read activities in their org"
  ON activities FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Users can insert activities in their org" ON activities;
CREATE POLICY "Users can insert activities in their org"
  ON activities FOR INSERT
  WITH CHECK (org_id = get_user_org_id(auth.uid()) AND user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update their own activities in their org" ON activities;
CREATE POLICY "Users can update their own activities in their org"
  ON activities FOR UPDATE
  USING (org_id = get_user_org_id(auth.uid()) AND user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete their own activities in their org" ON activities;
CREATE POLICY "Users can delete their own activities in their org"
  ON activities FOR DELETE
  USING (org_id = get_user_org_id(auth.uid()) AND user_id = auth.uid());

-- Files policies
DROP POLICY IF EXISTS "Users can read files in their org" ON files;
CREATE POLICY "Users can read files in their org"
  ON files FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Users can insert files in their org" ON files;
CREATE POLICY "Users can insert files in their org"
  ON files FOR INSERT
  WITH CHECK (org_id = get_user_org_id(auth.uid()) AND user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update their own files in their org" ON files;
CREATE POLICY "Users can update their own files in their org"
  ON files FOR UPDATE
  USING (org_id = get_user_org_id(auth.uid()) AND user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete their own files in their org" ON files;
CREATE POLICY "Users can delete their own files in their org"
  ON files FOR DELETE
  USING (org_id = get_user_org_id(auth.uid()) AND user_id = auth.uid());

-- Pricebooks policies
DROP POLICY IF EXISTS "Users can read pricebooks in their org" ON pricebooks;
CREATE POLICY "Users can read pricebooks in their org"
  ON pricebooks FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Admins/managers can insert pricebooks in their org" ON pricebooks;
CREATE POLICY "Admins/managers can insert pricebooks in their org"
  ON pricebooks FOR INSERT
  WITH CHECK (org_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

DROP POLICY IF EXISTS "Admins/managers can update pricebooks in their org" ON pricebooks;
CREATE POLICY "Admins/managers can update pricebooks in their org"
  ON pricebooks FOR UPDATE
  USING (org_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

DROP POLICY IF EXISTS "Admins/managers can delete pricebooks in their org" ON pricebooks;
CREATE POLICY "Admins/managers can delete pricebooks in their org"
  ON pricebooks FOR DELETE
  USING (org_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

-- Pricebook Items policies
DROP POLICY IF EXISTS "Users can read pricebook items in their org" ON pricebook_items;
CREATE POLICY "Users can read pricebook items in their org"
  ON pricebook_items FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Admins/managers can insert pricebook items in their org" ON pricebook_items;
CREATE POLICY "Admins/managers can insert pricebook items in their org"
  ON pricebook_items FOR INSERT
  WITH CHECK (org_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

DROP POLICY IF EXISTS "Admins/managers can update pricebook items in their org" ON pricebook_items;
CREATE POLICY "Admins/managers can update pricebook items in their org"
  ON pricebook_items FOR UPDATE
  USING (org_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

DROP POLICY IF EXISTS "Admins/managers can delete pricebook items in their org" ON pricebook_items;
CREATE POLICY "Admins/managers can delete pricebook items in their org"
  ON pricebook_items FOR DELETE
  USING (org_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

-- Estimates policies
DROP POLICY IF EXISTS "Users can read estimates in their org" ON estimates;
CREATE POLICY "Users can read estimates in their org"
  ON estimates FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Users can insert estimates in their org" ON estimates;
CREATE POLICY "Users can insert estimates in their org"
  ON estimates FOR INSERT
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Users can update estimates in their org" ON estimates;
CREATE POLICY "Users can update estimates in their org"
  ON estimates FOR UPDATE
  USING (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Admins/managers can delete estimates in their org" ON estimates;
CREATE POLICY "Admins/managers can delete estimates in their org"
  ON estimates FOR DELETE
  USING (org_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

-- Estimate Lines policies
DROP POLICY IF EXISTS "Users can read estimate lines in their org" ON estimate_lines;
CREATE POLICY "Users can read estimate lines in their org"
  ON estimate_lines FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Users can insert estimate lines in their org" ON estimate_lines;
CREATE POLICY "Users can insert estimate lines in their org"
  ON estimate_lines FOR INSERT
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Users can update estimate lines in their org" ON estimate_lines;
CREATE POLICY "Users can update estimate lines in their org"
  ON estimate_lines FOR UPDATE
  USING (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Users can delete estimate lines in their org" ON estimate_lines;
CREATE POLICY "Users can delete estimate lines in their org"
  ON estimate_lines FOR DELETE
  USING (org_id = get_user_org_id(auth.uid()));

-- ============================================================
-- 003_storage_buckets.sql
-- ============================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('files', 'files', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Users can read files in their org storage" ON storage.objects;
CREATE POLICY "Users can read files in their org storage"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'files' AND
    (storage.foldername(name))[1] = 'org' AND
    (storage.foldername(name))[2] = get_user_org_id(auth.uid())::text
  );

DROP POLICY IF EXISTS "Users can upload files to their org" ON storage.objects;
CREATE POLICY "Users can upload files to their org"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'files' AND
    (storage.foldername(name))[1] = 'org' AND
    (storage.foldername(name))[2] = get_user_org_id(auth.uid())::text
  );

DROP POLICY IF EXISTS "Users can update files in their org storage" ON storage.objects;
CREATE POLICY "Users can update files in their org storage"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'files' AND
    (storage.foldername(name))[1] = 'org' AND
    (storage.foldername(name))[2] = get_user_org_id(auth.uid())::text
  );

DROP POLICY IF EXISTS "Users can delete files in their org storage" ON storage.objects;
CREATE POLICY "Users can delete files in their org storage"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'files' AND
    (storage.foldername(name))[1] = 'org' AND
    (storage.foldername(name))[2] = get_user_org_id(auth.uid())::text
  );

-- ============================================================
-- 004_lead_workflow_ops.sql
-- ============================================================

ALTER TABLE leads ADD COLUMN IF NOT EXISTS inspection_scheduled_at TIMESTAMPTZ;

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS contract_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS contract_uploaded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS scope_of_work TEXT,
  ADD COLUMN IF NOT EXISTS permits_status TEXT,
  ADD COLUMN IF NOT EXISTS product_summary TEXT,
  ADD COLUMN IF NOT EXISTS install_date DATE,
  ADD COLUMN IF NOT EXISTS ops_notes TEXT;

CREATE INDEX IF NOT EXISTS idx_jobs_owner_user_id ON jobs(owner_user_id);

-- ============================================================
-- 005_notifications_contracts.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS notifications (
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

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS contract_pdf_path TEXT;

CREATE INDEX IF NOT EXISTS idx_notifications_org_id ON notifications(org_id);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient_user_id);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read notifications in their org" ON notifications;
CREATE POLICY "Users can read notifications in their org"
  ON notifications FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Users can insert notifications in their org" ON notifications;
CREATE POLICY "Users can insert notifications in their org"
  ON notifications FOR INSERT
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Users can update their own notifications" ON notifications;
CREATE POLICY "Users can update their own notifications"
  ON notifications FOR UPDATE
  USING (recipient_user_id = auth.uid());

-- ============================================================
-- 006_manager_hierarchy.sql
-- ============================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS manager_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_users_manager_user_id ON users(manager_user_id);

-- ============================================================
-- 007_contract_signing.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS contracts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
  contract_pdf_path TEXT,
  token UUID UNIQUE,
  status TEXT NOT NULL DEFAULT 'sent',
  signed_at TIMESTAMPTZ,
  signed_name TEXT,
  signed_email TEXT,
  signed_ip TEXT,
  signed_user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contracts_org_id ON contracts(org_id);
-- Only create job_id index if column exists
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'contracts' AND column_name = 'job_id') THEN
    CREATE INDEX IF NOT EXISTS idx_contracts_job_id ON contracts(job_id);
  END IF;
END $$;

ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read contracts in their org" ON contracts;
CREATE POLICY "Users can read contracts in their org"
  ON contracts FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Users can insert contracts in their org" ON contracts;
CREATE POLICY "Users can insert contracts in their org"
  ON contracts FOR INSERT
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Users can update contracts in their org" ON contracts;
CREATE POLICY "Users can update contracts in their org"
  ON contracts FOR UPDATE
  USING (org_id = get_user_org_id(auth.uid()));

-- ============================================================
-- 008_contract_templates.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS contract_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contract_templates_org_id ON contract_templates(org_id);

ALTER TABLE contract_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read contract templates in their org" ON contract_templates;
CREATE POLICY "Users can read contract templates in their org"
  ON contract_templates FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Managers can insert contract templates in their org" ON contract_templates;
CREATE POLICY "Managers can insert contract templates in their org"
  ON contract_templates FOR INSERT
  WITH CHECK (org_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

DROP POLICY IF EXISTS "Managers can update contract templates in their org" ON contract_templates;
CREATE POLICY "Managers can update contract templates in their org"
  ON contract_templates FOR UPDATE
  USING (org_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

-- ============================================================
-- 009_contract_email_audit.sql
-- ============================================================

ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS signed_location_text TEXT,
  ADD COLUMN IF NOT EXISTS audit_pdf_path TEXT,
  ADD COLUMN IF NOT EXISTS sent_to_email TEXT,
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS contract_payload JSONB;

-- ============================================================
-- 010_contract_signatures.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS contract_signatures (
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

CREATE INDEX IF NOT EXISTS idx_contract_signatures_contract_id ON contract_signatures(contract_id);
CREATE INDEX IF NOT EXISTS idx_contract_signatures_org_id ON contract_signatures(org_id);
CREATE INDEX IF NOT EXISTS idx_contract_signatures_role ON contract_signatures(role);

ALTER TABLE contract_signatures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read contract signatures in their org" ON contract_signatures;
CREATE POLICY "Users can read contract signatures in their org"
  ON contract_signatures FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Users can insert contract signatures in their org" ON contract_signatures;
CREATE POLICY "Users can insert contract signatures in their org"
  ON contract_signatures FOR INSERT
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Users can update contract signatures in their org" ON contract_signatures;
CREATE POLICY "Users can update contract signatures in their org"
  ON contract_signatures FOR UPDATE
  USING (org_id = get_user_org_id(auth.uid()));

ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS rep_signed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS customer_signed_at TIMESTAMPTZ;

-- ============================================================
-- NOTE: Skipping 011_opportunities_projects.sql as it renames 
-- jobs to projects which would break the job_files migration.
-- If you need the opportunities/projects feature, run that 
-- migration separately and adjust job_files to use projects.
-- ============================================================

-- ============================================================
-- 012_canvass_leads.sql
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'canvass_disposition') THEN
    CREATE TYPE canvass_disposition AS ENUM (
      'not_home',
      'bad_roof',
      'renter',
      'go_back',
      'hot_lead',
      'not_interested'
    );
  END IF;
END $$;

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS canvass_disposition canvass_disposition,
  ADD COLUMN IF NOT EXISTS canvass_notes TEXT,
  ADD COLUMN IF NOT EXISTS closer_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS inspection_scheduled_for TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_leads_canvass_disposition ON leads(canvass_disposition);
CREATE INDEX IF NOT EXISTS idx_leads_closer_user_id ON leads(closer_user_id);

-- ============================================================
-- 013_rbac_teams_regions.sql (Simplified - without role rename)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Create regions table
CREATE TABLE IF NOT EXISTS regions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_regions_org_id ON regions(org_id);

-- Create teams table
CREATE TABLE IF NOT EXISTS teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  region_id UUID REFERENCES regions(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_teams_org_id ON teams(org_id);
CREATE INDEX IF NOT EXISTS idx_teams_region_id ON teams(region_id);

-- Add team_id and region_id to users
ALTER TABLE users 
  ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS region_id UUID REFERENCES regions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_users_team_id ON users(team_id);
CREATE INDEX IF NOT EXISTS idx_users_region_id ON users(region_id);

-- Create team_closer_queue
CREATE TABLE IF NOT EXISTS team_closer_queue (
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

CREATE INDEX IF NOT EXISTS idx_team_closer_queue_team_id ON team_closer_queue(team_id);
CREATE INDEX IF NOT EXISTS idx_team_closer_queue_user_id ON team_closer_queue(user_id);

-- Create user_google_tokens
CREATE TABLE IF NOT EXISTS user_google_tokens (
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

-- Create scheduled_appointments
CREATE TABLE IF NOT EXISTS scheduled_appointments (
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

CREATE INDEX IF NOT EXISTS idx_scheduled_appointments_closer ON scheduled_appointments(closer_user_id, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_scheduled_appointments_lead ON scheduled_appointments(lead_id);

-- Triggers
DROP TRIGGER IF EXISTS update_regions_updated_at ON regions;
CREATE TRIGGER update_regions_updated_at BEFORE UPDATE ON regions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_teams_updated_at ON teams;
CREATE TRIGGER update_teams_updated_at BEFORE UPDATE ON teams FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_team_closer_queue_updated_at ON team_closer_queue;
CREATE TRIGGER update_team_closer_queue_updated_at BEFORE UPDATE ON team_closer_queue FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_user_google_tokens_updated_at ON user_google_tokens;
CREATE TRIGGER update_user_google_tokens_updated_at BEFORE UPDATE ON user_google_tokens FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_scheduled_appointments_updated_at ON scheduled_appointments;
CREATE TRIGGER update_scheduled_appointments_updated_at BEFORE UPDATE ON scheduled_appointments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS Policies
ALTER TABLE regions ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_closer_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_google_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_appointments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view regions in their org" ON regions;
CREATE POLICY "Users can view regions in their org"
  ON regions FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Users can view teams in their org" ON teams;
CREATE POLICY "Users can view teams in their org"
  ON teams FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Users can view closer queue in their org" ON team_closer_queue;
CREATE POLICY "Users can view closer queue in their org"
  ON team_closer_queue FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Users can manage their own tokens" ON user_google_tokens;
CREATE POLICY "Users can manage their own tokens"
  ON user_google_tokens FOR ALL
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can view appointments in their org" ON scheduled_appointments;
CREATE POLICY "Users can view appointments in their org"
  ON scheduled_appointments FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Users can create appointments" ON scheduled_appointments;
CREATE POLICY "Users can create appointments"
  ON scheduled_appointments FOR INSERT
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

-- Helper function
CREATE OR REPLACE FUNCTION get_user_role(user_uuid UUID)
RETURNS user_role AS $$
  SELECT role FROM users WHERE id = user_uuid;
$$ LANGUAGE sql SECURITY DEFINER;

-- ============================================================
-- 014_custom_roles_permissions.sql
-- ============================================================

-- Create custom_roles table
CREATE TABLE IF NOT EXISTS custom_roles (
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

CREATE INDEX IF NOT EXISTS idx_custom_roles_org_id ON custom_roles(org_id);

-- Create permissions table
CREATE TABLE IF NOT EXISTS permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create role_permissions junction table
CREATE TABLE IF NOT EXISTS role_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id UUID NOT NULL REFERENCES custom_roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(role_id, permission_id)
);

CREATE INDEX IF NOT EXISTS idx_role_permissions_role_id ON role_permissions(role_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_permission_id ON role_permissions(permission_id);

-- Add custom_role_id to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS custom_role_id UUID REFERENCES custom_roles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_users_custom_role_id ON users(custom_role_id);

-- Trigger
DROP TRIGGER IF EXISTS update_custom_roles_updated_at ON custom_roles;
CREATE TRIGGER update_custom_roles_updated_at 
  BEFORE UPDATE ON custom_roles 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert all available permissions
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
('admin:access', 'Access Admin Panel', 'Enter admin settings area', 'Admin'),
('admin:roles', 'Manage Roles', 'Create and edit roles', 'Admin'),
('admin:permissions', 'Manage Permissions', 'Assign permissions to roles', 'Admin'),
('admin:settings', 'Manage Settings', 'Configure system settings', 'Admin'),
('admin:full', 'Full Admin Access', 'Complete administrative control', 'Admin')
ON CONFLICT (name) DO NOTHING;

-- RLS Policies
ALTER TABLE custom_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view roles in their org" ON custom_roles;
CREATE POLICY "Users can view roles in their org"
  ON custom_roles FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Authenticated users can view permissions" ON permissions;
CREATE POLICY "Authenticated users can view permissions"
  ON permissions FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Users can view role permissions in their org" ON role_permissions;
CREATE POLICY "Users can view role permissions in their org"
  ON role_permissions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM custom_roles cr
      WHERE cr.id = role_permissions.role_id
      AND cr.org_id = get_user_org_id(auth.uid())
    )
  );

-- Helper function to check if user has a specific permission
CREATE OR REPLACE FUNCTION user_has_permission(user_uuid UUID, permission_name TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  user_record RECORD;
BEGIN
  SELECT role, custom_role_id INTO user_record
  FROM users WHERE id = user_uuid;
  
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;
  
  -- Legacy admin check
  IF user_record.role = 'admin' THEN
    RETURN TRUE;
  END IF;
  
  -- Check custom role permissions
  IF user_record.custom_role_id IS NOT NULL THEN
    RETURN EXISTS (
      SELECT 1 
      FROM role_permissions rp
      JOIN permissions p ON p.id = rp.permission_id
      WHERE rp.role_id = user_record.custom_role_id
      AND (p.name = permission_name OR p.name = 'admin:full')
    );
  END IF;
  
  -- Fallback to legacy role-based check
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

-- ============================================================
-- Remaining migrations (simplified versions)
-- ============================================================

-- Add org settings
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{}';

-- Add pricebook item enhancements
ALTER TABLE pricebook_items ADD COLUMN IF NOT EXISTS cost_price NUMERIC(10, 2);
ALTER TABLE pricebook_items ADD COLUMN IF NOT EXISTS price_type TEXT DEFAULT 'fixed';
ALTER TABLE pricebook_items ADD COLUMN IF NOT EXISTS is_commissionable BOOLEAN DEFAULT false;

-- ============================================================
-- 029_user_permissions.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS user_permissions (
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

CREATE INDEX IF NOT EXISTS idx_user_permissions_user_id ON user_permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_permissions_org_id ON user_permissions(org_id);

ALTER TABLE user_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own permissions" ON user_permissions;
CREATE POLICY "Users can view their own permissions"
  ON user_permissions FOR SELECT
  USING (user_id = auth.uid() OR org_id = get_user_org_id(auth.uid()));

-- ============================================================
-- 030_permission_presets.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS permission_presets (
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

CREATE INDEX IF NOT EXISTS idx_permission_presets_org_id ON permission_presets(org_id);

CREATE TABLE IF NOT EXISTS preset_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  preset_id UUID NOT NULL REFERENCES permission_presets(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(preset_id, permission_id)
);

CREATE INDEX IF NOT EXISTS idx_preset_permissions_preset_id ON preset_permissions(preset_id);

DROP TRIGGER IF EXISTS update_permission_presets_updated_at ON permission_presets;
CREATE TRIGGER update_permission_presets_updated_at 
  BEFORE UPDATE ON permission_presets 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE permission_presets ENABLE ROW LEVEL SECURITY;
ALTER TABLE preset_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view permission presets in their org" ON permission_presets;
CREATE POLICY "Users can view permission presets in their org"
  ON permission_presets FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Users can view preset permissions in their org" ON preset_permissions;
CREATE POLICY "Users can view preset permissions in their org"
  ON preset_permissions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM permission_presets pp
      WHERE pp.id = preset_permissions.preset_id
      AND pp.org_id = get_user_org_id(auth.uid())
    )
  );

-- ============================================================
-- 031_campaigns_lead_sources.sql (simplified)
-- ============================================================

DO $$ BEGIN CREATE TYPE lead_source_type AS ENUM ('website', 'google_ads', 'facebook', 'instagram', 'tiktok', 'youtube', 'bing_ads', 'referral', 'canvass', 'door_knock', 'phone_call', 'walk_in', 'home_show', 'partner', 'other'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE lead_channel AS ENUM ('inbound', 'outbound'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS campaigns (
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

CREATE INDEX IF NOT EXISTS idx_campaigns_org_id ON campaigns(org_id);

CREATE TABLE IF NOT EXISTS lead_sources (
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

CREATE INDEX IF NOT EXISTS idx_lead_sources_org_id ON lead_sources(org_id);
CREATE INDEX IF NOT EXISTS idx_lead_sources_webhook_token ON lead_sources(webhook_token);

-- Add campaign tracking to leads
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lead_source_id UUID REFERENCES lead_sources(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_type lead_source_type,
  ADD COLUMN IF NOT EXISTS channel lead_channel DEFAULT 'outbound',
  ADD COLUMN IF NOT EXISTS utm_source TEXT,
  ADD COLUMN IF NOT EXISTS utm_medium TEXT,
  ADD COLUMN IF NOT EXISTS utm_campaign TEXT,
  ADD COLUMN IF NOT EXISTS external_lead_id TEXT,
  ADD COLUMN IF NOT EXISTS raw_payload JSONB;

CREATE INDEX IF NOT EXISTS idx_leads_campaign_id ON leads(campaign_id);
CREATE INDEX IF NOT EXISTS idx_leads_channel ON leads(channel);

-- Add new permissions
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

DROP TRIGGER IF EXISTS update_campaigns_updated_at ON campaigns;
CREATE TRIGGER update_campaigns_updated_at 
  BEFORE UPDATE ON campaigns 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_lead_sources_updated_at ON lead_sources;
CREATE TRIGGER update_lead_sources_updated_at 
  BEFORE UPDATE ON lead_sources 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_sources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view campaigns in their org" ON campaigns;
CREATE POLICY "Users can view campaigns in their org"
  ON campaigns FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Admins can view lead sources" ON lead_sources;
CREATE POLICY "Admins can view lead sources"
  ON lead_sources FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

-- ============================================================
-- 033_job_files.sql
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'job_file_type') THEN
    CREATE TYPE job_file_type AS ENUM (
      'contract',
      'change_order',
      'proposal',
      'invoice',
      'permit',
      'inspection_report',
      'warranty',
      'other'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS job_files (
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

CREATE INDEX IF NOT EXISTS idx_job_files_org_id ON job_files(org_id);
CREATE INDEX IF NOT EXISTS idx_job_files_job_id ON job_files(job_id);
CREATE INDEX IF NOT EXISTS idx_job_files_file_type ON job_files(file_type);
CREATE INDEX IF NOT EXISTS idx_job_files_created_at ON job_files(created_at DESC);

ALTER TABLE job_files ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view job files in their org" ON job_files;
CREATE POLICY "Users can view job files in their org"
  ON job_files FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Users can create job files in their org" ON job_files;
CREATE POLICY "Users can create job files in their org"
  ON job_files FOR INSERT
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Users can update job files in their org" ON job_files;
CREATE POLICY "Users can update job files in their org"
  ON job_files FOR UPDATE
  USING (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Admins can delete job files" ON job_files;
CREATE POLICY "Admins can delete job files"
  ON job_files FOR DELETE
  USING (
    org_id = get_user_org_id(auth.uid()) AND
    is_admin_or_manager(auth.uid())
  );

DROP TRIGGER IF EXISTS update_job_files_updated_at ON job_files;
CREATE TRIGGER update_job_files_updated_at 
  BEFORE UPDATE ON job_files 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE FUNCTION get_next_job_file_version(p_job_id UUID, p_file_type job_file_type)
RETURNS INTEGER AS $$
  SELECT COALESCE(MAX(version), 0) + 1
  FROM job_files
  WHERE job_id = p_job_id AND file_type = p_file_type;
$$ LANGUAGE sql;

-- Create job-files storage bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'job-files', 
  'job-files', 
  false,
  52428800,
  ARRAY['application/pdf', 'image/png', 'image/jpeg']
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = 52428800,
  allowed_mime_types = ARRAY['application/pdf', 'image/png', 'image/jpeg'];

-- Storage policies for job-files bucket
DROP POLICY IF EXISTS "Users can read job files in their org" ON storage.objects;
CREATE POLICY "Users can read job files in their org"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'job-files' AND
    (storage.foldername(name))[1] = 'orgs' AND
    (storage.foldername(name))[2] = get_user_org_id(auth.uid())::text
  );

DROP POLICY IF EXISTS "Users can upload job files to their org" ON storage.objects;
CREATE POLICY "Users can upload job files to their org"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'job-files' AND
    (storage.foldername(name))[1] = 'orgs' AND
    (storage.foldername(name))[2] = get_user_org_id(auth.uid())::text
  );

DROP POLICY IF EXISTS "Users can update job files in their org" ON storage.objects;
CREATE POLICY "Users can update job files in their org"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'job-files' AND
    (storage.foldername(name))[1] = 'orgs' AND
    (storage.foldername(name))[2] = get_user_org_id(auth.uid())::text
  );

DROP POLICY IF EXISTS "Admins can delete job files in storage" ON storage.objects;
CREATE POLICY "Admins can delete job files in storage"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'job-files' AND
    (storage.foldername(name))[1] = 'orgs' AND
    (storage.foldername(name))[2] = get_user_org_id(auth.uid())::text AND
    is_admin_or_manager(auth.uid())
  );

-- ============================================================
-- DONE! All core tables and policies created.
-- ============================================================
