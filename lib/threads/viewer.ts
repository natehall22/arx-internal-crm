import type { SupabaseClient } from '@supabase/supabase-js'

import { resolveOpsAccess } from '@/lib/ops-access'
import { isOrgSuperuserRoleSlug } from '@/lib/org-role-constants'
import { resolveSalesDocAccessBarred } from '@/lib/sales-doc-access'
import { isSuperAdmin } from '@/lib/super-admin'
import { isInsideSalesRoleLike } from '@/lib/inside-sales-follow-up'
import type { ThreadViewer } from '@/lib/threads/visibility'

export type ViewerProfile = {
  id: string
  org_id: string
  role: string
  custom_role_id?: string | null
  is_super_admin?: boolean | null
  active?: boolean | null
}

const MANAGER_LIKE = new Set(['manager', 'sales_manager', 'regional_manager', 'operations'])
const CLOSER_LIKE = new Set(['rep', 'sales_rep', 'closer'])

/** The one place a user becomes a ThreadViewer (the thing every thread read/write rule takes). */
export async function resolveThreadViewer(admin: SupabaseClient, profile: ViewerProfile): Promise<ThreadViewer> {
  const role = String(profile.role || '').toLowerCase().trim()
  let customRoleName: string | null = null
  let customRoleDisplayName: string | null = null
  if (profile.custom_role_id) {
    const { data: cr } = await admin.from('custom_roles').select('name, display_name').eq('id', profile.custom_role_id).maybeSingle()
    customRoleName = cr?.name ?? null
    customRoleDisplayName = cr?.display_name ?? null
  }
  const insideSales = isInsideSalesRoleLike({ role, customRoleName, customRoleDisplayName })
  const [ops, pricingBarred] = await Promise.all([
    resolveOpsAccess(admin, profile.id, { role: profile.role, custom_role_id: profile.custom_role_id ?? null }),
    resolveSalesDocAccessBarred(admin, profile.id, { role: profile.role, custom_role_id: profile.custom_role_id ?? null }),
  ])
  const ownerLike = isOrgSuperuserRoleSlug(role) || isSuperAdmin(profile)
  return {
    userId: profile.id,
    orgId: profile.org_id,
    ownerLike,
    jobBoard: ops.canJobBoard,
    jobEdit: ops.canEditJobs,
    jobFinancials: ops.canViewJobFinancials,
    managerLike: MANAGER_LIKE.has(role),
    closerLike: CLOSER_LIKE.has(role),
    // Setters/canvassers see only deals they set or own; inside sales work the whole queue (but never pricing/production).
    setterLike: (role === 'setter' || role === 'canvasser') && !insideSales,
    pricingBarred,
    insideSales,
  }
}
