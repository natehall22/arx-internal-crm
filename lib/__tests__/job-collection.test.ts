import { evaluateJobCollection, PAID_IN_FULL_TOLERANCE_CENTS, sumCollectedCents } from '@/lib/job-collection'
import { paymentStatusChip } from '@/lib/job-status'

describe('evaluateJobCollection — one paid-in-full rule', () => {
  it('tolerance is five cents', () => {
    expect(PAID_IN_FULL_TOLERANCE_CENTS).toBe(5)
  })

  it('paid in full when payments cover the sale amount', () => {
    expect(evaluateJobCollection({ saleAmount: 100, collectedCents: 10000 }).paidInFull).toBe(true)
  })

  it('within $0.05 short counts as paid', () => {
    expect(evaluateJobCollection({ saleAmount: 100, collectedCents: 9995 }).paidByPayments).toBe(true)
  })

  it('$0.06 short is not paid (26-0046 is $0.42 short)', () => {
    expect(evaluateJobCollection({ saleAmount: 100, collectedCents: 9994 }).paidInFull).toBe(false)
    expect(evaluateJobCollection({ saleAmount: 43633.42, collectedCents: 4363300 }).paidInFull).toBe(false)
  })

  it('overpaid by cents is paid (26-0039)', () => {
    const c = evaluateJobCollection({ saleAmount: 19968.2, collectedCents: 1996822 })
    expect(c.paidInFull).toBe(true)
    expect(c.remainingCents).toBe(-2)
  })

  it('a super-admin force (who on record) makes a short job paid in full', () => {
    const c = evaluateJobCollection({ saleAmount: 7700, collectedCents: 700000, allowCloseWithBalance: true, closeBalanceBy: 'owner-1' })
    expect(c.forcedPaidInFull).toBe(true)
    expect(c.paidInFull).toBe(true)
    expect(c.paidByPayments).toBe(false)
  })

  it('a legacy close-with-balance flag with nobody on record does NOT count', () => {
    const c = evaluateJobCollection({ saleAmount: 7700, collectedCents: 700000, allowCloseWithBalance: true, closeBalanceBy: null })
    expect(c.paidInFull).toBe(false)
    expect(c.legacyCloseWithBalance).toBe(true)
  })

  it('no sale amount is never paid', () => {
    const c = evaluateJobCollection({ saleAmount: null, collectedCents: 0, allowCloseWithBalance: true, closeBalanceBy: 'x' })
    expect(c.missingSaleAmount).toBe(true)
    expect(c.paidInFull).toBe(false)
  })

  it('pending payments do not count; refunds subtract', () => {
    expect(
      sumCollectedCents([
        { amount_cents: 1000, funding_status: 'cleared' },
        { amount_cents: 500, funding_status: 'pending' },
        { amount_cents: -200 },
      ])
    ).toBe(800)
  })

  it('reads payment rows directly', () => {
    const c = evaluateJobCollection({ saleAmount: 10, payments: [{ amount_cents: 1000, funding_status: 'cleared' }] })
    expect(c.paidInFull).toBe(true)
  })
})

describe('paymentStatusChip uses the same rule', () => {
  it('labels a forced short job "Closed with balance"', () => {
    expect(
      paymentStatusChip({ sale_amount: 100, collected_cents: 5000, allow_close_with_balance: true, close_balance_by: 'o' })?.label
    ).toBe('Closed with balance')
  })
  it('within tolerance is Paid in full', () => {
    expect(paymentStatusChip({ sale_amount: 100, collected_cents: 9996 })?.label).toBe('Paid in full')
  })
})
