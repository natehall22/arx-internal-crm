-- ============================================
-- OPERATIONS / PRODUCTION TABLES
-- Run this migration to add crews and production_jobs tables
-- ============================================

-- Sub-Contractors table (if not exists)
CREATE TABLE IF NOT EXISTS sub_contractors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  company_name TEXT NOT NULL,
  contact_name TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  license_number TEXT,
  insurance_expiry DATE,
  w9_on_file BOOLEAN NOT NULL DEFAULT false,
  services TEXT[] DEFAULT '{}',
  service_area TEXT[] DEFAULT '{}',
  rating NUMERIC(3,2),
  internal_notes TEXT,
  portal_access_token UUID,
  portal_access_enabled BOOLEAN NOT NULL DEFAULT false,
  last_portal_access TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sub_contractors_org_id ON sub_contractors(org_id);
CREATE INDEX IF NOT EXISTS idx_sub_contractors_active ON sub_contractors(org_id, active);
CREATE INDEX IF NOT EXISTS idx_sub_contractors_portal_token ON sub_contractors(portal_access_token);

-- Work Orders table (if not exists) - for go-backs, repairs, etc.
CREATE TABLE IF NOT EXISTS work_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  work_order_number TEXT NOT NULL,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  work_order_type TEXT NOT NULL DEFAULT 'go_back' CHECK (work_order_type IN ('go_back', 'repair', 'warranty', 'punch_list', 'inspection', 'install', 'service_call')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'assigned', 'scheduled', 'in_progress', 'completed', 'cancelled', 'on_hold')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  assigned_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  assigned_sub_id UUID REFERENCES sub_contractors(id) ON DELETE SET NULL,
  address TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  title TEXT NOT NULL,
  description TEXT,
  scope_of_work TEXT,
  materials JSONB DEFAULT '[]',
  scheduled_date DATE,
  scheduled_time_start TIME,
  scheduled_time_end TIME,
  estimated_hours NUMERIC(5,2),
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  completion_notes TEXT,
  before_photos TEXT[] DEFAULT '{}',
  after_photos TEXT[] DEFAULT '{}',
  estimated_cost NUMERIC(12,2),
  actual_cost NUMERIC(12,2),
  billable_to_customer BOOLEAN NOT NULL DEFAULT false,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, work_order_number)
);

CREATE INDEX IF NOT EXISTS idx_work_orders_org_id ON work_orders(org_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_status ON work_orders(org_id, status);
CREATE INDEX IF NOT EXISTS idx_work_orders_project ON work_orders(project_id);

-- Work Order Comments table
CREATE TABLE IF NOT EXISTS work_order_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  sub_id UUID REFERENCES sub_contractors(id) ON DELETE SET NULL,
  comment TEXT NOT NULL,
  is_internal BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_work_order_comments_wo ON work_order_comments(work_order_id);

-- Work Order Status History table
CREATE TABLE IF NOT EXISTS work_order_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  old_status TEXT,
  new_status TEXT NOT NULL,
  changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_work_order_status_history_wo ON work_order_status_history(work_order_id);

-- Function to auto-generate work order numbers
CREATE OR REPLACE FUNCTION generate_work_order_number()
RETURNS TRIGGER AS $$
DECLARE
  next_num INTEGER;
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(work_order_number FROM 4) AS INTEGER)), 0) + 1
  INTO next_num
  FROM work_orders
  WHERE org_id = NEW.org_id;
  
  NEW.work_order_number := 'WO-' || LPAD(next_num::TEXT, 5, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_generate_work_order_number ON work_orders;
CREATE TRIGGER trigger_generate_work_order_number
  BEFORE INSERT ON work_orders
  FOR EACH ROW
  WHEN (NEW.work_order_number IS NULL OR NEW.work_order_number = '')
  EXECUTE FUNCTION generate_work_order_number();

-- Crews table for in-house installation teams
CREATE TABLE IF NOT EXISTS crews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  crew_type TEXT NOT NULL DEFAULT 'general' CHECK (crew_type IN ('roofing', 'siding', 'gutters', 'windows', 'general')),
  foreman_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  members UUID[] DEFAULT '{}',
  color TEXT NOT NULL DEFAULT '#3B82F6',
  phone TEXT,
  daily_capacity INTEGER NOT NULL DEFAULT 1,
  active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Production Jobs table - the main ops workflow table
CREATE TABLE IF NOT EXISTS production_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  job_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sold' CHECK (status IN ('sold', 'materials', 'scheduled', 'in_progress', 'complete', 'collected', 'on_hold')),
  job_type TEXT NOT NULL DEFAULT 'roofing' CHECK (job_type IN ('roofing', 'siding', 'windows', 'mixed')),
  address_text TEXT NOT NULL,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  
  -- Sales info
  sale_amount NUMERIC(12,2),
  sale_date DATE,
  salesperson_id UUID REFERENCES users(id) ON DELETE SET NULL,
  
  -- Materials
  materials_status TEXT NOT NULL DEFAULT 'not_ordered' CHECK (materials_status IN ('not_ordered', 'ordered', 'partial', 'received')),
  materials_ordered_at TIMESTAMPTZ,
  materials_eta DATE,
  materials_notes TEXT,
  
  -- Scheduling
  scheduled_date DATE,
  scheduled_time_start TIME,
  scheduled_time_end TIME,
  estimated_duration_hours NUMERIC(4,1),
  
  -- Assignment
  assigned_crew_id UUID REFERENCES crews(id) ON DELETE SET NULL,
  assigned_sub_id UUID REFERENCES sub_contractors(id) ON DELETE SET NULL,
  
  -- Permits
  permit_required BOOLEAN NOT NULL DEFAULT false,
  permit_status TEXT NOT NULL DEFAULT 'not_needed' CHECK (permit_status IN ('not_needed', 'pending', 'approved', 'denied')),
  permit_number TEXT,
  
  -- Completion
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  completion_notes TEXT,
  
  -- Photos
  before_photos TEXT[] DEFAULT '{}',
  progress_photos TEXT[] DEFAULT '{}',
  after_photos TEXT[] DEFAULT '{}',
  
  -- Financials
  labor_cost NUMERIC(12,2),
  material_cost NUMERIC(12,2),
  
  -- Meta
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'high', 'urgent')),
  internal_notes TEXT,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  UNIQUE(org_id, job_number)
);

-- Production Job Notes table
CREATE TABLE IF NOT EXISTS production_job_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES production_jobs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note TEXT NOT NULL,
  is_internal BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Material Orders table
CREATE TABLE IF NOT EXISTS material_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES production_jobs(id) ON DELETE CASCADE,
  supplier TEXT NOT NULL,
  order_number TEXT,
  items JSONB NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ordered', 'shipped', 'delivered')),
  ordered_at TIMESTAMPTZ,
  expected_delivery DATE,
  delivered_at TIMESTAMPTZ,
  total_cost NUMERIC(12,2),
  notes TEXT,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_crews_org_id ON crews(org_id);
CREATE INDEX IF NOT EXISTS idx_crews_active ON crews(org_id, active);

CREATE INDEX IF NOT EXISTS idx_production_jobs_org_id ON production_jobs(org_id);
CREATE INDEX IF NOT EXISTS idx_production_jobs_status ON production_jobs(org_id, status);
CREATE INDEX IF NOT EXISTS idx_production_jobs_scheduled ON production_jobs(org_id, scheduled_date);
CREATE INDEX IF NOT EXISTS idx_production_jobs_crew ON production_jobs(assigned_crew_id);
CREATE INDEX IF NOT EXISTS idx_production_jobs_sub ON production_jobs(assigned_sub_id);
CREATE INDEX IF NOT EXISTS idx_production_jobs_project ON production_jobs(project_id);

CREATE INDEX IF NOT EXISTS idx_production_job_notes_job ON production_job_notes(job_id);
CREATE INDEX IF NOT EXISTS idx_material_orders_job ON material_orders(job_id);

-- Enable RLS
ALTER TABLE crews ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_job_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE material_orders ENABLE ROW LEVEL SECURITY;

-- RLS Policies for crews
CREATE POLICY "Users can view crews in their org" ON crews
  FOR SELECT USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Admins and managers can manage crews" ON crews
  FOR ALL USING (
    org_id IN (
      SELECT org_id FROM users 
      WHERE id = auth.uid() 
      AND role::text IN ('admin', 'manager')
    )
  );

-- RLS Policies for production_jobs
CREATE POLICY "Users can view production jobs in their org" ON production_jobs
  FOR SELECT USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Admins and managers can manage production jobs" ON production_jobs
  FOR ALL USING (
    org_id IN (
      SELECT org_id FROM users 
      WHERE id = auth.uid() 
      AND role::text IN ('admin', 'manager')
    )
  );

-- RLS Policies for production_job_notes
CREATE POLICY "Users can view job notes in their org" ON production_job_notes
  FOR SELECT USING (
    job_id IN (
      SELECT id FROM production_jobs 
      WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())
    )
  );

CREATE POLICY "Users can add job notes" ON production_job_notes
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- RLS Policies for material_orders
CREATE POLICY "Users can view material orders in their org" ON material_orders
  FOR SELECT USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Admins and managers can manage material orders" ON material_orders
  FOR ALL USING (
    org_id IN (
      SELECT org_id FROM users 
      WHERE id = auth.uid() 
      AND role::text IN ('admin', 'manager')
    )
  );

-- Function to auto-generate job numbers
CREATE OR REPLACE FUNCTION generate_job_number()
RETURNS TRIGGER AS $$
DECLARE
  next_num INTEGER;
  year_prefix TEXT;
BEGIN
  year_prefix := to_char(CURRENT_DATE, 'YY');
  
  SELECT COALESCE(MAX(CAST(SUBSTRING(job_number FROM 4) AS INTEGER)), 0) + 1
  INTO next_num
  FROM production_jobs
  WHERE org_id = NEW.org_id
  AND job_number LIKE year_prefix || '-%';
  
  NEW.job_number := year_prefix || '-' || LPAD(next_num::TEXT, 4, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for auto job numbers
DROP TRIGGER IF EXISTS trigger_generate_job_number ON production_jobs;
CREATE TRIGGER trigger_generate_job_number
  BEFORE INSERT ON production_jobs
  FOR EACH ROW
  WHEN (NEW.job_number IS NULL OR NEW.job_number = '')
  EXECUTE FUNCTION generate_job_number();

-- Updated_at triggers
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_crews_updated_at ON crews;
CREATE TRIGGER trigger_crews_updated_at
  BEFORE UPDATE ON crews
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trigger_production_jobs_updated_at ON production_jobs;
CREATE TRIGGER trigger_production_jobs_updated_at
  BEFORE UPDATE ON production_jobs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trigger_material_orders_updated_at ON material_orders;
CREATE TRIGGER trigger_material_orders_updated_at
  BEFORE UPDATE ON material_orders
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- Function to create production job when project status changes to a "sold" state
-- This can be customized based on your workflow
CREATE OR REPLACE FUNCTION create_production_job_from_project()
RETURNS TRIGGER AS $$
BEGIN
  -- Only create if status changed to 'complete' (meaning contract signed/sold)
  -- and no production job exists yet
  IF NEW.status = 'complete' AND OLD.status != 'complete' THEN
    IF NOT EXISTS (SELECT 1 FROM production_jobs WHERE project_id = NEW.id) THEN
      INSERT INTO production_jobs (
        org_id,
        project_id,
        customer_id,
        job_type,
        address_text,
        lat,
        lng,
        salesperson_id,
        sale_date,
        created_by
      ) VALUES (
        NEW.org_id,
        NEW.id,
        NEW.customer_id,
        NEW.project_type,
        COALESCE(NEW.address_text, ''),
        NEW.lat,
        NEW.lng,
        NEW.owner_user_id,
        CURRENT_DATE,
        COALESCE(NEW.owner_user_id, (SELECT id FROM users WHERE org_id = NEW.org_id AND role = 'admin' LIMIT 1))
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Optional: Uncomment to auto-create production jobs when projects are marked complete
-- DROP TRIGGER IF EXISTS trigger_create_production_job ON projects;
-- CREATE TRIGGER trigger_create_production_job
--   AFTER UPDATE ON projects
--   FOR EACH ROW
--   EXECUTE FUNCTION create_production_job_from_project();

-- ============================================
-- RLS POLICIES FOR SUB_CONTRACTORS AND WORK_ORDERS
-- ============================================

ALTER TABLE sub_contractors ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_order_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_order_status_history ENABLE ROW LEVEL SECURITY;

-- Sub-contractors policies
CREATE POLICY "Users can view sub_contractors in their org" ON sub_contractors
  FOR SELECT USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Admins and managers can manage sub_contractors" ON sub_contractors
  FOR ALL USING (
    org_id IN (
      SELECT org_id FROM users 
      WHERE id = auth.uid() 
      AND role::text IN ('admin', 'manager')
    )
  );

-- Portal access for sub-contractors (public access via token)
CREATE POLICY "Sub-contractors can access via portal token" ON sub_contractors
  FOR SELECT USING (portal_access_enabled = true AND portal_access_token IS NOT NULL);

-- Work orders policies
CREATE POLICY "Users can view work_orders in their org" ON work_orders
  FOR SELECT USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Users can manage work_orders in their org" ON work_orders
  FOR ALL USING (
    org_id IN (
      SELECT org_id FROM users 
      WHERE id = auth.uid()
    )
  );

-- Work order comments policies
CREATE POLICY "Users can view work_order_comments in their org" ON work_order_comments
  FOR SELECT USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Users can add work_order_comments" ON work_order_comments
  FOR INSERT WITH CHECK (
    org_id IN (SELECT org_id FROM users WHERE id = auth.uid())
  );

-- Sub-contractors can add comments via portal
CREATE POLICY "Subs can view their work_order_comments" ON work_order_comments
  FOR SELECT USING (
    sub_id IN (
      SELECT id FROM sub_contractors 
      WHERE portal_access_enabled = true
    )
  );

CREATE POLICY "Subs can add work_order_comments" ON work_order_comments
  FOR INSERT WITH CHECK (sub_id IS NOT NULL);

-- Work order status history policies
CREATE POLICY "Users can view work_order_status_history" ON work_order_status_history
  FOR SELECT USING (
    work_order_id IN (
      SELECT id FROM work_orders 
      WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())
    )
  );

CREATE POLICY "Users can add work_order_status_history" ON work_order_status_history
  FOR INSERT WITH CHECK (
    work_order_id IN (
      SELECT id FROM work_orders 
      WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())
    )
  );

-- Updated_at triggers for sub_contractors and work_orders
DROP TRIGGER IF EXISTS trigger_sub_contractors_updated_at ON sub_contractors;
CREATE TRIGGER trigger_sub_contractors_updated_at
  BEFORE UPDATE ON sub_contractors
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trigger_work_orders_updated_at ON work_orders;
CREATE TRIGGER trigger_work_orders_updated_at
  BEFORE UPDATE ON work_orders
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();
