import type { SupabaseClient } from '@supabase/supabase-js'

import { getPermissions, isFieldRoleLike } from '@/lib/permissions'
import { ORG_SUPERUSER_ROLE_SLUGS } from '@/lib/org-role-constants'
import type { UserRole } from '@/lib/types/database'

/** Org superusers — same unrestricted access (`fullAccess`). Legacy `owner` slug is normalized to `admin` via migration; both remain in enum set until Postgres cleanup. */

/** DB roles that are not in {@link UserRole} but should use another row’s permission matrix */
const LEGACY_ROLE_MATRIX_ALIASES: Record<string, UserRole> = {
  manager: 'sales_manager',
  closer: 'sales_rep',
}

/**
 * Setters, canvassers and inside sales never reach production or money screens: no job board, ops dashboard, job financials or
 * job edits — whatever a custom role or a per-user grant says. Applied BEFORE grants are returned, so every consumer (nav, Today,
 * route guards, thread viewer, search, AI) obeys it from this one place. Owners (full access) are never field roles.
 */
const FIELD_ROLE_DENIED_PERMISSION_PREFIXES = ['jobs:', 'ops:', 'money:']

export type EffectivePermissionsResult = {
  /** Explicit full-access result from admin/owner roles or admin:full permission */
  fullAccess: boolean
  permissionNames: Set<string>
  /**
   * Permissions an owner has switched OFF for this one person (table permission_denials), even over full access.
   * Only the permissions in DENIABLE_PERMISSIONS can be denied; hasFinancials / hasMoneyRecord honour it.
   */
  denied?: ReadonlySet<string>
}

/** The only permissions a per-user "off" switch applies to. */
export const DENIABLE_PERMISSIONS = ['reports:financials', 'money:record'] as const

/**
 * Resolved permission names for RBAC navigation and route guards.
 * - Legacy roles without `custom_role_id`: matrix from {@link getPermissions}.
 * - `custom_role_id` set: only permissions from that role + `user_permissions` extras (not the generic `custom` matrix).
 */
export async function resolveEffectivePermissionNames(
  admin: SupabaseClient,
  userId: string,
  profile: { role: string; custom_role_id?: string | null }
): Promise<EffectivePermissionsResult> {
  const [base, { data: denials, error: denialError }] = await Promise.all([
    resolveBasePermissionNames(admin, userId, profile),
    admin.from('permission_denials').select('permission_name').eq('user_id', userId),
  ])
  const denied = new Set<string>((denials ?? []).map((d: { permission_name: string }) => d.permission_name))
  if (denialError && denialError.code !== '42P01') {
    // Fail closed: if the OFF switches cannot be read, the two money permissions are treated as off for this request.
    console.error('[permissions] could not read permission_denials; money permissions treated as off', denialError.message)
    for (const name of DENIABLE_PERMISSIONS) denied.add(name)
  }
  return denied.size > 0 ? { ...base, denied } : base
}

async function resolveBasePermissionNames(
  admin: SupabaseClient,
  userId: string,
  profile: { role: string; custom_role_id?: string | null }
): Promise<EffectivePermissionsResult> {
  const roleNorm = String(profile.role || '').toLowerCase().trim()
  if (ORG_SUPERUSER_ROLE_SLUGS.has(roleNorm)) {
    return { fullAccess: true, permissionNames: new Set() }
  }

  const names = new Set<string>()
  let customRoleName: string | null = null
  let customRoleDisplayName: string | null = null

  if (profile.custom_role_id) {
    // Role name (for the field-role deny) and its grants, in parallel: one round trip, not two.
    const [{ data: cr }, { data: rps }] = await Promise.all([
      admin.from('custom_roles').select('name, display_name').eq('id', profile.custom_role_id).maybeSingle(),
      admin.from('role_permissions').select('permission:permissions(name)').eq('role_id', profile.custom_role_id),
    ])
    customRoleName = (cr?.name as string | null) ?? null
    customRoleDisplayName = (cr?.display_name as string | null) ?? null

    for (const rp of rps || []) {
      const p = (rp as { permission?: { name?: string } | { name?: string }[] | null }).permission
      const n = Array.isArray(p) ? p[0]?.name : p?.name
      if (n) names.add(n)
    }
  } else {
    const matrixRole = LEGACY_ROLE_MATRIX_ALIASES[roleNorm] ?? (roleNorm as UserRole)
    for (const p of getPermissions(matrixRole)) {
      names.add(p)
    }
  }

  const { data: ups } = await admin
    .from('user_permissions')
    .select('permission:permissions(name)')
    .eq('user_id', userId)

  for (const row of ups || []) {
    const p = (row as { permission?: { name?: string } | { name?: string }[] | null }).permission
    const n = Array.isArray(p) ? p[0]?.name : p?.name
    if (n) names.add(n)
  }

  // Field-role hard deny, before any grant is honoured (see FIELD_ROLE_DENIED_PERMISSION_PREFIXES). By role and role NAME only —
  // never inferred from permissions, so granting an ops person a queue permission cannot cost them the job board.
  if (isFieldRoleLike({ role: roleNorm, customRoleName, customRoleDisplayName })) {
    // (an admin:full grant is a grant too: a field role is never promoted to full access)
    for (const n of Array.from(names)) if (n === 'admin:full' || FIELD_ROLE_DENIED_PERMISSION_PREFIXES.some((pre) => n.startsWith(pre))) names.delete(n)
  }

  if (names.has('admin:full')) {
    return { fullAccess: true, permissionNames: new Set() }
  }

  // Every role — custom roles included — can open Referral Partners. If a new custom role
  // lacked this, those reps would simply never find the page.
  names.add('referral_partners:view')

  return { fullAccess: false, permissionNames: names }
}

export function effectiveHasPermission(
  result: EffectivePermissionsResult,
  permissionName: string
): boolean {
  if (result.fullAccess) return true
  return result.permissionNames.has(permissionName)
}
