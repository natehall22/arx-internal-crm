import type { SupabaseClient } from '@supabase/supabase-js'

import { hasPermission, type PermissionName } from '@/lib/permissions'
import type { UserRole } from '@/lib/types/database'

const SCHEDULING_CREATE: PermissionName = 'scheduling:create'

/**
 * True if the user may use CRM lead inspection scheduling (team round-robin + individual closers).
 * Combines legacy role matrix, custom role permissions, and direct user_permissions grants.
 */
export async function userHasSchedulingCreate(
  admin: SupabaseClient,
  userId: string,
  profile: { role: string; custom_role_id?: string | null }
): Promise<boolean> {
  if (hasPermission(profile.role as UserRole, SCHEDULING_CREATE)) return true

  if (profile.custom_role_id) {
    /** `role_permissions.role_id` → `custom_roles.id` (same value as users.custom_role_id) */
    const { data: rps } = await admin
      .from('role_permissions')
      .select('permission:permissions(name)')
      .eq('role_id', profile.custom_role_id)

    for (const rp of rps || []) {
      const p = (rp as { permission?: { name?: string } | { name?: string }[] | null }).permission
      const name = Array.isArray(p) ? p[0]?.name : p?.name
      if (name === 'admin:full' || name === SCHEDULING_CREATE) return true
    }
  }

  const { data: permRow } = await admin.from('permissions').select('id').eq('name', SCHEDULING_CREATE).maybeSingle()
  if (!permRow?.id) return false

  const { data: up } = await admin
    .from('user_permissions')
    .select('id')
    .eq('user_id', userId)
    .eq('permission_id', permRow.id)
    .maybeSingle()

  return !!up
}
