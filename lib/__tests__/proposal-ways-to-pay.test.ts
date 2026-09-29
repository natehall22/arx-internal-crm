jest.mock('@react-pdf/renderer', () => ({
  Document: 'Document',
  Page: 'Page',
  Text: 'Text',
  View: 'View',
  StyleSheet: { create: (styles: unknown) => styles },
  Image: 'Image',
}))

import {
  formatSelectedFinancingTerms,
  getWaysToPayCustomerCopy,
  shouldShowSelectedFinancingPayment,
} from '@/components/ProposalPDFv2'

describe('proposal Ways to Pay PDF copy', () => {
  const copy = getWaysToPayCustomerCopy()

  it('does not include credit-ad trigger terms on the generic page', () => {
    expect(copy).not.toMatch(/\$/)
    expect(copy).not.toMatch(/APR/i)
    expect(copy).not.toMatch(/0%/)
    expect(copy).not.toMatch(/as low as/i)
    expect(copy).not.toMatch(/guaranteed/i)
  })

  it('includes required compliance and option language', () => {
    expect(copy).toMatch(/if you qualify/i)
    expect(copy).toMatch(/12-month no-payment/i)
    expect(copy).toMatch(/prepayment penalty/i)
    expect(copy).toMatch(/Insurance claim/)
    expect(copy).toMatch(/not a credit offer/i)
    expect(copy).toMatch(/exact terms come from the lender/i)
    expect(copy).toMatch(/does not change the Total Investment/i)
    expect(copy).toMatch(/Mix and match/)
  })

  it('does not steer homeowners toward one way to pay', () => {
    expect(copy).not.toMatch(/most (homeowners|storm work)/i)
    expect(copy).not.toMatch(/coverage decisions/i)
    expect(copy).not.toMatch(/affordable/i)
    expect(copy).not.toMatch(/insurance (will|can) (pay|cover)/i)
  })
})

describe('selected builder financing on the proposal PDF', () => {
  it('shows stored payments only when financing was selected with a positive monthly amount', () => {
    expect(shouldShowSelectedFinancingPayment(undefined)).toBe(false)
    expect(
      shouldShowSelectedFinancingPayment({ monthly_payment: 0, term_months: 12, interest_rate: 0 })
    ).toBe(false)
    expect(
      shouldShowSelectedFinancingPayment({ monthly_payment: 287.41, term_months: 60, interest_rate: 9.99 })
    ).toBe(true)
  })

  it('prints the same term and APR the proposal page stores, including 0%', () => {
    expect(
      formatSelectedFinancingTerms({ monthly_payment: 287.41, term_months: 60, interest_rate: 9.99 })
    ).toBe('60 months at 9.99% APR')
    expect(
      formatSelectedFinancingTerms({ monthly_payment: 100, term_months: 12, interest_rate: 0 })
    ).toBe('12 months at 0% APR')
  })
})
