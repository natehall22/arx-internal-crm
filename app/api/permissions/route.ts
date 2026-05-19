import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { resolveEffectivePermissionNames } from '@/lib/effective-permissions'
import { isOrgSuperuserRoleSlug } from '@/lib/permissions'

// GET - Check if current user has a specific permission
export async function GET(request: NextRequest) {
  let authContext
  try {
    authContext = await requireAuthApi()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const permission = request.nextUrl.searchParams.get('permission')

  if (!permission) {
    return NextResponse.json({ error: 'Permission parameter required' }, { status: 400 })
  }

  const adminClient = createServiceClient()
  const effectivePermissions = await resolveEffectivePermissionNames(
    adminClient,
    authContext.authUser.id,
    authContext.profile
  )

  return NextResponse.json({
    hasPermission:
      effectivePermissions.fullAccess || effectivePermissions.permissionNames.has(permission),
    source: 'effective_permissions',
  })
}

// POST - Grant a permission to a user
export async function POST(request: NextRequest) {
  const supabase = createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check if requester is admin
  const { data: profile } = await supabase
    .from('users')
    .select('role, org_id')
    .eq('id', user.id)
    .single()

  if (!profile || !(isOrgSuperuserRoleSlug(profile.role) || profile.role === 'regional_manager')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const { user_id, permission_name, notes } = body

  if (!user_id || !permission_name) {
    return NextResponse.json({ error: 'user_id and permission_name required' }, { status: 400 })
  }

  // Get permission ID
  const { data: permissionData } = await supabase
    .from('permissions')
    .select('id')
    .eq('name', permission_name)
    .single()

  if (!permissionData) {
    return NextResponse.json({ error: 'Permission not found' }, { status: 404 })
  }

  // Verify target user is in same org
  const { data: targetUser } = await supabase
    .from('users')
    .select('org_id')
    .eq('id', user_id)
    .single()

  if (!targetUser || targetUser.org_id !== profile.org_id) {
    return NextResponse.json({ error: 'User not found in your organization' }, { status: 404 })
  }

  // Grant permission
  const { error } = await supabase
    .from('user_permissions')
    .upsert({
      org_id: profile.org_id,
      user_id,
      permission_id: permissionData.id,
      granted_by: user.id,
      notes,
    }, {
      onConflict: 'user_id,permission_id'
    })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

// DELETE - Revoke a permission from a user
export async function DELETE(request: NextRequest) {
  const supabase = createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check if requester is admin
  const { data: profile } = await supabase
    .from('users')
    .select('role, org_id')
    .eq('id', user.id)
    .single()

  if (!profile || !(isOrgSuperuserRoleSlug(profile.role) || profile.role === 'regional_manager')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const userId = request.nextUrl.searchParams.get('user_id')
  const permissionName = request.nextUrl.searchParams.get('permission_name')

  if (!userId || !permissionName) {
    return NextResponse.json({ error: 'user_id and permission_name required' }, { status: 400 })
  }

  // Get permission ID
  const { data: permissionData } = await supabase
    .from('permissions')
    .select('id')
    .eq('name', permissionName)
    .single()

  if (!permissionData) {
    return NextResponse.json({ error: 'Permission not found' }, { status: 404 })
  }

  // Revoke permission
  const { error } = await supabase
    .from('user_permissions')
    .delete()
    .eq('user_id', userId)
    .eq('permission_id', permissionData.id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
