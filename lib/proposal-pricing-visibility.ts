import { roundMoney } from '@/lib/money'
import { computeSalesTax, readStoredTaxLines, taxLineLabel } from '@/lib/sales-tax'

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
  /** Stored tax snapshot (lib/sales-tax.ts). Absent/null = legacy single `tax_rate` on the whole after-discount amount. */
  tax_lines?: unknown
  tax_exempt?: boolean | null
  financing_available?: boolean | null
  financed_contract_total?: number | null
  monthly_payment?: number | null
  financing_term_months?: number | null
  financing_rate?: number | null
}

export type SelectedProposalFinancing = {
  monthly_payment: number
  term_months: number
  interest_rate?: number
}

/** A proposal's discount in cents: percent wins over a dollar amount; 0 ≤ discount ≤ subtotal. */
export function proposalDiscountCents(subtotalCents: number, discountPercent?: number | null, discountAmount?: number | null): number {
  const d = Number(discountPercent) > 0
    ? Math.round(subtotalCents * ((Number(discountPercent) || 0) / 100))
    : toCents(discountAmount || 0)
  return Math.min(Math.max(d, 0), subtotalCents)
}

/** Customer-facing tax rows: one per stacked rate, or the legacy "Tax (7%)" row. */
export type ProposalTaxRow = { label: string; amount: number }

export function getProposalDisplayPricing(proposal: ProposalPricingInput) {
  const subtotalCents = toCents(proposal.subtotal || 0)
  const discountCents = proposalDiscountCents(subtotalCents, proposal.discount_percent, proposal.discount_amount)
  const afterDiscountCents = subtotalCents - discountCents
  const snapshot = readStoredTaxLines(proposal.tax_lines)

  let taxCents: number
  let taxLines: ProposalTaxRow[]
  if (snapshot) {
    // Set-up company: the tax was computed per line and per rate at save (lib/sales-tax.ts) and stored.
    taxCents = snapshot.reduce((s, l) => s + l.amount_cents, 0)
    taxLines = snapshot.map((l) => ({ label: taxLineLabel(l), amount: fromCents(l.amount_cents) }))
    if (proposal.tax_exempt && snapshot.length === 0) taxLines = [{ label: 'Sales tax (exempt)', amount: 0 }]
  } else {
    // Legacy: ONE hand-typed rate on the whole after-discount amount (byte-identical to the original math).
    const r = computeSalesTax({
      lines: [{ amountCents: subtotalCents, taxable: true }],
      discountCents,
      rates: [{ name: 'Tax', percent: Number(proposal.tax_rate) || 0 }],
    })
    taxCents = r.taxCents
    taxLines = [{ label: `Tax (${proposal.tax_rate}%)`, amount: fromCents(taxCents) }]
  }

  return {
    subtotal: fromCents(subtotalCents),
    discountAmount: fromCents(discountCents),
    taxAmount: fromCents(taxCents),
    taxLines,
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
export function formatSelectedFinancingTerms(
  financing: Pick<SelectedProposalFinancing, 'term_months' | 'interest_rate'> & {
    monthly_payment?: number
  }
): string {
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
    taxLines: display.taxLines,
    taxRate: Number(proposal.tax_rate) || 0,
    standardTotal: display.total,
    quotedTotal,
    showOnlyTotalInvestment: shouldShowOnlyTotalInvestment(quotedTotal, display.total),
    financing,
  }
}
