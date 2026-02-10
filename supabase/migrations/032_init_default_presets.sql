-- Initialize default permission presets for all organizations
-- This can be run directly in Supabase SQL Editor or as a migration

DO $$
DECLARE
  v_org RECORD;
  v_preset_id UUID;
  v_existing_count INTEGER;
BEGIN
  -- Loop through all organizations
  FOR v_org IN SELECT id, name FROM orgs LOOP
    -- Check if org already has presets
    SELECT COUNT(*) INTO v_existing_count 
    FROM permission_presets 
    WHERE org_id = v_org.id;
    
    IF v_existing_count > 0 THEN
      RAISE NOTICE 'Org % already has presets, skipping', v_org.name;
      CONTINUE;
    END IF;
    
    RAISE NOTICE 'Creating presets for org: %', v_org.name;

    -- 1. Setter / Canvasser preset
    INSERT INTO permission_presets (org_id, name, description, base_role, color, is_system, sort_order)
    VALUES (v_org.id, 'Setter / Canvasser', 'Door-to-door canvassing, lead creation, basic scheduling', 'canvasser', 'green', true, 1)
    RETURNING id INTO v_preset_id;
    
    INSERT INTO preset_permissions (preset_id, permission_id)
    SELECT v_preset_id, id FROM permissions WHERE name IN (
      'canvass:view', 'canvass:create', 'canvass:edit',
      'leads:view', 'leads:create', 'leads:edit',
      'scheduling:view',
      'reports:view_own',
      'teams:view',
      'users:view'
    );

    -- 2. Sales Representative preset
    INSERT INTO permission_presets (org_id, name, description, base_role, color, is_system, sort_order)
    VALUES (v_org.id, 'Sales Representative', 'Full sales cycle - leads, opportunities, proposals, contracts', 'sales_rep', 'blue', true, 2)
    RETURNING id INTO v_preset_id;
    
    INSERT INTO preset_permissions (preset_id, permission_id)
    SELECT v_preset_id, id FROM permissions WHERE name IN (
      'canvass:view',
      'leads:view', 'leads:create', 'leads:edit',
      'opportunities:view', 'opportunities:edit',
      'proposals:view', 'proposals:create', 'proposals:edit', 'proposals:send',
      'contracts:view', 'contracts:create', 'contracts:send',
      'projects:view',
      'scheduling:view', 'scheduling:create', 'scheduling:edit',
      'reports:view_own',
      'teams:view',
      'users:view'
    );

    -- 3. Sales Manager preset
    INSERT INTO permission_presets (org_id, name, description, base_role, color, is_system, sort_order)
    VALUES (v_org.id, 'Sales Manager', 'Team management, reporting, full sales access', 'sales_manager', 'purple', true, 3)
    RETURNING id INTO v_preset_id;
    
    INSERT INTO preset_permissions (preset_id, permission_id)
    SELECT v_preset_id, id FROM permissions WHERE name IN (
      'canvass:view', 'canvass:create', 'canvass:edit', 'canvass:import', 'canvass:export',
      'leads:view', 'leads:create', 'leads:edit', 'leads:assign',
      'opportunities:view', 'opportunities:edit',
      'proposals:view', 'proposals:create', 'proposals:edit', 'proposals:send',
      'contracts:view', 'contracts:create', 'contracts:send',
      'projects:view', 'projects:edit',
      'teams:view', 'teams:edit', 'teams:manage_members',
      'users:view', 'users:manage_team',
      'scheduling:view', 'scheduling:create', 'scheduling:edit', 'scheduling:manage_team',
      'reports:view_own', 'reports:view_team', 'reports:export',
      'pricebook:view'
    );

    -- 4. Regional Manager preset
    INSERT INTO permission_presets (org_id, name, description, base_role, color, is_system, sort_order)
    VALUES (v_org.id, 'Regional Manager', 'Regional oversight, all team management, admin access', 'regional_manager', 'indigo', true, 4)
    RETURNING id INTO v_preset_id;
    
    INSERT INTO preset_permissions (preset_id, permission_id)
    SELECT v_preset_id, id FROM permissions WHERE name IN (
      'canvass:view', 'canvass:create', 'canvass:edit', 'canvass:delete', 'canvass:import', 'canvass:export',
      'leads:view', 'leads:create', 'leads:edit', 'leads:delete', 'leads:assign',
      'leads:view_inbound', 'leads:manage_inbound',
      'opportunities:view', 'opportunities:edit', 'opportunities:delete',
      'proposals:view', 'proposals:create', 'proposals:edit', 'proposals:send',
      'contracts:view', 'contracts:create', 'contracts:send',
      'projects:view', 'projects:edit', 'projects:complete',
      'teams:view', 'teams:create', 'teams:edit', 'teams:delete', 'teams:manage_members',
      'regions:view', 'regions:edit',
      'users:view', 'users:edit', 'users:manage_team', 'users:manage_region',
      'scheduling:view', 'scheduling:create', 'scheduling:edit', 'scheduling:manage_team', 'scheduling:manage_region',
      'reports:view_own', 'reports:view_team', 'reports:view_region', 'reports:export',
      'campaigns:view', 'campaigns:edit', 'campaigns:view_reports',
      'pricebook:view', 'pricebook:edit',
      'admin:access'
    );

    -- 5. Operations preset
    INSERT INTO permission_presets (org_id, name, description, base_role, color, is_system, sort_order)
    VALUES (v_org.id, 'Operations', 'Project management, scheduling, reporting - no sales', 'operations', 'orange', true, 5)
    RETURNING id INTO v_preset_id;
    
    INSERT INTO preset_permissions (preset_id, permission_id)
    SELECT v_preset_id, id FROM permissions WHERE name IN (
      'leads:view',
      'leads:view_inbound', 'leads:manage_inbound',
      'opportunities:view',
      'proposals:view',
      'contracts:view',
      'projects:view', 'projects:edit', 'projects:complete',
      'teams:view',
      'users:view',
      'scheduling:view', 'scheduling:create', 'scheduling:edit', 'scheduling:manage_queue',
      'reports:view_own', 'reports:view_all', 'reports:export',
      'campaigns:view', 'campaigns:view_reports',
      'pricebook:view'
    );

    -- 6. Inside Sales preset (NEW - for inbound lead handling)
    INSERT INTO permission_presets (org_id, name, description, base_role, color, is_system, sort_order)
    VALUES (v_org.id, 'Inside Sales', 'Handle inbound leads, phone sales, appointment setting', 'sales_rep', 'teal', true, 6)
    RETURNING id INTO v_preset_id;
    
    INSERT INTO preset_permissions (preset_id, permission_id)
    SELECT v_preset_id, id FROM permissions WHERE name IN (
      'leads:view', 'leads:create', 'leads:edit',
      'leads:view_inbound', 'leads:claim_inbound',
      'opportunities:view', 'opportunities:edit',
      'proposals:view', 'proposals:create', 'proposals:edit', 'proposals:send',
      'contracts:view',
      'projects:view',
      'scheduling:view', 'scheduling:create', 'scheduling:edit',
      'reports:view_own',
      'campaigns:view',
      'teams:view',
      'users:view'
    );

    -- 7. Administrator preset
    INSERT INTO permission_presets (org_id, name, description, base_role, color, is_system, sort_order)
    VALUES (v_org.id, 'Administrator', 'Full system access - all permissions', 'admin', 'red', true, 7)
    RETURNING id INTO v_preset_id;
    
    INSERT INTO preset_permissions (preset_id, permission_id)
    SELECT v_preset_id, id FROM permissions WHERE name = 'admin:full';

    RAISE NOTICE 'Created 7 presets for org: %', v_org.name;
  END LOOP;
  
  RAISE NOTICE 'Done initializing permission presets';
END $$;
