import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { actorIsOwner, lockMoneyPermissions, moneyPermissionIds } from '@/lib/money-permission-guard'
import { isOrgSuperuserRoleSlug } from '@/lib/org-role-constants'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

// Same roles for reading and writing someone's grants: owners/admins and regional managers.
function canManagePermissions(role: string | null | undefined): boolean {
  return isOrgSuperuserRoleSlug(role) || role === 'regional_manager'
}

async function authorize(): Promise<{ userId: string; orgId: string } | NextResponse> {
  let ctx: Awaited<ReturnType<typeof requireAuthApi>>
  try {
    ctx = await requireAuthApi()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!canManagePermissions(ctx.profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return { userId: ctx.authUser.id, orgId: ctx.profile.org_id }
}

// GET - Get permissions for a specific user in the caller's org
export async function GET(request: NextRequest) {
  const auth = await authorize()
  if (auth instanceof NextResponse) return auth

  const userId = request.nextUrl.searchParams.get('userId')
  if (!userId) {
    return NextResponse.json({ error: 'User ID is required' }, { status: 400 })
  }

  const adminClient = createServiceClient()

  const { data: targetUser } = await adminClient
    .from('users')
    .select('id')
    .eq('id', userId)
    .eq('org_id', auth.orgId)
    .maybeSingle()
  if (!targetUser) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

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
  const auth = await authorize()
  if (auth instanceof NextResponse) return auth
  const user = { id: auth.userId }
  const profile = { org_id: auth.orgId }

  const adminClient = createServiceClient()

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

  // Only an owner may add or remove the money permissions; for anyone else they are left exactly as they were.
  const moneyIds = await moneyPermissionIds(adminClient)
  const savedIds = lockMoneyPermissions(
    Array.isArray(permission_ids) ? permission_ids : [],
    (existingPerms ?? []).map((p: { permission_id: string }) => p.permission_id),
    moneyIds,
    await actorIsOwner(adminClient, user.id)
  )

  if (savedIds.length > 0) {
    const permInserts = savedIds.map((permId: string) => ({
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
