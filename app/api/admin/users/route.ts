import { getAppUrl } from '@/lib/app-url'
import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi, type AuthContext } from '@/lib/auth'
import { isOrgSuperuserRoleSlug } from '@/lib/permissions'
import { getCrmEmailFrom, getMailTransport } from '@/lib/setter-email'
import { createServiceClient } from '@/lib/supabase/service'
import { actorIsOwner, isMoneyPermissionName, lockMoneyPermissions, moneyPermissionIds } from '@/lib/money-permission-guard'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

type OrgRefs = { custom_role_id?: unknown; team_id?: unknown; region_id?: unknown; manager_user_id?: unknown }
const ORG_REF_TABLES: Array<[keyof OrgRefs, string]> = [
  ['custom_role_id', 'custom_roles'],
  ['team_id', 'teams'],
  ['region_id', 'regions'],
  ['manager_user_id', 'users'],
]

/** Every role/team/region/manager id in a user write must be a row of the caller's org (security audit H1). */
async function foreignOrgRef(
  adminClient: ReturnType<typeof createServiceClient>,
  orgId: string,
  refs: OrgRefs
): Promise<string | null> {
  for (const [field, table] of ORG_REF_TABLES) {
    const value = refs[field]
    if (!value) continue
    if (typeof value !== 'string') return field
    const { data } = await adminClient.from(table).select('id').eq('id', value).eq('org_id', orgId).maybeSingle()
    if (!data) return field
  }
  return null
}

export async function POST(request: NextRequest) {
  try {
    let user: AuthContext['authUser']
    let profile: AuthContext['profile']
    try {
      ;({ authUser: user, profile } = await requireAuthApi())
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = createServiceClient()

    if (
      !profile ||
      !(isOrgSuperuserRoleSlug(profile.role) ||
        ['regional_manager', 'regional_setter_manager'].includes(profile.role))
    ) {
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
      dashboard_view,
    } = body

    if (!email || !password || !full_name) {
      return NextResponse.json({ error: 'Email, password, and full name are required' }, { status: 400 })
    }

    if (password.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 })
    }

    // New users always join the admin's own company. A body org_id may only repeat it.
    if (org_id && org_id !== profile.org_id) {
      return NextResponse.json({ error: 'Cannot create users in a different organization' }, { status: 403 })
    }
    const targetOrgId: string = profile.org_id

    if (isOrgSuperuserRoleSlug(role) && !isOrgSuperuserRoleSlug(profile.role)) {
      return NextResponse.json({ error: 'Only an admin can create an admin' }, { status: 403 })
    }

    const badRef = await foreignOrgRef(adminClient, profile.org_id, { custom_role_id, team_id, region_id, manager_user_id })
    if (badRef) {
      return NextResponse.json({ error: `Invalid ${badRef}` }, { status: 400 })
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
        dashboard_view: dashboard_view === 'ops' ? 'ops' : 'sales',
      })

    if (profileError) {
      console.error('Profile error:', profileError)
      await adminClient.auth.admin.deleteUser(authData.user.id)
      return NextResponse.json({ error: `Failed to create user profile: ${profileError.message}` }, { status: 500 })
    }

    // Money permissions can only be given by an owner (use Settings > Money access).
    const newUserPermissionIds = lockMoneyPermissions(Array.isArray(permission_ids) ? permission_ids : [], [], await moneyPermissionIds(adminClient), await actorIsOwner(adminClient, user.id))
    if (newUserPermissionIds.length > 0) {
      const permissionInserts = newUserPermissionIds.map((permId: string) => ({
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
    let user: AuthContext['authUser']
    let profile: AuthContext['profile']
    try {
      ;({ authUser: user, profile } = await requireAuthApi())
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = createServiceClient()

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
  let user: AuthContext['authUser']
  let profile: AuthContext['profile']
  try {
    ;({ authUser: user, profile } = await requireAuthApi())
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const adminClient = createServiceClient()

  if (
    !profile ||
    !(isOrgSuperuserRoleSlug(profile.role) ||
      ['regional_manager', 'regional_setter_manager', 'sales_manager', 'setter_manager'].includes(
        profile.role,
      ))
  ) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const { id, email, phone, full_name, role, custom_role_id, team_id, region_id, manager_user_id, active, canvass_pin_visibility, show_in_reports, can_receive_appointments, dashboard_view } = body

  if (!id) {
    return NextResponse.json({ error: 'User ID is required' }, { status: 400 })
  }

  // Verify target user is in same org
  const { data: targetUser } = await adminClient
    .from('users')
    .select('org_id, email, role, custom_role_id')
    .eq('id', id)
    .single()

  if (!targetUser || targetUser.org_id !== profile.org_id) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  // Security audit H1 (2026-11-07): managers may edit users, but not admins/owners, not roles, and nobody
  // changes their own role or switches themselves off.
  const callerIsSuperuser = isOrgSuperuserRoleSlug(profile.role)
  const isSelf = id === user.id
  if (!callerIsSuperuser && isOrgSuperuserRoleSlug(targetUser.role)) {
    return NextResponse.json({ error: 'Only an admin can edit an admin' }, { status: 403 })
  }
  if (role !== undefined && role !== targetUser.role) {
    if (!callerIsSuperuser) {
      return NextResponse.json({ error: 'Only an admin can change roles' }, { status: 403 })
    }
    if (isSelf) {
      return NextResponse.json({ error: 'You cannot change your own role' }, { status: 403 })
    }
  }
  if (isSelf && custom_role_id !== undefined && (custom_role_id || null) !== (targetUser.custom_role_id ?? null)) {
    return NextResponse.json({ error: 'You cannot change your own role' }, { status: 403 })
  }
  if (isSelf && active === false) {
    return NextResponse.json({ error: 'You cannot deactivate yourself' }, { status: 403 })
  }
  const badRef = await foreignOrgRef(adminClient, profile.org_id, { custom_role_id, team_id, region_id, manager_user_id })
  if (badRef) {
    return NextResponse.json({ error: `Invalid ${badRef}` }, { status: 400 })
  }

  // Handle email change - requires updating Supabase Auth
  if (email && email !== targetUser.email) {
    // Only admins can change email addresses
    if (!isOrgSuperuserRoleSlug(profile.role)) {
      return NextResponse.json({ error: 'Only admins can change email addresses' }, { status: 403 })
    }

    // Check if email is already in use
    // org-scope-ok: sign-in emails are unique across every company (one auth.users table), so this check is global on purpose
    const { data: existingUser } = await adminClient
      .from('users')
      .select('id')
      .eq('email', email)
      .neq('id', id)
      .single()

    if (existingUser) {
      return NextResponse.json({ error: 'Email address is already in use' }, { status: 400 })
    }

    // Update email in Supabase Auth
    const { error: authUpdateError } = await adminClient.auth.admin.updateUserById(id, {
      email: email,
      email_confirm: true,
    })

    if (authUpdateError) {
      console.error('Auth email update error:', authUpdateError)
      console.error('admin/users: email update failed:', authUpdateError.message)
      return NextResponse.json({ error: 'Failed to update email' }, { status: 500 })
    }
  }

  const updateData: Record<string, unknown> = {}
  if (email !== undefined) updateData.email = email
  if (phone !== undefined) updateData.phone = phone || null
  if (full_name !== undefined) updateData.full_name = full_name
  if (role !== undefined) updateData.role = role
  if (custom_role_id !== undefined) updateData.custom_role_id = custom_role_id || null
  if (team_id !== undefined) updateData.team_id = team_id || null
  if (region_id !== undefined) updateData.region_id = region_id || null
  if (manager_user_id !== undefined) updateData.manager_user_id = manager_user_id || null
  if (active !== undefined) updateData.active = active
  if (canvass_pin_visibility !== undefined) updateData.canvass_pin_visibility = canvass_pin_visibility
  if (show_in_reports !== undefined) updateData.show_in_reports = show_in_reports
  if (can_receive_appointments !== undefined) updateData.can_receive_appointments = can_receive_appointments
  if (dashboard_view !== undefined) updateData.dashboard_view = dashboard_view

  const { error: updateError } = await adminClient
    .from('users')
    .update(updateData)
    .eq('id', id)
    .eq('org_id', profile.org_id)

  if (updateError) {
    console.error('Update user error:', updateError)
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 })
  }

  if (active !== undefined) {
    try {
      if (active === false) {
        const { error: banErr } = await adminClient.auth.admin.updateUserById(id, {
          ban_duration: '876000h',
        })
        if (banErr) console.error('Disable user: auth ban', banErr)
      } else {
        const { error: unbanErr } = await adminClient.auth.admin.updateUserById(id, {
          ban_duration: 'none',
        })
        if (unbanErr) console.error('Enable user: auth unban', unbanErr)
      }
    } catch (authSyncErr) {
      console.error('Auth ban sync for user', id, authSyncErr)
    }
  }

  return NextResponse.json({ success: true })
}

// DELETE - Delete a user
export async function DELETE(request: NextRequest) {
  try {
    let user: AuthContext['authUser']
    let profile: AuthContext['profile']
    try {
      ;({ authUser: user, profile } = await requireAuthApi())
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = createServiceClient()

    if (!profile || !isOrgSuperuserRoleSlug(profile.role)) {
      return NextResponse.json({ error: 'Forbidden - Admin access required' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('id')

    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 })
    }

    // Prevent self-deletion
    if (userId === user.id) {
      return NextResponse.json({ error: 'Cannot delete your own account' }, { status: 400 })
    }

    // Verify target user is in same org
    const { data: targetUser } = await adminClient
      .from('users')
      .select('org_id, email')
      .eq('id', userId)
      .single()

    if (!targetUser || targetUser.org_id !== profile.org_id) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Delete user permissions first
    await adminClient
      .from('user_permissions')
      .delete()
      .eq('user_id', userId)

    // Delete user profile
    const { error: profileDeleteError } = await adminClient
      .from('users')
      .delete()
      .eq('id', userId)

    if (profileDeleteError) {
      console.error('Profile delete error:', profileDeleteError)
      // time_entries.user_id is ON DELETE RESTRICT: clock time is a pay record and is never deleted with a person.
      if ((profileDeleteError as { code?: string }).code === '23503' && /time_entries/.test(String(profileDeleteError.message ?? ''))) {
        return NextResponse.json({ error: 'This person has time clock records. Turn their account off (deactivate) instead of deleting it.' }, { status: 409 })
      }
      return NextResponse.json({ error: 'Failed to delete user profile' }, { status: 500 })
    }

    // Delete auth user
    const { error: authDeleteError } = await adminClient.auth.admin.deleteUser(userId)

    if (authDeleteError) {
      console.error('Auth delete error:', authDeleteError)
      // Profile already deleted, so just log the error
    }

    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('Delete user error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH - Send password reset email
export async function PATCH(request: NextRequest) {
  try {
    let user: AuthContext['authUser']
    let profile: AuthContext['profile']
    try {
      ;({ authUser: user, profile } = await requireAuthApi())
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = createServiceClient()

    if (
      !profile ||
      !(isOrgSuperuserRoleSlug(profile.role) ||
        ['regional_manager', 'regional_setter_manager'].includes(profile.role))
    ) {
      return NextResponse.json({ error: 'Forbidden - Admin access required' }, { status: 403 })
    }

    const body = await request.json()
    const { userId, action } = body

    if (!userId || action !== 'reset_password') {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }

    // Verify target user is in same org
    const { data: targetUser } = await adminClient
      .from('users')
      .select('org_id, email')
      .eq('id', userId)
      .single()

    if (!targetUser || targetUser.org_id !== profile.org_id) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // The emailed link lands on the configured app address (it must be on Supabase Auth's redirect allow-list,
    // docs/domain-cutover.md). Checked before a recovery token is minted.
    let appUrl: string
    try {
      appUrl = getAppUrl()
    } catch {
      return NextResponse.json({ error: 'The app address is not configured, so a reset link cannot be built.' }, { status: 500 })
    }

    // Generate password reset link using Supabase Admin API
    const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
      type: 'recovery',
      email: targetUser.email,
    })

    if (linkError) {
      console.error('Generate link error:', linkError)
      return NextResponse.json({ error: 'Failed to generate reset link' }, { status: 500 })
    }

    const resetLink = linkData.properties.action_link
    // Replace Supabase redirect with our app's reset-password page
    const finalLink = resetLink.replace(
      /redirect_to=[^&]*/,
      `redirect_to=${encodeURIComponent(`${appUrl}/reset-password`)}`
    )

    const transporter = getMailTransport()
    await transporter.sendMail({
      from: getCrmEmailFrom(),
      to: targetUser.email,
      subject: 'Reset your ARX password',
      html: `
        <p>You've been sent a password reset link by your administrator.</p>
        <p><a href="${finalLink}" style="background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block;">Reset Password</a></p>
        <p style="color:#6B7280;font-size:13px;">This link expires in 1 hour. If you didn't request this, you can ignore this email.</p>
      `,
    })

    return NextResponse.json({ success: true, message: 'Password reset email sent' })

  } catch (error) {
    console.error('Password reset error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
