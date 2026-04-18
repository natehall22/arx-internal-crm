import { normalizeCommissionBaseForPayroll } from '@/lib/weekly-payroll/explicit-rules'

/**
 * Commission base for weekly payroll (spec):
 * original_contract_total + commissionable_change_orders - dealer_fee - deductible_costs
 * All amounts are dollars (number). May be negative before clamp — use
 * `commissionBaseFromPartsForPayroll` for payout math.
 */
export function commissionBaseFromParts(input: {
  originalContractTotal: number
  commissionableChangeOrderTotal: number
  dealerFee: number
  /** Sum of approved cost lines that deduct from base */
  deductibleCosts: number
}): number {
  const base =
    input.originalContractTotal +
    input.commissionableChangeOrderTotal -
    input.dealerFee -
    input.deductibleCosts
  return Math.round(base * 100) / 100
}

/** Same formula as `commissionBaseFromParts`, then applies explicit non-negative payroll rule. */
export function commissionBaseFromPartsForPayroll(input: Parameters<typeof commissionBaseFromParts>[0]) {
  return normalizeCommissionBaseForPayroll(commissionBaseFromParts(input))
}

/** Funding target: original contract + all signed change order totals (not only commissionable). */
export function fundingRequiredTotal(input: {
  originalContractTotal: number
  signedChangeOrderTotal: number
}): number {
  return Math.round((input.originalContractTotal + input.signedChangeOrderTotal) * 100) / 100
}
