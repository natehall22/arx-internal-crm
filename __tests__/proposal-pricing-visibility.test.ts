import { shouldShowOnlyTotalInvestment, getProposalCustomerPricing, formatProposalMoney, formatSelectedFinancingTerms } from '@/lib/proposal-pricing-visibility'

describe('shouldShowOnlyTotalInvestment', () => {
  it('collapses pricing when the all-in financed total includes a gross-up', () => {
    expect(shouldShowOnlyTotalInvestment(26864, 22837)).toBe(true)
  })

  it('keeps the standard breakdown when financing does not increase the total', () => {
    expect(shouldShowOnlyTotalInvestment(22837, 22837)).toBe(false)
  })

  it('compares currency at cent precision', () => {
    expect(shouldShowOnlyTotalInvestment(22837.004, 22837)).toBe(false)
    expect(shouldShowOnlyTotalInvestment(22837.01, 22837)).toBe(true)
  })
})

describe('getProposalCustomerPricing — page and PDF share one snapshot', () => {
  const cashProposal = {
    subtotal: 10000,
    discount_amount: 0,
    discount_percent: 0,
    tax_rate: 7.25,
    financing_available: false,
    financed_contract_total: null,
    monthly_payment: null,
    financing_term_months: 60,
    financing_rate: 9.99,
  }

  it('uses tax-included total when financing is off', () => {
    const pricing = getProposalCustomerPricing(cashProposal)
    expect(pricing.quotedTotal).toBe(10725)
    expect(pricing.taxAmount).toBe(725)
    expect(pricing.financing).toBeUndefined()
    expect(pricing.showOnlyTotalInvestment).toBe(false)
    expect(formatProposalMoney(pricing.quotedTotal)).toBe('$10,725.00')
  })

  it('uses saved financed_contract_total and monthly_payment when financing is on', () => {
    const pricing = getProposalCustomerPricing({
      ...cashProposal,
      financing_available: true,
      financed_contract_total: 17378.56,
      monthly_payment: 287.41,
      financing_term_months: 60,
      financing_rate: 9.99,
    })
    expect(pricing.quotedTotal).toBe(17378.56)
    expect(pricing.showOnlyTotalInvestment).toBe(true)
    expect(pricing.financing).toEqual({
      monthly_payment: 287.41,
      term_months: 60,
      interest_rate: 9.99,
    })
    expect(formatProposalMoney(pricing.quotedTotal)).toBe('$17,378.56')
    expect(formatProposalMoney(pricing.financing!.monthly_payment)).toBe('$287.41')
    expect(formatSelectedFinancingTerms(pricing.financing!)).toBe('60 months at 9.99% APR')
  })

  it('prints the stored 0% APR when that is the selected program', () => {
    expect(
      formatSelectedFinancingTerms({ term_months: 12, interest_rate: 0 })
    ).toBe('12 months at 0% APR')
  })

  it('does not round customer totals to whole dollars', () => {
    expect(formatProposalMoney(17378.56)).toBe('$17,378.56')
    expect(formatProposalMoney(17378.56)).not.toBe('$17,379.00')
    expect(formatProposalMoney(17378.56)).not.toBe('$17,379')
  })
})
