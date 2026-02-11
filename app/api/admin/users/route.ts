import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

function getSessionFromRequest(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const projectRef = supabaseUrl.match(/https:\/\/([^.]+)\./)?.[1] || ''
  const cookieName = `sb-${projectRef}-auth-token`
  
  const singleCookie = req.cookies.get(cookieName)
  if (singleCookie?.value) {
    try {
      return JSON.parse(singleCookie.value)
    } catch {
      return null
    }
  }
  
  const chunks: string[] = []
  let i = 0
  while (true) {
    const chunk = req.cookies.get(`${cookieName}.${i}`)
    if (!chunk?.value) break
    chunks.push(chunk.value)
    i++
  }
  
  if (chunks.length > 0) {
    try {
      return JSON.parse(chunks.join(''))
    } catch {
      return null
    }
  }
  
  return null
}

function getAuthClient(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const sessionData = getSessionFromRequest(req)
  
  return {
    client: createClient(supabaseUrl, supabaseKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: sessionData?.access_token
        ? { headers: { Authorization: `Bearer ${sessionData.access_token}` } }
        : undefined,
    }),
    accessToken: sessionData?.access_token,
  }
}

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export async function POST(request: NextRequest) {
  try {
    const { client: authClient, accessToken } = getAuthClient(request)
    
    if (!accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    const { data: { user } } = await authClient.auth.getUser(accessToken)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = getAdminClient()

    const { data: profile } = await adminClient
      .from('users')
      .select('role, org_id')
      .eq('id', user.id)
      .single()

    if (!profile || !['admin', 'regional_manager'].includes(profile.role)) {
      return NextResponse.json({ error: 'Forbidden - Admin access required' }, { status: 403 })
    }

    const body = await request.json()
    const {
      email,
      password,
      full_name,
      phone,
      role,
      custom_role_id,
      team_id,
      region_id,
      manager_user_id,
      org_id,
      permission_ids,
      canvass_pin_visibility,
    } = body

    if (!email || !password || !full_name) {
      return NextResponse.json({ error: 'Email, password, and full name are required' }, { status: 400 })
    }

    if (password.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 })
    }

    // Use the admin's org_id if not provided
    const targetOrgId = org_id || profile.org_id
    
    if (targetOrgId !== profile.org_id) {
      return NextResponse.json({ error: 'Cannot create users in a different organization' }, { status: 403 })
    }

    const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name,
      },
    })

    if (authError) {
      console.error('Auth error:', authError)
      if (authError.message.includes('already been registered')) {
        return NextResponse.json({ error: 'A user with this email already exists' }, { status: 400 })
      }
      return NextResponse.json({ error: authError.message }, { status: 400 })
    }

    if (!authData.user) {
      return NextResponse.json({ error: 'Failed to create auth user' }, { status: 500 })
    }

    const { error: profileError } = await adminClient
      .from('users')
      .insert({
        id: authData.user.id,
        email,
        full_name,
        phone: phone || null,
        role: role || 'sales_rep',
        custom_role_id: custom_role_id || null,
        team_id: team_id || null,
        region_id: region_id || null,
        manager_user_id: manager_user_id || null,
        org_id: targetOrgId,
        active: true,
        canvass_pin_visibility: canvass_pin_visibility || 'org',
      })

    if (profileError) {
      console.error('Profile error:', profileError)
      await adminClient.auth.admin.deleteUser(authData.user.id)
      return NextResponse.json({ error: `Failed to create user profile: ${profileError.message}` }, { status: 500 })
    }

    if (permission_ids && Array.isArray(permission_ids) && permission_ids.length > 0) {
      const permissionInserts = permission_ids.map((permId: string) => ({
        org_id: targetOrgId,
        user_id: authData.user.id,
        permission_id: permId,
        granted_by: user.id,
      }))

      const { error: permError } = await adminClient
        .from('user_permissions')
        .insert(permissionInserts)

      if (permError) {
        console.error('Permission error:', permError)
      }
    }

    return NextResponse.json({ 
      success: true, 
      user: { 
        id: authData.user.id, 
        email, 
        full_name 
      } 
    })

  } catch (error) {
    console.error('Create user error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  try {
    const { client: authClient, accessToken } = getAuthClient(request)
    
    if (!accessToken) {
      return NextResponse.json({ error: 'Unauthorized - no token' }, { status: 401 })
    }
    
    const { data: { user }, error: userError } = await authClient.auth.getUser(accessToken)
    if (userError || !user) {
      return NextResponse.json({ error: `Unauthorized - ${userError?.message || 'no user'}` }, { status: 401 })
    }

    const adminClient = getAdminClient()

    const { data: profile, error: profileError } = await adminClient
      .from('users')
      .select('role, org_id')
      .eq('id', user.id)
      .single()

    if (profileError || !profile) {
      return NextResponse.json({ error: `Profile not found: ${profileError?.message || 'no data'}` }, { status: 404 })
    }

    // Get users with all related data (without self-join for manager)
    const { data: users, error } = await adminClient
      .from('users')
      .select(`
        *,
        teams(*),
        regions(*),
        custom_roles(*)
      `)
      .eq('org_id', profile.org_id)
      .order('full_name')

    if (error) {
      return NextResponse.json({ error: `Users query failed: ${error.message}` }, { status: 500 })
    }

    // Manually add manager info
    const usersWithManagers = (users || []).map(u => {
      const manager = u.manager_user_id 
        ? users?.find(m => m.id === u.manager_user_id)
        : null
      return {
        ...u,
        manager: manager ? { id: manager.id, full_name: manager.full_name, email: manager.email, role: manager.role } : null
      }
    })

  // Get teams, regions, custom roles, permissions, and presets
  const [teamsRes, regionsRes, rolesRes, permsRes, presetsRes] = await Promise.all([
    adminClient.from('teams').select('*').eq('org_id', profile.org_id).order('name'),
    adminClient.from('regions').select('*').eq('org_id', profile.org_id).order('name'),
    adminClient.from('custom_roles').select('*').eq('org_id', profile.org_id).order('hierarchy_level', { ascending: false }),
    adminClient.from('permissions').select('*').order('category').order('display_name'),
    adminClient.from('permission_presets').select(`
      *,
      preset_permissions (
        permission_id,
        permissions (
          id,
          name,
          display_name,
          category
        )
      )
    `).eq('org_id', profile.org_id).order('sort_order'),
  ])

    return NextResponse.json({ 
      users: usersWithManagers.map(u => ({
        ...u,
        team: u.teams,
        region: u.regions,
        custom_role: u.custom_roles,
      })),
      teams: teamsRes.data || [],
      regions: regionsRes.data || [],
      customRoles: rolesRes.data || [],
      permissions: permsRes.data || [],
      permissionPresets: presetsRes.data || [],
      currentUserOrgId: profile.org_id,
    })
  } catch (err) {
    console.error('GET /api/admin/users error:', err)
    return NextResponse.json({ error: `Server error: ${err instanceof Error ? err.message : 'unknown'}` }, { status: 500 })
  }
}

// PUT - Update a user
export async function PUT(request: NextRequest) {
  const { client: authClient, accessToken } = getAuthClient(request)
  
  if (!accessToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  
  const { data: { user } } = await authClient.auth.getUser(accessToken)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const adminClient = getAdminClient()

  const { data: profile } = await adminClient
    .from('users')
    .select('role, org_id')
    .eq('id', user.id)
    .single()

  if (!profile || !['admin', 'regional_manager', 'sales_manager'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const { id, role, custom_role_id, team_id, region_id, manager_user_id, active, canvass_pin_visibility } = body

  if (!id) {
    return NextResponse.json({ error: 'User ID is required' }, { status: 400 })
  }

  // Verify target user is in same org
  const { data: targetUser } = await adminClient
    .from('users')
    .select('org_id')
    .eq('id', id)
    .single()

  if (!targetUser || targetUser.org_id !== profile.org_id) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  const updateData: Record<string, unknown> = {}
  if (role !== undefined) updateData.role = role
  if (custom_role_id !== undefined) updateData.custom_role_id = custom_role_id || null
  if (team_id !== undefined) updateData.team_id = team_id || null
  if (region_id !== undefined) updateData.region_id = region_id || null
  if (manager_user_id !== undefined) updateData.manager_user_id = manager_user_id || null
  if (active !== undefined) updateData.active = active
  if (canvass_pin_visibility !== undefined) updateData.canvass_pin_visibility = canvass_pin_visibility

  const { error: updateError } = await adminClient
    .from('users')
    .update(updateData)
    .eq('id', id)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
