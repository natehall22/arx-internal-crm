/** Funding target: original contract + all signed change order totals (not only commissionable). */
export function fundingRequiredTotal(input: {
  originalContractTotal: number
  signedChangeOrderTotal: number
}): number {
  return Math.round((input.originalContractTotal + input.signedChangeOrderTotal) * 100) / 100
}
