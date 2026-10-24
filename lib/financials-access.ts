/**
 * Two money permissions, split on purpose:
 *   reports:financials - COMPANY financials: profit, margin, cost, other people's pay / commission, company revenue totals, payroll.
 *   money:record       - the job's books: record payments, invoices and job costs, and see the balance owed (ops and admins).
 * Admins / owners have both through full access. Either can be granted to one person (user_permissions) or switched OFF for one
 * person by an owner (permission_denials) - the "off" switch wins even over full access. Grants and changes are audited.
 * "Own" money is never gated by these: a rep's own pay / commission / statement, and a closer's own deals' prices and proposal totals.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { resolveEffectivePermissionNames } from '@/lib/effective-permissions'

export const FINANCIALS_PERMISSION = 'reports:financials'
export const MONEY_RECORD_PERMISSION = 'money:record'

type Perms = { fullAccess: boolean; permissionNames: ReadonlySet<string>; denied?: ReadonlySet<string> }

function has(perms: Perms, name: string): boolean {
  if (perms.denied?.has(name)) return false
  return perms.fullAccess || perms.permissionNames.has(name)
}

export const hasFinancials = (perms: Perms): boolean => has(perms, FINANCIALS_PERMISSION)
export const hasMoneyRecord = (perms: Perms): boolean => has(perms, MONEY_RECORD_PERMISSION)

type Caller = { id: string; role: string; custom_role_id?: string | null }

export async function canSeeFinancials(admin: SupabaseClient, profile: Caller): Promise<boolean> {
  return hasFinancials(await resolveEffectivePermissionNames(admin, profile.id, profile))
}

export async function canRecordMoney(admin: SupabaseClient, profile: Caller): Promise<boolean> {
  return hasMoneyRecord(await resolveEffectivePermissionNames(admin, profile.id, profile))
}
