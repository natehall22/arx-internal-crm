import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { resolveEffectivePermissionNames } from '@/lib/effective-permissions'
import { isOrgSuperuserRoleSlug } from '@/lib/permissions'
import { actorIsOwner, isMoneyPermissionName } from '@/lib/money-permission-guard'

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
  let profile
  try {
    ;({ profile } = await requireAuthApi())
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check if requester is admin
  if (!(isOrgSuperuserRoleSlug(profile.role) || profile.role === 'regional_manager')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Service client (2026-11-07): RLS writes to user_permissions are being narrowed to admin/owner, so this
  // route's own checks are the gate — role above, owner-only money permissions, same-org target user.
  const supabase = createServiceClient()

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

  // The two money permissions are owner-only (Settings > Money access).
  if (isMoneyPermissionName(permission_name) && !(await actorIsOwner(supabase, profile.id))) {
    return NextResponse.json({ error: 'Only an owner can change money access' }, { status: 403 })
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
      granted_by: profile.id,
      notes,
    }, {
      onConflict: 'user_id,permission_id'
    })

  if (error) {
    console.error('Permission write failed:', error)
    return NextResponse.json({ error: 'Failed to update permission' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

// DELETE - Revoke a permission from a user
export async function DELETE(request: NextRequest) {
  let profile
  try {
    ;({ profile } = await requireAuthApi())
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check if requester is admin
  if (!(isOrgSuperuserRoleSlug(profile.role) || profile.role === 'regional_manager')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Service client (2026-11-07): RLS writes to user_permissions are being narrowed to admin/owner, so this
  // route's own checks are the gate — role above, owner-only money permissions, same-org target user.
  const supabase = createServiceClient()

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

  // The two money permissions are owner-only (Settings > Money access).
  if (isMoneyPermissionName(permissionName) && !(await actorIsOwner(supabase, profile.id))) {
    return NextResponse.json({ error: 'Only an owner can change money access' }, { status: 403 })
  }

  // Verify target user is in the same org (the delete below is also org-filtered).
  const { data: targetUser } = await supabase
    .from('users')
    .select('org_id')
    .eq('id', userId)
    .single()

  if (!targetUser || targetUser.org_id !== profile.org_id) {
    return NextResponse.json({ error: 'User not found in your organization' }, { status: 404 })
  }

  // Revoke permission
  const { error } = await supabase
    .from('user_permissions')
    .delete()
    .eq('user_id', userId)
    .eq('org_id', profile.org_id)
    .eq('permission_id', permissionData.id)

  if (error) {
    console.error('Permission write failed:', error)
    return NextResponse.json({ error: 'Failed to update permission' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
