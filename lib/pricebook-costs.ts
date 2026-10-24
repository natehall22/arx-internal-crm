/**
 * Pricebook COST and MARGIN columns are for owners, admins and ops only. Sales roles see sell prices.
 * The database already refuses these columns to every user token (migration 202610290080 column privileges), so they only ever reach
 * a page through the service role - and this strips them for anyone who may not see them. One list, used by every reader.
 */
import { isPayrollAdminRole } from '@/lib/payroll-admin-access'

export const PRICEBOOK_COST_FIELDS = ['cost_price', 'material_cost', 'labor_cost', 'profit_margin_percent'] as const
/** Derived by the proposal builder from the roofing type's cost columns. */
const DERIVED_COST_FIELDS = ['material_cost_per_square', 'labor_cost_per_square'] as const

export function canSeePricebookCosts(role: string | null | undefined, isSuperAdmin?: boolean | null): boolean {
  return !!isSuperAdmin || isPayrollAdminRole(role)
}

export function stripPricebookCosts<T extends Record<string, unknown>>(rows: T[] | null | undefined, role: string | null | undefined, isSuperAdmin?: boolean | null): T[] {
  const list = rows ?? []
  if (canSeePricebookCosts(role, isSuperAdmin)) return list
  return list.map((row) => {
    const out: Record<string, unknown> = { ...row }
    for (const f of PRICEBOOK_COST_FIELDS) delete out[f]
    for (const f of DERIVED_COST_FIELDS) delete out[f]
    return out as T
  })
}
