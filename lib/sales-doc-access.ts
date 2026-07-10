import type { SupabaseClient } from '@supabase/supabase-js'

import { resolveEffectivePermissionNames } from '@/lib/effective-permissions'
import { isBarredFromSalesDocAccess } from '@/lib/permissions'

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
