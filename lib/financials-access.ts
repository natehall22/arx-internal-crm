/**
 * ONE permission decides who sees financial data in reports and everything that mirrors them: revenue, sale amounts, payments,
 * job costs, profit / margin, commission base, pay, and pricebook cost. `reports:financials` - owners / admins by default (full access),
 * grantable to anyone later from the permissions screen without a code change.
 * (Job payments and balance owed stay with the job-money permission ops uses to record payments; this is the reporting-grade view.)
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { resolveEffectivePermissionNames } from '@/lib/effective-permissions'

export const FINANCIALS_PERMISSION = 'reports:financials'

export function hasFinancials(perms: { fullAccess: boolean; permissionNames: ReadonlySet<string> }): boolean {
  return perms.fullAccess || perms.permissionNames.has(FINANCIALS_PERMISSION)
}

export async function canSeeFinancials(
  admin: SupabaseClient,
  profile: { id: string; role: string; custom_role_id?: string | null }
): Promise<boolean> {
  return hasFinancials(await resolveEffectivePermissionNames(admin, profile.id, profile))
}
