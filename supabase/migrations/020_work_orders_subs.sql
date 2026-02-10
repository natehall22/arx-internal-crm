-- Work Orders and Sub-Contractors System
-- Migration: 020_work_orders_subs.sql

-- Work order types
CREATE TYPE work_order_type AS ENUM (
  'go_back',
  'repair',
  'warranty',
  'punch_list',
  'inspection',
  'install',
  'service_call'
);

-- Work order status
CREATE TYPE work_order_status AS ENUM (
  'pending',
  'assigned',
  'scheduled',
  'in_progress',
  'completed',
  'cancelled',
  'on_hold'
);

-- Work order priority
CREATE TYPE work_order_priority AS ENUM (
  'low',
  'normal',
  'high',
  'urgent'
);

-- Sub-contractors table
CREATE TABLE sub_contractors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  
  -- Basic info
  company_name TEXT NOT NULL,
  contact_name TEXT,
  phone TEXT,
  email TEXT,
  
  -- Address
  address TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  
  -- Business details
  license_number TEXT,
  insurance_expiry DATE,
  w9_on_file BOOLEAN DEFAULT false,
  
  -- Capabilities
  services TEXT[], -- ['roofing', 'siding', 'gutters', 'windows']
  service_area TEXT[], -- zip codes or regions they cover
  
  -- Rating/notes
  rating NUMERIC(3, 2), -- 1.00 to 5.00
  internal_notes TEXT,
  
  -- Access
  portal_access_token TEXT UNIQUE,
  portal_access_enabled BOOLEAN DEFAULT false,
  last_portal_access TIMESTAMPTZ,
  
  -- Status
  active BOOLEAN DEFAULT true,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sub_contractors_org ON sub_contractors(org_id);
CREATE INDEX idx_sub_contractors_active ON sub_contractors(org_id, active);
CREATE INDEX idx_sub_contractors_token ON sub_contractors(portal_access_token) WHERE portal_access_token IS NOT NULL;

-- Work orders table
CREATE TABLE work_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  
  -- Reference number
  work_order_number TEXT NOT NULL,
  
  -- Linked records
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  
  -- Type and status
  work_order_type work_order_type NOT NULL DEFAULT 'go_back',
  status work_order_status NOT NULL DEFAULT 'pending',
  priority work_order_priority NOT NULL DEFAULT 'normal',
  
  -- Assignment (either internal employee OR sub-contractor)
  assigned_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  assigned_sub_id UUID REFERENCES sub_contractors(id) ON DELETE SET NULL,
  
  -- Location
  address TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  
  -- Details
  title TEXT NOT NULL,
  description TEXT,
  scope_of_work TEXT,
  
  -- Products/Materials needed
  materials JSONB DEFAULT '[]', -- [{name, quantity, unit}]
  
  -- Scheduling
  scheduled_date DATE,
  scheduled_time_start TIME,
  scheduled_time_end TIME,
  estimated_hours NUMERIC(5, 2),
  
  -- Completion
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES users(id),
  completion_notes TEXT,
  
  -- Photos
  before_photos TEXT[], -- storage paths
  after_photos TEXT[],
  
  -- Cost tracking
  estimated_cost NUMERIC(10, 2),
  actual_cost NUMERIC(10, 2),
  billable_to_customer BOOLEAN DEFAULT false,
  
  -- Created by
  created_by UUID NOT NULL REFERENCES users(id),
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  CONSTRAINT work_order_single_assignee CHECK (
    (assigned_user_id IS NULL AND assigned_sub_id IS NULL) OR
    (assigned_user_id IS NOT NULL AND assigned_sub_id IS NULL) OR
    (assigned_user_id IS NULL AND assigned_sub_id IS NOT NULL)
  )
);

CREATE INDEX idx_work_orders_org ON work_orders(org_id);
CREATE INDEX idx_work_orders_project ON work_orders(project_id);
CREATE INDEX idx_work_orders_customer ON work_orders(customer_id);
CREATE INDEX idx_work_orders_status ON work_orders(org_id, status);
CREATE INDEX idx_work_orders_assigned_user ON work_orders(assigned_user_id) WHERE assigned_user_id IS NOT NULL;
CREATE INDEX idx_work_orders_assigned_sub ON work_orders(assigned_sub_id) WHERE assigned_sub_id IS NOT NULL;
CREATE INDEX idx_work_orders_number ON work_orders(org_id, work_order_number);

-- Work order comments/activity
CREATE TABLE work_order_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  sub_id UUID REFERENCES sub_contractors(id) ON DELETE SET NULL,
  
  comment TEXT NOT NULL,
  is_internal BOOLEAN DEFAULT false, -- Internal notes not visible to subs
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_work_order_comments_wo ON work_order_comments(work_order_id);

-- Work order status history
CREATE TABLE work_order_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  
  old_status work_order_status,
  new_status work_order_status NOT NULL,
  changed_by UUID REFERENCES users(id),
  notes TEXT,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_wo_status_history ON work_order_status_history(work_order_id);

-- Function to generate work order number
CREATE OR REPLACE FUNCTION generate_work_order_number(p_org_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_count INTEGER;
  v_year TEXT;
BEGIN
  v_year := TO_CHAR(NOW(), 'YY');
  
  SELECT COUNT(*) + 1 INTO v_count
  FROM work_orders
  WHERE org_id = p_org_id
  AND created_at >= DATE_TRUNC('year', NOW());
  
  RETURN 'WO-' || v_year || '-' || LPAD(v_count::TEXT, 4, '0');
END;
$$ LANGUAGE plpgsql;

-- Triggers
CREATE TRIGGER update_sub_contractors_updated_at 
  BEFORE UPDATE ON sub_contractors 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_work_orders_updated_at 
  BEFORE UPDATE ON work_orders 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Auto-generate work order number
CREATE OR REPLACE FUNCTION set_work_order_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.work_order_number IS NULL OR NEW.work_order_number = '' THEN
    NEW.work_order_number := generate_work_order_number(NEW.org_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER work_order_number_trigger
  BEFORE INSERT ON work_orders
  FOR EACH ROW EXECUTE FUNCTION set_work_order_number();

-- Track status changes
CREATE OR REPLACE FUNCTION track_work_order_status()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO work_order_status_history (work_order_id, old_status, new_status)
    VALUES (NEW.id, OLD.status, NEW.status);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER work_order_status_trigger
  AFTER UPDATE ON work_orders
  FOR EACH ROW EXECUTE FUNCTION track_work_order_status();

-- RLS Policies
ALTER TABLE sub_contractors ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_order_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_order_status_history ENABLE ROW LEVEL SECURITY;

-- Sub-contractors: org users can manage
CREATE POLICY "Users can view sub contractors"
  ON sub_contractors FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

CREATE POLICY "Admins can manage sub contractors"
  ON sub_contractors FOR ALL
  USING (
    org_id = get_user_org_id(auth.uid())
    AND get_user_role(auth.uid()) IN ('admin', 'regional_manager', 'operations')
  );

-- Work orders: org users can view and manage based on role
CREATE POLICY "Users can view work orders"
  ON work_orders FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

CREATE POLICY "Users can create work orders"
  ON work_orders FOR INSERT
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

CREATE POLICY "Users can update work orders"
  ON work_orders FOR UPDATE
  USING (
    org_id = get_user_org_id(auth.uid())
    AND (
      created_by = auth.uid()
      OR assigned_user_id = auth.uid()
      OR get_user_role(auth.uid()) IN ('admin', 'regional_manager', 'operations', 'sales_manager')
    )
  );

-- Work order comments
CREATE POLICY "Users can view work order comments"
  ON work_order_comments FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

CREATE POLICY "Users can add work order comments"
  ON work_order_comments FOR INSERT
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

-- Status history
CREATE POLICY "Users can view status history"
  ON work_order_status_history FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM work_orders wo
      WHERE wo.id = work_order_status_history.work_order_id
      AND wo.org_id = get_user_org_id(auth.uid())
    )
  );
