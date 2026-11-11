/** @jest-environment node */
import { computeProposalTotals } from '@/lib/proposal-pricing-visibility'
import { priceQuote, quoteFingerprint, defaultSelectedIds, type QuoteLine } from '@/lib/quotes/pricing'
import { depositCents, effectiveDeposit, parseQuoteApprovalPatch, readQuoteApprovalSettings } from '@/lib/quotes/settings'

const line = (id: string, total: number, extra: Partial<QuoteLine> = {}): QuoteLine => ({ id, line_total: total, unit_price: total, unit: 'each', price_type: null, taxable: null, ...extra })
const legacy = { kind: 'legacy', percent: 7.25 } as const

describe('priceQuote', () => {
  const lines = [line('a', 1000), line('b', 250.5, { is_optional: true, optional_default_on: false }), line('c', 99.99, { is_optional: true, optional_default_on: true })]

  it('a quote with no optional lines prices exactly as computeProposalTotals does (roofing parity)', () => {
    const plain = [line('a', 16325.37), line('b', 412.11)]
    const direct = computeProposalTotals({ items: plain, discountPercent: 5, discountAmount: 0, rates: null, legacyRatePercent: 7.25, exempt: false })
    const q = priceQuote({ lines: plain, selectedOptionalIds: [], discountPercent: 5, discountAmount: 0, tax: legacy })
    expect(q.totalCents).toBe(direct.totalCents)
    expect(q.taxCents).toBe(direct.taxCents)
    expect(q.subtotalCents).toBe(direct.subtotalCents)
  })

  it('counts only required lines plus the ticked options', () => {
    expect(priceQuote({ lines, selectedOptionalIds: [], tax: legacy }).subtotalCents).toBe(100000)
    expect(priceQuote({ lines, selectedOptionalIds: ['b', 'c'], tax: legacy }).subtotalCents).toBe(100000 + 25050 + 9999)
  })

  it('tax follows the selection', () => {
    const a = priceQuote({ lines, selectedOptionalIds: [], tax: legacy })
    const b = priceQuote({ lines, selectedOptionalIds: ['b'], tax: legacy })
    expect(b.taxCents).toBeGreaterThan(a.taxCents)
    expect(b.totalCents).toBe(b.subtotalCents + b.taxCents)
  })

  it('defaultSelectedIds lists only options that start ticked', () => {
    expect(defaultSelectedIds(lines)).toEqual(['c'])
  })
})

describe('quoteFingerprint', () => {
  const base = [line('a', 100), line('b', 50, { is_optional: true })]
  const fp = (l: QuoteLine[], extra: object = {}) => quoteFingerprint({ lines: l, tax: legacy, ...extra })
  it('is stable and changes with price, option flag, tax, deposit and terms', () => {
    expect(fp(base)).toBe(fp(base))
    expect(fp([line('a', 101), base[1]])).not.toBe(fp(base))
    expect(fp([base[0], line('b', 50, { is_optional: true, optional_default_on: true })])).not.toBe(fp(base))
    expect(quoteFingerprint({ lines: base, tax: { kind: 'legacy', percent: 8 } })).not.toBe(fp(base))
    expect(fp(base, { deposit: { mode: 'percent', percent: 10, fixedCents: 0 } })).not.toBe(fp(base))
    expect(fp(base, { terms: 'x' })).not.toBe(fp(base))
  })
})

describe('deposit settings', () => {
  const company = { depositMode: 'percent', depositPercent: 25, depositFixedCents: 0 } as const
  it('a quote override beats the company default; none means none', () => {
    expect(effectiveDeposit({}, company)).toMatchObject({ mode: 'percent', percent: 25, overridden: false })
    expect(effectiveDeposit({ deposit_mode: 'fixed', deposit_value: 500 }, company)).toMatchObject({ mode: 'fixed', fixedCents: 50000, overridden: true })
    expect(depositCents(100000, effectiveDeposit({ deposit_mode: 'none', deposit_value: 0 }, company))).toBe(0)
  })
  it('percent rounds to the cent and a fixed deposit never exceeds the total', () => {
    expect(depositCents(33333, { mode: 'percent', percent: 25, fixedCents: 0 })).toBe(8333)
    expect(depositCents(30000, { mode: 'fixed', fixedCents: 50000, percent: 0 })).toBe(30000)
    expect(depositCents(0, { mode: 'fixed', fixedCents: 100, percent: 0 })).toBe(0)
  })
  it('reads defaults from nothing and refuses a bad patch', () => {
    expect(readQuoteApprovalSettings(undefined).depositMode).toBe('none')
    expect('error' in parseQuoteApprovalPatch({ depositMode: 'bogus' })).toBe(true)
  })
})
