import type { SupabaseClient } from '@supabase/supabase-js'

import { resolveEffectivePermissionNames } from '@/lib/effective-permissions'
import { isBarredFromSalesDocAccess, isFieldRoleLike } from '@/lib/permissions'

/**
 * Server-side: resolve whether the user is barred from proposals, contracts, roof measure, etc.
 * Uses base role, custom role labels, and effective permission grants (Inside Sales preset).
 */
export async function resolveSalesDocAccessBarred(
  admin: SupabaseClient,
  userId: string,
  profile: { role: string; custom_role_id?: string | null }
): Promise<boolean> {
  if (isBarredFromSalesDocAccess(profile.role)) {
    return true
  }

  let customRoleName: string | null = null
  let customRoleDisplayName: string | null = null
  if (profile.custom_role_id) {
    const { data: customRole } = await admin
      .from('custom_roles')
      .select('name, display_name')
      .eq('id', profile.custom_role_id)
      .maybeSingle()
    customRoleName = customRole?.name ?? null
    customRoleDisplayName = customRole?.display_name ?? null
  }

  const { permissionNames } = await resolveEffectivePermissionNames(admin, userId, profile)
  return isBarredFromSalesDocAccess({
    role: profile.role,
    customRoleName,
    customRoleDisplayName,
    permissionNames,
  })
}

/**
 * Field role (setter / canvasser / inside sales / call center, by role slug or custom-role name — isFieldRoleLike) OR barred
 * from sales docs. These people never read or add contracts, production or money files. Used by the `files` read route
 * (GET /api/files/object) and the customer file upload routes, so both answer "may this person touch staff files" the same way.
 */
export async function resolveFieldOrSalesDocBarred(
  admin: SupabaseClient,
  profile: { id: string; role: string; custom_role_id?: string | null }
): Promise<boolean> {
  let customRoleName: string | null = null
  let customRoleDisplayName: string | null = null
  if (profile.custom_role_id) {
    const { data } = await admin.from('custom_roles').select('name, display_name').eq('id', profile.custom_role_id).maybeSingle()
    customRoleName = data?.name ?? null
    customRoleDisplayName = data?.display_name ?? null
  }
  if (isFieldRoleLike({ role: profile.role, customRoleName, customRoleDisplayName })) return true
  return resolveSalesDocAccessBarred(admin, profile.id, { role: profile.role, custom_role_id: profile.custom_role_id ?? null })
}
