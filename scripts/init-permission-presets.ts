/**
 * Initialize default permission presets for all organizations
 * Run with: npx ts-node scripts/init-permission-presets.ts
 */

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

// Default preset definitions
const defaultPresets = [
  {
    name: 'Setter / Canvasser',
    description: 'Door-to-door canvassing, lead creation, basic scheduling',
    base_role: 'canvasser',
    color: 'green',
    is_system: true,
    sort_order: 1,
    permissions: [
      'canvass:view', 'canvass:create', 'canvass:edit',
      'leads:view', 'leads:create', 'leads:edit',
      'scheduling:view',
      'reports:view_own',
      'teams:view',
      'users:view',
    ],
  },
  {
    name: 'Sales Representative',
    description: 'Full sales cycle - leads, opportunities, proposals, contracts',
    base_role: 'sales_rep',
    color: 'blue',
    is_system: true,
    sort_order: 2,
    permissions: [
      'canvass:view',
      'leads:view', 'leads:create', 'leads:edit',
      'opportunities:view', 'opportunities:edit',
      'proposals:view', 'proposals:create', 'proposals:edit', 'proposals:send',
      'contracts:view', 'contracts:create', 'contracts:send',
      'projects:view',
      'scheduling:view', 'scheduling:create', 'scheduling:edit',
      'reports:view_own',
      'teams:view',
      'users:view',
    ],
  },
  {
    name: 'Sales Manager',
    description: 'Team management, reporting, full sales access',
    base_role: 'sales_manager',
    color: 'purple',
    is_system: true,
    sort_order: 3,
    permissions: [
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
      'pricebook:view',
    ],
  },
  {
    name: 'Regional Manager',
    description: 'Regional oversight, all team management, admin access',
    base_role: 'regional_manager',
    color: 'indigo',
    is_system: true,
    sort_order: 4,
    permissions: [
      'canvass:view', 'canvass:create', 'canvass:edit', 'canvass:delete', 'canvass:import', 'canvass:export',
      'leads:view', 'leads:create', 'leads:edit', 'leads:delete', 'leads:assign',
      'opportunities:view', 'opportunities:edit', 'opportunities:delete',
      'proposals:view', 'proposals:create', 'proposals:edit', 'proposals:send',
      'contracts:view', 'contracts:create', 'contracts:send',
      'projects:view', 'projects:edit', 'projects:complete',
      'teams:view', 'teams:create', 'teams:edit', 'teams:delete', 'teams:manage_members',
      'regions:view', 'regions:edit',
      'users:view', 'users:edit', 'users:manage_team', 'users:manage_region',
      'scheduling:view', 'scheduling:create', 'scheduling:edit', 'scheduling:manage_team', 'scheduling:manage_region',
      'reports:view_own', 'reports:view_team', 'reports:view_region', 'reports:export',
      'pricebook:view', 'pricebook:edit',
      'admin:access',
    ],
  },
  {
    name: 'Operations',
    description: 'Project management, scheduling, reporting - no sales',
    base_role: 'operations',
    color: 'orange',
    is_system: true,
    sort_order: 5,
    permissions: [
      'leads:view',
      'opportunities:view',
      'proposals:view',
      'contracts:view',
      'projects:view', 'projects:edit', 'projects:complete',
      'teams:view',
      'users:view',
      'scheduling:view', 'scheduling:create', 'scheduling:edit', 'scheduling:manage_queue',
      'reports:view_own', 'reports:view_all', 'reports:export',
      'pricebook:view',
    ],
  },
  {
    name: 'Administrator',
    description: 'Full system access - all permissions',
    base_role: 'admin',
    color: 'red',
    is_system: true,
    sort_order: 6,
    permissions: ['admin:full'],
  },
]

async function initPresets() {
  console.log('Fetching organizations...')
  
  const { data: orgs, error: orgsError } = await supabase
    .from('orgs')
    .select('id, name')
  
  if (orgsError) {
    console.error('Error fetching orgs:', orgsError)
    process.exit(1)
  }
  
  console.log(`Found ${orgs?.length || 0} organizations`)
  
  // Fetch all permissions
  const { data: permissions, error: permsError } = await supabase
    .from('permissions')
    .select('id, name')
  
  if (permsError) {
    console.error('Error fetching permissions:', permsError)
    process.exit(1)
  }
  
  const permissionMap = new Map(permissions?.map(p => [p.name, p.id]) || [])
  
  for (const org of orgs || []) {
    console.log(`\nProcessing org: ${org.name} (${org.id})`)
    
    // Check if org already has presets
    const { data: existingPresets } = await supabase
      .from('permission_presets')
      .select('id')
      .eq('org_id', org.id)
      .limit(1)
    
    if (existingPresets && existingPresets.length > 0) {
      console.log('  - Presets already exist, skipping')
      continue
    }
    
    // Create presets for this org
    for (const preset of defaultPresets) {
      console.log(`  - Creating preset: ${preset.name}`)
      
      const { data: newPreset, error: presetError } = await supabase
        .from('permission_presets')
        .insert({
          org_id: org.id,
          name: preset.name,
          description: preset.description,
          base_role: preset.base_role,
          color: preset.color,
          is_system: preset.is_system,
          sort_order: preset.sort_order,
        })
        .select()
        .single()
      
      if (presetError) {
        console.error(`    Error creating preset: ${presetError.message}`)
        continue
      }
      
      // Add permissions to preset
      const permissionInserts = preset.permissions
        .map(permName => {
          const permId = permissionMap.get(permName)
          if (!permId) {
            console.warn(`    Warning: Permission not found: ${permName}`)
            return null
          }
          return {
            preset_id: newPreset.id,
            permission_id: permId,
          }
        })
        .filter(Boolean)
      
      if (permissionInserts.length > 0) {
        const { error: ppError } = await supabase
          .from('preset_permissions')
          .insert(permissionInserts)
        
        if (ppError) {
          console.error(`    Error adding permissions: ${ppError.message}`)
        } else {
          console.log(`    Added ${permissionInserts.length} permissions`)
        }
      }
    }
  }
  
  console.log('\nDone!')
}

initPresets().catch(console.error)
