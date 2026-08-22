import { roundMoney } from '@/lib/money'

const toCents = (value: number) => Math.round((Number(value) || 0) * 100)
const fromCents = (cents: number) => cents / 100

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

export type ProposalPricingInput = {
  subtotal?: number | null
  discount_amount?: number | null
  discount_percent?: number | null
  tax_rate?: number | null
  financing_available?: boolean | null
  financed_contract_total?: number | null
  monthly_payment?: number | null
  financing_term_months?: number | null
  financing_rate?: number | null
}

export type SelectedProposalFinancing = {
  monthly_payment: number
  term_months: number
  interest_rate: number
}

export function getProposalDisplayPricing(proposal: ProposalPricingInput) {
  const subtotalCents = toCents(proposal.subtotal || 0)
  let discountCents = Number(proposal.discount_percent) > 0
    ? Math.round(subtotalCents * ((Number(proposal.discount_percent) || 0) / 100))
    : toCents(proposal.discount_amount || 0)
  discountCents = Math.min(Math.max(discountCents, 0), subtotalCents)
  const afterDiscountCents = subtotalCents - discountCents
  const taxCents = Math.round(afterDiscountCents * ((Number(proposal.tax_rate) || 0) / 100))

  return {
    subtotal: fromCents(subtotalCents),
    discountAmount: fromCents(discountCents),
    taxAmount: fromCents(taxCents),
    total: fromCents(afterDiscountCents + taxCents),
  }
}

/** Single quote total: financed contract amount when financing applies, else tax-included total. */
export function getQuotedProposalTotal(
  proposal: ProposalPricingInput,
  taxIncludedTotal: number
): number {
  if (
    proposal.financing_available &&
    proposal.financed_contract_total != null &&
    Number(proposal.financed_contract_total) > 0
  ) {
    return roundMoney(Number(proposal.financed_contract_total))
  }
  return roundMoney(taxIncludedTotal)
}

export function shouldShowSelectedFinancingPayment(
  financing?: SelectedProposalFinancing | null
): boolean {
  const payment = Number(financing?.monthly_payment)
  const months = Number(financing?.term_months)
  return Number.isFinite(payment) && payment > 0 && Number.isFinite(months) && months > 0
}

/** Same term/APR line the proposal page shows for a selected program. */
export function formatSelectedFinancingTerms(financing: {
  term_months: number
  interest_rate?: number
}): string {
  const rate = Number(financing.interest_rate)
  const rateLabel = Number.isFinite(rate) ? String(rate) : '0'
  return `${financing.term_months} months at ${rateLabel}% APR`
}

/** Customer-facing money: cents, matching the proposal page. */
export function formatProposalMoney(amount: number): string {
  return roundMoney(amount).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/**
 * One pricing snapshot for the proposal page and the customer PDF.
 * Totals and financing come from the saved proposal row, not a PDF-time calculator.
 */
export function getProposalCustomerPricing(proposal: ProposalPricingInput) {
  const display = getProposalDisplayPricing(proposal)
  const quotedTotal = getQuotedProposalTotal(proposal, display.total)
  const monthly = Number(proposal.monthly_payment)
  const term = Number(proposal.financing_term_months)
  const rate = Number(proposal.financing_rate)
  const financing: SelectedProposalFinancing | undefined =
    proposal.financing_available &&
    Number.isFinite(monthly) &&
    monthly > 0 &&
    Number.isFinite(term) &&
    term > 0
      ? {
          monthly_payment: roundMoney(monthly),
          term_months: term,
          interest_rate: Number.isFinite(rate) ? rate : 0,
        }
      : undefined

  return {
    subtotal: display.subtotal,
    discountAmount: display.discountAmount,
    taxAmount: display.taxAmount,
    taxRate: Number(proposal.tax_rate) || 0,
    standardTotal: display.total,
    quotedTotal,
    showOnlyTotalInvestment: shouldShowOnlyTotalInvestment(quotedTotal, display.total),
    financing,
  }
}
