import type { SupabaseClient } from '@supabase/supabase-js'

import { getPermissions } from '@/lib/permissions'
import type { UserRole } from '@/lib/types/database'

const SUPERUSER_ROLES = new Set(['admin', 'owner', 'admin_owner'])

/** DB roles that are not in {@link UserRole} but should use another row’s permission matrix */
const LEGACY_ROLE_MATRIX_ALIASES: Record<string, UserRole> = {
  manager: 'sales_manager',
}

export type EffectivePermissionsResult = {
  /** Admin / owner bypass — treat as all permissions granted */
  fullAccess: boolean
  permissionNames: Set<string>
}

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
  const roleNorm = String(profile.role || '').toLowerCase().trim()
  if (SUPERUSER_ROLES.has(roleNorm)) {
    return { fullAccess: true, permissionNames: new Set() }
  }

  const names = new Set<string>()

  if (profile.custom_role_id) {
    const { data: rps } = await admin
      .from('role_permissions')
      .select('permission:permissions(name)')
      .eq('role_id', profile.custom_role_id)

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

  if (names.has('admin:full')) {
    return { fullAccess: true, permissionNames: new Set() }
  }

  return { fullAccess: false, permissionNames: names }
}

export function effectiveHasPermission(
  result: EffectivePermissionsResult,
  permissionName: string
): boolean {
  if (result.fullAccess) return true
  return result.permissionNames.has(permissionName)
}
