-- Migration: 034_default_hierarchy_roles.sql
-- Creates default hierarchy roles for organizations

-- Function to create default roles for an org
CREATE OR REPLACE FUNCTION create_default_hierarchy_roles(p_org_id UUID)
RETURNS void AS $$
DECLARE
  v_existing_count INT;
BEGIN
  -- Check if roles already exist for this org
  SELECT COUNT(*) INTO v_existing_count
  FROM custom_roles
  WHERE org_id = p_org_id;
  
  -- Only create if no roles exist
  IF v_existing_count = 0 THEN
    INSERT INTO custom_roles (org_id, name, display_name, description, hierarchy_level, is_system_role)
    VALUES
      (p_org_id, 'admin_owner', 'Admin/Owner', 'Full system access and ownership', 100, true),
      (p_org_id, 'regional_operations', 'Regional Operations', 'Regional operations oversight and management', 90, true),
      (p_org_id, 'operations_manager', 'Operations Manager', 'Operations team management', 85, true),
      (p_org_id, 'regional_sales_manager', 'Regional Sales Manager', 'Regional sales oversight and strategy', 80, true),
      (p_org_id, 'operations', 'Operations', 'Day-to-day operations and coordination', 75, true),
      (p_org_id, 'sales_manager', 'Sales Manager', 'Sales team management and coaching', 70, true),
      (p_org_id, 'regional_setter_manager', 'Regional Setter Manager', 'Regional setter team oversight', 65, true),
      (p_org_id, 'setter_manager', 'Setter Manager', 'Setter team management and training', 60, true),
      (p_org_id, 'field_operations', 'Field Operations', 'Field work coordination and quality control', 55, true),
      (p_org_id, 'sales_rep', 'Sales Rep', 'Sales activities and customer relationships', 50, true),
      (p_org_id, 'setter', 'Setter', 'Appointment setting and lead qualification', 40, true),
      (p_org_id, 'sub_contractor', 'Sub Contractor', 'External contractor with limited access', 30, true);
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Create roles for all existing orgs that don't have any
DO $$
DECLARE
  org_record RECORD;
BEGIN
  FOR org_record IN SELECT id FROM orgs LOOP
    PERFORM create_default_hierarchy_roles(org_record.id);
  END LOOP;
END $$;

COMMENT ON FUNCTION create_default_hierarchy_roles IS 'Creates default hierarchy roles for a new organization';
