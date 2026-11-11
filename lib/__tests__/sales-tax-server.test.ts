import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { computeCustomerSalesTax, proposalSalesTaxFields, saveSalesTaxSettings } from '@/lib/sales-tax-server'
import { computeProposalTotals } from '@/lib/proposal-pricing-visibility'
import { mergeSettingsAt } from '@/lib/org-settings'

const ORG = 'org-a'
const OTHER = 'org-b'
const salesTax = {
  enabled: true,
  rates: [
    { id: 'state', name: 'State', percent: 6, active: true },
    { id: 'county', name: 'County', percent: 1.5, active: true },
  ],
  defaultRateIds: ['state', 'county'],
}

function db(extra: Record<string, Record<string, unknown>[]> = {}, settings: Record<string, unknown> = { salesTax }) {
  return createFakeDb({
    orgs: [{ id: ORG, settings }, { id: OTHER, settings: {} }],
    customers: [
      { id: 'c-taxed', org_id: ORG, tax_exempt: false },
      { id: 'c-exempt', org_id: ORG, tax_exempt: true },
      { id: 'c-foreign-exempt', org_id: OTHER, tax_exempt: true },
    ],
    opportunities: [
      { id: 'o-taxed', org_id: ORG, customer_id: 'c-taxed' },
      { id: 'o-exempt', org_id: ORG, customer_id: 'c-exempt' },
      { id: 'o-foreign', org_id: OTHER, customer_id: 'c-foreign-exempt' },
    ],
    ...extra,
  })
}

const lines = [
  { line_total: 1000, unit_price: 1000, unit: 'each', taxable: true },
  { line_total: 400, unit_price: 400, unit: 'each', taxable: false },
  { line_total: 0, unit_price: 10, unit: 'percent', taxable: true }, // 10% of 1,400 = 140
]

describe('proposalSalesTaxFields (server save)', () => {
  it('legacy quote (no tax_lines) is left alone', async () => {
    expect(await proposalSalesTaxFields(db().client, ORG, { tax_rate: 7, tax_amount: 1 }, lines)).toBeNull()
  })

  it('company not set up: tax_lines from the browser are ignored (legacy save)', async () => {
    expect(await proposalSalesTaxFields(db({}, {}).client, ORG, { tax_lines: [] }, lines)).toBeNull()
  })

  it('recomputes every money field from the lines and the company rates — browser numbers are ignored', async () => {
    const f = await proposalSalesTaxFields(
      db().client,
      ORG,
      {
        opportunity_id: 'o-taxed',
        discount_amount: 154,
        tax_amount: 0.01, // tampered
        total: 1,
        tax_lines: [{ id: 'state', name: 'State', percent: 0.0001, amount_cents: 1 }, { id: 'county', name: 'x', percent: 0, amount_cents: 0 }],
      },
      lines
    )
    // subtotal 1,540; discount 154; taxable 1,140 − round(15,400 × 114,000 / 154,000) = 114,000 − 11,400 = 102,600¢
    expect(f).toMatchObject({ subtotal: 1540, discount_amount: 154, taxable_subtotal: 1026, tax_rate: 7.5, tax_exempt: false })
    expect(f!.tax_lines).toEqual([
      { id: 'state', name: 'State', percent: 6, amount_cents: 6156 },
      { id: 'county', name: 'County', percent: 1.5, amount_cents: 1539 },
    ])
    expect(f!.tax_amount).toBe(76.95)
    expect(f!.total).toBe(1386 + 76.95)
    // same numbers the screen shows
    const screen = computeProposalTotals({ items: lines, discountAmount: 154, rates: salesTax.rates, exempt: false })
    expect(screen.taxCents).toBe(7695)
    expect(screen.totalCents).toBe(146295)
  })

  it('exempt customer: no tax', async () => {
    const f = await proposalSalesTaxFields(db().client, ORG, { opportunity_id: 'o-exempt', tax_lines: [{ id: 'state' }] }, lines)
    expect(f).toMatchObject({ tax_amount: 0, tax_lines: [], tax_exempt: true, total: 1540 })
  })

  it("another company's opportunity/customer is never read (exemption not borrowed)", async () => {
    const f = await proposalSalesTaxFields(db().client, ORG, { opportunity_id: 'o-foreign', tax_lines: [{ id: 'state' }] }, lines)
    expect(f).toMatchObject({ tax_exempt: false, tax_amount: 68.4 })
  })

  it('a rate id the company does not have is dropped', async () => {
    const f = await proposalSalesTaxFields(db().client, ORG, { tax_lines: [{ id: 'made-up', percent: 50, amount_cents: 9999 }] }, lines)
    expect(f).toMatchObject({ tax_amount: 0, tax_lines: [], tax_rate: 0 })
  })
})

describe('computeCustomerSalesTax (invoices, service plans)', () => {
  it('default stack, taxable lines only, exempt customer gets none', async () => {
    const t = await computeCustomerSalesTax(db().client, ORG, 'c-taxed', [
      { amountCents: 5000, taxable: true },
      { amountCents: 5000, taxable: false },
    ])
    expect(t.taxCents).toBe(300 + 75)
    const e = await computeCustomerSalesTax(db().client, ORG, 'c-exempt', [{ amountCents: 5000, taxable: true }])
    expect(e.taxCents).toBe(0)
  })
})

describe('saveSalesTaxSettings', () => {
  it('refuses a bad save and writes only settings.salesTax', async () => {
    const d = createFakeDb(
      { orgs: [{ id: ORG, settings: { salesTax, brand: { shortName: 'X' } } }] },
      {
        rpc: {
          merge_org_settings: (a, tables) => {
            const org = tables.orgs.find((o) => o.id === a.p_org_id)!
            org.settings = mergeSettingsAt(org.settings, a.p_path as string[], a.p_set as Record<string, unknown>, a.p_remove as string[])
          },
        },
      }
    )
    expect((await saveSalesTaxSettings(d.client, ORG, { enabled: true, rates: [{ id: 'a', name: 'A', percent: 99 }], defaultRateIds: [] })).error).toBeTruthy()
    const ok = await saveSalesTaxSettings(d.client, ORG, { enabled: false, rates: salesTax.rates, defaultRateIds: [] })
    expect(ok.error).toBeNull()
    const org = d.tables.orgs.find((o) => o.id === ORG) as { settings: Record<string, unknown> }
    expect(org.settings.brand).toEqual({ shortName: 'X' })
    expect(org.settings.salesTax).toEqual({ enabled: false, rates: salesTax.rates, defaultRateIds: [] })
  })
})
