/**
 * Pricebook COST and MARGIN columns need reports:financials (owners / admins by default; grantable). Sales roles see sell prices.
 * The database already refuses these columns to every user token (migration 202610290080 column privileges), so they only ever reach
 * a page through the service role - and this strips them for anyone without the permission. One list, used by every reader.
 * Callers decide `canSeeCosts` once with canSeeFinancials() (lib/financials-access.ts).
 */
export const PRICEBOOK_COST_FIELDS = ['cost_price', 'material_cost', 'labor_cost', 'profit_margin_percent'] as const
/** Derived by the proposal builder from the roofing type's cost columns. */
const DERIVED_COST_FIELDS = ['material_cost_per_square', 'labor_cost_per_square'] as const

export function stripPricebookCosts<T extends Record<string, unknown>>(rows: T[] | null | undefined, canSeeCosts: boolean): T[] {
  const list = rows ?? []
  if (canSeeCosts) return list
  return list.map((row) => {
    const out: Record<string, unknown> = { ...row }
    for (const f of PRICEBOOK_COST_FIELDS) delete out[f]
    for (const f of DERIVED_COST_FIELDS) delete out[f]
    return out as T
  })
}
