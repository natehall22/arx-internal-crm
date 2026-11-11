/** Server side of global search: what a signed-in person may search (the route and the AI connector both ask here). */
import type { SupabaseClient } from '@supabase/supabase-js'

import { resolveEffectivePermissionNames } from '@/lib/effective-permissions'
import { searchGroupsFor, type SearchGroup } from '@/lib/global-search'
import {
  canAccessCustomerRecordsFromPermissionNames,
  canAccessJobBoardFromPermissionNames,
  isOrgSuperuserRoleSlug,
  isRepLikeCustomerRecordRole,
} from '@/lib/permissions'
import { resolveSalesDocAccessBarred } from '@/lib/sales-doc-access'

type Caller = { id: string; role: string; custom_role_id?: string | null }

export async function searchGroupsForCaller(admin: SupabaseClient, userId: string, profile: Caller): Promise<SearchGroup[]> {
  const perms = await resolveEffectivePermissionNames(admin, userId, profile)
  const salesDocBarred = await resolveSalesDocAccessBarred(admin, userId, profile)
  const hasPerm = (...names: string[]) => perms.fullAccess || names.some((n) => perms.permissionNames.has(n))
  return searchGroupsFor({
    userId,
    role: profile.role,
    isSuperuser: isOrgSuperuserRoleSlug(profile.role),
    canCustomers: canAccessCustomerRecordsFromPermissionNames(perms),
    customersRepScoped: isRepLikeCustomerRecordRole(profile.role),
    canJobBoard: canAccessJobBoardFromPermissionNames(perms),
    canProposals: !salesDocBarred,
    canOpportunities: hasPerm('opportunities:view', 'opportunities:edit'),
  })
}
