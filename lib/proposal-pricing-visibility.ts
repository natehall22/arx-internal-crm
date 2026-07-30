const toCents = (value: number) => Math.round((Number(value) || 0) * 100)

/**
 * Customer-facing pricing should collapse to one all-in amount when financing
 * increases the quoted contract total above the normal tax-included total.
 */
export function shouldShowOnlyTotalInvestment(
  quotedTotal: number,
  standardTotal: number
): boolean {
  return toCents(quotedTotal) > toCents(standardTotal)
}
