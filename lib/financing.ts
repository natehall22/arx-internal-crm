/**
 * Dealer fee is a percentage of the financed contract total T.
 * Given base project total P (tax-included proposal total before gross-up),
 * T = P / (1 - r) where r = dealer_fee_percent / 100, so net after fee = T * (1 - r) = P.
 */
export function computeFinancedContractTotal(
  baseProjectTotal: number,
  dealerFeePercent: number | null | undefined
): { financedContractTotal: number; dealerFeeAmount: number } {
  const p = Math.round((Number(baseProjectTotal) || 0) * 100) / 100
  const pct = Number(dealerFeePercent)
  if (!Number.isFinite(pct) || pct <= 0) {
    return { financedContractTotal: p, dealerFeeAmount: 0 }
  }
  const r = pct / 100
  if (r >= 1) {
    return { financedContractTotal: p, dealerFeeAmount: 0 }
  }
  const t = Math.round((p / (1 - r)) * 100) / 100
  const fee = Math.round((t - p) * 100) / 100
  return { financedContractTotal: t, dealerFeeAmount: fee }
}

export function principalForMonthlyPayment(
  proposalTotal: number,
  financedContractTotal: number | null | undefined,
  financingAvailable: boolean
): number {
  if (financingAvailable && financedContractTotal != null && financedContractTotal > 0) {
    return financedContractTotal
  }
  return proposalTotal
}

/** Net $ commission rates apply to when fee is r% of financed contract total T. */
export function netCommissionableFromFinancedTotal(
  financedTotal: number,
  dealerFeePercent: number
): number {
  const t = Math.round((Number(financedTotal) || 0) * 100) / 100
  const r = Number(dealerFeePercent) || 0
  if (!Number.isFinite(r) || r <= 0) return t
  const pct = Math.min(Math.max(r, 0), 99.99) / 100
  return Math.round(t * (1 - pct) * 100) / 100
}

/** Net commissionable from stored job sale_amount and dealer_fee_amount. */
export function netCommissionableFromJob(
  saleAmount: number | null | undefined,
  dealerFeeAmount: number | null | undefined
): number {
  const t = Math.round((Number(saleAmount) || 0) * 100) / 100
  const f = Math.round((Number(dealerFeeAmount) || 0) * 100) / 100
  return Math.max(0, Math.round((t - f) * 100) / 100)
}
