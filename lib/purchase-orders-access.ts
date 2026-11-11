/**
 * Who may do what with purchase orders. One place, used by every PO route.
 *   view     = the job board (job-board roles)
 *   edit/send = ops `jobs:edit` (or full access) or an owner — the same people who may send a materials order
 *   money    = unit costs, totals and bills are shown to editors and anyone with job financials
 *   bill     = money:record (the same rule as adding a job cost)
 * Field roles (setters, canvassers, inside sales) never pass: they have no job-board access.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { callerCanAccessJobBilling } from '@/lib/finance-access'
import { resolveOpsAccess } from '@/lib/ops-access'
import { isSuperAdmin, type SuperAdminProfile } from '@/lib/super-admin'

export type PoAccess = { canView: boolean; canEdit: boolean; canSeeMoney: boolean; canBill: boolean }

export async function resolvePoAccess(
  admin: SupabaseClient,
  userId: string,
  profile: { role: string; custom_role_id?: string | null } & NonNullable<SuperAdminProfile>
): Promise<PoAccess> {
  const ops = await resolveOpsAccess(admin, userId, profile)
  const canEdit = ops.canJobBoard && (ops.canEditJobs || isSuperAdmin(profile))
  return {
    canView: ops.canJobBoard,
    canEdit,
    canSeeMoney: ops.canJobBoard && (canEdit || ops.canViewJobFinancials),
    canBill: ops.canJobBoard && (await callerCanAccessJobBilling(admin, profile as never)),
  }
}
