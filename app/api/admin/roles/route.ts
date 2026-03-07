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
      const decoded = decodeURIComponent(singleCookie.value)
      return JSON.parse(decoded)
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
      const decoded = decodeURIComponent(chunks.join(''))
      return JSON.parse(decoded)
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

// GET - List all roles, permissions, and users
export async function GET(request: NextRequest) {
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
    .select('org_id, role')
    .eq('id', user.id)
    .single()

  if (!profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  }

  // Get all permissions
  const { data: permissions } = await adminClient
    .from('permissions')
    .select('*')
    .order('category')
    .order('name')

  // Get all custom roles for this org
  const { data: rolesData } = await adminClient
    .from('custom_roles')
    .select('*')
    .eq('org_id', profile.org_id)
    .order('hierarchy_level', { ascending: false })

  // Get role permissions and user counts
  const rolesWithPermissions = []
  for (const role of rolesData || []) {
    const { data: rolePerms } = await adminClient
      .from('role_permissions')
      .select('permission_id, permissions(*)')
      .eq('role_id', role.id)

    const { count } = await adminClient
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('custom_role_id', role.id)

    rolesWithPermissions.push({
      ...role,
      permissions: (rolePerms || []).map((rp: any) => rp.permissions),
      user_count: count || 0,
    })
  }

  // Get users with their individual permissions
  const { data: usersData } = await adminClient
    .from('users')
    .select('*, user_permissions(permission_id, permissions(*))')
    .eq('org_id', profile.org_id)
    .eq('active', true)
    .order('full_name')

  return NextResponse.json({
    permissions: permissions || [],
    roles: rolesWithPermissions,
    users: usersData || [],
    currentUserOrgId: profile.org_id,
  })
}

// POST - Create a new role
export async function POST(request: NextRequest) {
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
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const { name, display_name, description, hierarchy_level, parent_role_id, permission_ids } = body

  if (!name?.trim() || !display_name?.trim()) {
    return NextResponse.json({ error: 'Name and display name are required' }, { status: 400 })
  }

  const nameRegex = /^[a-z][a-z0-9_]*$/
  if (!nameRegex.test(name)) {
    return NextResponse.json({ error: 'Name must be lowercase letters, numbers, and underscores only' }, { status: 400 })
  }

  const { data: newRole, error: insertError } = await adminClient
    .from('custom_roles')
    .insert({
      org_id: profile.org_id,
      name: name.trim(),
      display_name: display_name.trim(),
      description: description?.trim() || null,
      hierarchy_level: hierarchy_level || 50,
      parent_role_id: parent_role_id || null,
      is_system_role: false,
    })
    .select()
    .single()

  if (insertError) {
    if (insertError.message.includes('duplicate')) {
      return NextResponse.json({ error: 'A role with this name already exists' }, { status: 400 })
    }
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  if (permission_ids && Array.isArray(permission_ids) && permission_ids.length > 0) {
    const permInserts = permission_ids.map((permId: string) => ({
      role_id: newRole.id,
      permission_id: permId,
    }))
    await adminClient.from('role_permissions').insert(permInserts)
  }

  return NextResponse.json({ role: newRole })
}

// PUT - Update a role
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

  if (!profile || !['admin', 'regional_manager'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const { id, display_name, description, hierarchy_level, parent_role_id, permission_ids } = body

  if (!id) {
    return NextResponse.json({ error: 'Role ID is required' }, { status: 400 })
  }

  const { data: existing } = await adminClient
    .from('custom_roles')
    .select('id, org_id')
    .eq('id', id)
    .single()

  if (!existing || existing.org_id !== profile.org_id) {
    return NextResponse.json({ error: 'Role not found' }, { status: 404 })
  }

  const { error: updateError } = await adminClient
    .from('custom_roles')
    .update({
      display_name: display_name?.trim(),
      description: description?.trim() || null,
      hierarchy_level: hierarchy_level || 50,
      parent_role_id: parent_role_id || null,
    })
    .eq('id', id)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  await adminClient.from('role_permissions').delete().eq('role_id', id)

  if (permission_ids && Array.isArray(permission_ids) && permission_ids.length > 0) {
    const permInserts = permission_ids.map((permId: string) => ({
      role_id: id,
      permission_id: permId,
    }))
    await adminClient.from('role_permissions').insert(permInserts)
  }

  return NextResponse.json({ success: true })
}

// DELETE - Delete a role
export async function DELETE(request: NextRequest) {
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
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const roleId = request.nextUrl.searchParams.get('id')
  if (!roleId) {
    return NextResponse.json({ error: 'Role ID is required' }, { status: 400 })
  }

  const { data: existing } = await adminClient
    .from('custom_roles')
    .select('id, org_id, is_system_role')
    .eq('id', roleId)
    .single()

  if (!existing || existing.org_id !== profile.org_id) {
    return NextResponse.json({ error: 'Role not found' }, { status: 404 })
  }

  if (existing.is_system_role) {
    return NextResponse.json({ error: 'System roles cannot be deleted' }, { status: 400 })
  }

  await adminClient.from('role_permissions').delete().eq('role_id', roleId)

  const { error } = await adminClient
    .from('custom_roles')
    .delete()
    .eq('id', roleId)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
