import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveEffectivePermissionNames } from '@/lib/effective-permissions'
import { hasMoneyRecord } from '@/lib/financials-access'

type MaybeString = string | null | undefined

function normalizeLabel(value: MaybeString): string {
  return (value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
}

function isFinanceAdminLabel(value: MaybeString): boolean {
  const normalized = normalizeLabel(value)
  return normalized === 'finance_admin'
}

/** The finance_admin custom-role label (a custom role named so records money without holding money:record). */
function hasFinanceAdminLabel(args: { customRoleName?: MaybeString; customRoleDisplayName?: MaybeString }): boolean {
  return isFinanceAdminLabel(args.customRoleName) || isFinanceAdminLabel(args.customRoleDisplayName)
}

/**
 * Job-billing gate for a caller resolved by `requireAuthApi()`.
 *
 * Job billing = the `money:record` permission (ops and admins by default; grantable, and an owner can switch it off for one
 * person), plus the legacy `finance_admin` custom-role label. The single home for the check; every route and page asks here.
 *
 */
export async function callerCanAccessJobBilling(
  admin: SupabaseClient,
  profile: { id: string; role?: MaybeString; custom_role_id?: string | null }
): Promise<boolean> {
  const perms = await resolveEffectivePermissionNames(admin, profile.id, { role: String(profile.role ?? ''), custom_role_id: profile.custom_role_id })
  // An owner's OFF switch wins over everything below, including the finance_admin role label.
  if (perms.denied?.has('money:record')) return false
  if (hasMoneyRecord(perms)) return true
  if (!profile.custom_role_id) return false
  const { data: customRole } = await admin.from('custom_roles').select('name, display_name').eq('id', profile.custom_role_id).maybeSingle()
  return hasFinanceAdminLabel({ customRoleName: customRole?.name, customRoleDisplayName: customRole?.display_name })
}
