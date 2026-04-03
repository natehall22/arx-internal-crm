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

// GET - Get permissions for a specific user
export async function GET(request: NextRequest) {
  const { client: authClient, accessToken } = getAuthClient(request)
  
  if (!accessToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  
  const { data: { user } } = await authClient.auth.getUser(accessToken)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const userId = request.nextUrl.searchParams.get('userId')
  if (!userId) {
    return NextResponse.json({ error: 'User ID is required' }, { status: 400 })
  }

  const adminClient = getAdminClient()
  
  const { data: permissions } = await adminClient
    .from('user_permissions')
    .select('permission_id')
    .eq('user_id', userId)

  return NextResponse.json({
    permission_ids: (permissions || []).map(p => p.permission_id),
  })
}

// PUT - Update user permissions
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
  const { user_id, permission_ids, custom_role_id } = body

  if (!user_id) {
    return NextResponse.json({ error: 'User ID is required' }, { status: 400 })
  }

  // Verify target user is in same org
  const { data: targetUser } = await adminClient
    .from('users')
    .select('org_id')
    .eq('id', user_id)
    .single()

  if (!targetUser || targetUser.org_id !== profile.org_id) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  // Snapshot individual grants so we can restore if the insert step fails after delete.
  const { data: existingPerms } = await adminClient
    .from('user_permissions')
    .select('org_id, permission_id, granted_by')
    .eq('user_id', user_id)

  // Validate custom_role_id before mutating (actual update runs after permissions succeed)
  if (Object.prototype.hasOwnProperty.call(body, 'custom_role_id') && custom_role_id) {
    const { data: role } = await adminClient
      .from('custom_roles')
      .select('id')
      .eq('id', custom_role_id)
      .eq('org_id', profile.org_id)
      .single()

    if (!role) {
      return NextResponse.json({ error: 'Custom role not found' }, { status: 404 })
    }
  }

  const { error: deleteError } = await adminClient
    .from('user_permissions')
    .delete()
    .eq('user_id', user_id)

  if (deleteError) {
    return NextResponse.json({ error: 'Failed to update permissions' }, { status: 500 })
  }

  if (permission_ids && Array.isArray(permission_ids) && permission_ids.length > 0) {
    const permInserts = permission_ids.map((permId: string) => ({
      org_id: profile.org_id,
      user_id: user_id,
      permission_id: permId,
      granted_by: user.id,
    }))

    const { error: insertError } = await adminClient.from('user_permissions').insert(permInserts)

    if (insertError) {
      if (existingPerms && existingPerms.length > 0) {
        const { error: restoreError } = await adminClient.from('user_permissions').insert(
          existingPerms.map((row) => ({
            org_id: row.org_id,
            user_id,
            permission_id: row.permission_id,
            granted_by: row.granted_by ?? user.id,
          }))
        )
        if (restoreError) {
          console.error('user_permissions: restore after failed insert failed:', restoreError.message)
        }
      }
      return NextResponse.json({ error: 'Failed to save permissions' }, { status: 500 })
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, 'custom_role_id')) {
    const { error: roleError } = await adminClient
      .from('users')
      .update({ custom_role_id: custom_role_id ?? null })
      .eq('id', user_id)

    if (roleError) {
      return NextResponse.json({ error: 'Failed to update custom role' }, { status: 500 })
    }
  }

  return NextResponse.json({ success: true })
}
