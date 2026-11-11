import {
  computeSalesTax,
  computeDocumentSalesTax,
  combinedTaxPercent,
  defaultTaxRates,
  lineIsTaxable,
  parseSalesTaxSettings,
  readSalesTaxSettings,
  readStoredTaxLines,
  taxLineLabel,
  taxRatesByIds,
  NEW_COMPANY_SALES_TAX,
  type SalesTaxSettings,
} from '@/lib/sales-tax'
import { getProposalDisplayPricing, getProposalCustomerPricing } from '@/lib/proposal-pricing-visibility'

const cents = (d: number) => Math.round(d * 100)

/** The proposal math every screen used before this module (copied verbatim from the deleted copies). */
function originalProposalTax(p: { subtotal: number; discount_amount: number; discount_percent: number; tax_rate: number }) {
  const subtotalCents = Math.round((Number(p.subtotal) || 0) * 100)
  let discountCents = p.discount_percent > 0
    ? Math.round(subtotalCents * ((p.discount_percent || 0) / 100))
    : Math.round((Number(p.discount_amount) || 0) * 100)
  discountCents = Math.min(Math.max(discountCents, 0), subtotalCents)
  const afterDiscountCents = subtotalCents - discountCents
  const taxCents = Math.round(afterDiscountCents * ((p.tax_rate || 0) / 100))
  return { taxCents, totalCents: afterDiscountCents + taxCents }
}

/**
 * ARX golden: real stored proposals (amounts only, read from prod 2026-11-10; 182/184 proposals match the original
 * formula, the 2 that don't were hand-edited). Every rate ARX has used, with and without a discount.
 */
const ARX_GOLDEN = [
  { subtotal: 34848.0, discount_amount: 0, discount_percent: 0, tax_rate: 0, tax_amount: 0, total: 34848.0 },
  { subtotal: 36206.31, discount_amount: 1500, discount_percent: 0, tax_rate: 0, tax_amount: 0, total: 34706.31 },
  { subtotal: 2176.0, discount_amount: 0, discount_percent: 0, tax_rate: 2.93, tax_amount: 63.76, total: 2239.76 },
  { subtotal: 15393.52, discount_amount: 0.02, discount_percent: 0, tax_rate: 3.94, tax_amount: 606.5, total: 16000.0 },
  { subtotal: 84206.48, discount_amount: 0, discount_percent: 0, tax_rate: 6.0, tax_amount: 5052.39, total: 89258.87 },
  { subtotal: 17768.88, discount_amount: 0, discount_percent: 0, tax_rate: 6.7, tax_amount: 1190.51, total: 18959.39 },
  { subtotal: 52456.88, discount_amount: 0, discount_percent: 0, tax_rate: 7.0, tax_amount: 3671.98, total: 56128.86 },
  { subtotal: 25157.22, discount_amount: 800, discount_percent: 0, tax_rate: 7.0, tax_amount: 1705.01, total: 26062.23 },
  { subtotal: 14870.78, discount_amount: 518.93, discount_percent: 0, tax_rate: 8.0, tax_amount: 1148.15, total: 15500.0 },
  { subtotal: 638626.95, discount_amount: 0, discount_percent: 0, tax_rate: 8.25, tax_amount: 52686.72, total: 691313.67 },
]

describe('ARX golden — legacy single-rate proposals reproduce to the cent', () => {
  it.each(ARX_GOLDEN)('subtotal %#', (p) => {
    const display = getProposalDisplayPricing(p)
    expect(cents(display.taxAmount)).toBe(cents(p.tax_amount))
    expect(cents(display.total)).toBe(cents(p.total))
    const orig = originalProposalTax(p)
    expect(cents(display.taxAmount)).toBe(orig.taxCents)
    expect(cents(display.total)).toBe(orig.totalCents)
    // one row, labelled exactly as before
    expect(display.taxLines).toEqual([{ label: `Tax (${p.tax_rate}%)`, amount: p.tax_amount }])
  })

  it('matches the original formula on 5,000 random proposals (percent and dollar discounts)', () => {
    let seed = 42
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
    const rates = [0, 2.93, 3.94, 6, 6.7, 7, 7.25, 7.5, 8, 8.25, 9.3, 10.1]
    for (let i = 0; i < 5000; i++) {
      const p = {
        subtotal: Math.round(rnd() * 9000000) / 100,
        discount_amount: rnd() < 0.3 ? Math.round(rnd() * 200000) / 100 : 0,
        discount_percent: rnd() < 0.15 ? Math.round(rnd() * 2000) / 100 : 0,
        tax_rate: rates[Math.floor(rnd() * rates.length)],
      }
      const d = getProposalDisplayPricing(p)
      const o = originalProposalTax(p)
      expect([cents(d.taxAmount), cents(d.total)]).toEqual([o.taxCents, o.totalCents])
    }
  })

  it('customer pricing keeps taxRate / standardTotal as before', () => {
    const p = ARX_GOLDEN[7]
    const c = getProposalCustomerPricing(p)
    expect(c.taxRate).toBe(7)
    expect(c.standardTotal).toBe(26062.23)
  })
})

const NC: SalesTaxSettings = {
  enabled: true,
  rates: [
    { id: 'nc-state', name: 'NC state', percent: 4.75, active: true },
    { id: 'cabarrus', name: 'Cabarrus County', percent: 2.25, active: true },
    { id: 'old', name: 'Old county', percent: 2, active: false },
  ],
  defaultRateIds: ['nc-state', 'cabarrus'],
}

describe('computeSalesTax', () => {
  it('stacks rates, one row per rate, rounded per rate per document', () => {
    const r = computeSalesTax({ lines: [{ amountCents: 1000_33, taxable: true }], rates: defaultTaxRates(NC) })
    // 100033 * 4.75% = 4751.57 → 4752 ; * 2.25% = 2250.74 → 2251
    expect(r.taxLines.map((l) => l.amount_cents)).toEqual([4752, 2251])
    expect(r.taxCents).toBe(7003)
    expect(r.totalCents).toBe(1000_33 + 7003)
    expect(combinedTaxPercent(defaultTaxRates(NC))).toBe(7)
  })

  it('taxes only taxable lines', () => {
    const r = computeSalesTax({
      lines: [
        { amountCents: 50000, taxable: true },
        { amountCents: 30000, taxable: false },
      ],
      rates: [{ name: 'FL', percent: 7.5 }],
    })
    expect(r.taxableCents).toBe(50000)
    expect(r.taxCents).toBe(3750)
    expect(r.totalCents).toBe(83750)
  })

  it('spreads a document discount over the taxable share', () => {
    const r = computeSalesTax({
      lines: [
        { amountCents: 60000, taxable: true },
        { amountCents: 40000, taxable: false },
      ],
      discountCents: 10000,
      rates: [{ name: 'T', percent: 10 }],
    })
    expect(r.taxableCents).toBe(54000) // 60,000 − 60% of 10,000
    expect(r.taxCents).toBe(5400)
    expect(r.totalCents).toBe(90000 + 5400)
  })

  it('exempt customer: no tax rows at all', () => {
    const r = computeDocumentSalesTax({ settings: NC, lines: [{ amountCents: 10000, taxable: true }], customerExempt: true })
    expect(r).toMatchObject({ exempt: true, taxLines: [], taxCents: 0, taxableCents: 0, totalCents: 10000 })
  })

  it('tax switched off or not set up: nothing', () => {
    expect(computeDocumentSalesTax({ settings: { ...NC, enabled: false }, lines: [{ amountCents: 10000, taxable: true }] }).taxLines).toEqual([])
    expect(computeDocumentSalesTax({ settings: null, lines: [{ amountCents: 10000, taxable: true }] }).taxLines).toEqual([])
  })

  it('per-line override beats the price-book flag', () => {
    expect(lineIsTaxable(false, true)).toBe(false)
    expect(lineIsTaxable(true, false)).toBe(true)
    expect(lineIsTaxable(null, false)).toBe(false)
    expect(lineIsTaxable(undefined, undefined)).toBe(true)
  })

  it('rounds half up on the document total, not per line', () => {
    // three 0.10 lines at 5%: per line 0.5¢ each would round to 3¢; per document 30¢ × 5% = 1.5 → 2¢
    const r = computeSalesTax({ lines: [10, 10, 10].map((c) => ({ amountCents: c, taxable: true })), rates: [{ name: 'T', percent: 5 }] })
    expect(r.taxCents).toBe(2)
  })

  it('never taxes a negative or empty taxable amount', () => {
    expect(computeSalesTax({ lines: [], rates: [{ name: 'T', percent: 7 }] }).taxCents).toBe(0)
    const r = computeSalesTax({ lines: [{ amountCents: 1000, taxable: false }, { amountCents: -500, taxable: true }], rates: [{ name: 'T', percent: 7 }] })
    expect(r.taxCents).toBe(0)
  })

  it('a chosen stack can still use a rate turned off later (old drafts keep their rate)', () => {
    expect(taxRatesByIds(NC, ['old', 'nc-state', 'missing']).map((r) => r.id)).toEqual(['old', 'nc-state'])
  })
})

describe('settings', () => {
  it('not set up = null (original behaviour); new companies are set up with no rates', () => {
    expect(readSalesTaxSettings({})).toBeNull()
    expect(readSalesTaxSettings(null)).toBeNull()
    expect(readSalesTaxSettings({ salesTax: NEW_COMPANY_SALES_TAX })).toEqual({ enabled: true, rates: [], defaultRateIds: [] })
    expect(defaultTaxRates(readSalesTaxSettings({ salesTax: NEW_COMPANY_SALES_TAX }))).toEqual([])
  })

  it('a damaged stored value reads as tax off, never the legacy default', () => {
    expect(readSalesTaxSettings({ salesTax: 'x' })).toEqual({ enabled: false, rates: [], defaultRateIds: [] })
  })

  it('validates the owner save', () => {
    expect(parseSalesTaxSettings(NC)).toEqual({ value: NC })
    expect(parseSalesTaxSettings({ ...NC, defaultRateIds: ['old'] })).toHaveProperty('error')
    expect(parseSalesTaxSettings({ ...NC, rates: [...NC.rates, NC.rates[0]] })).toHaveProperty('error')
    expect(parseSalesTaxSettings({ enabled: true, rates: [{ id: 'a', name: 'A', percent: 31 }], defaultRateIds: [] })).toHaveProperty('error')
    expect(parseSalesTaxSettings({ enabled: true, rates: [{ id: 'a', name: '  ', percent: 1 }], defaultRateIds: [] })).toHaveProperty('error')
    const ok = parseSalesTaxSettings({ enabled: true, rates: [{ id: 'a', name: ' Leon  County ', percent: '1.123456' }], defaultRateIds: ['a', 'a'] })
    expect(ok).toEqual({ value: { enabled: true, rates: [{ id: 'a', name: 'Leon County', percent: 1.1235, active: true }], defaultRateIds: ['a'] } })
  })

  it('reads stored snapshots and labels them', () => {
    expect(readStoredTaxLines(null)).toBeNull()
    expect(readStoredTaxLines([{ id: 'a', name: 'NC state', percent: 4.75, amount_cents: 475 }, 'junk'])).toEqual([
      { id: 'a', name: 'NC state', percent: 4.75, amount_cents: 475 },
    ])
    expect(taxLineLabel({ name: 'NC state', percent: 4.75 })).toBe('NC state (4.75%)')
  })
})
