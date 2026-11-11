import {
  buildBillingUnits,
  draftInvoiceTotals,
  groupDraftInvoices,
  lookbackFrom,
  unitWaits,
  type BillingPlanFacts,
  type DoneVisit,
} from '@/lib/service-billing'
import { invoiceItemLineFields, invoiceItemPriceLabel, invoiceItemQtyLabel } from '@/lib/invoice-lines'

const plan = (over: Partial<BillingPlanFacts> & { id: string }): BillingPlanFacts => ({
  name: 'Weekly mowing',
  billing_basis: 'per_visit',
  price: 45,
  previous_price: null,
  price_starts_on: null,
  taxable: false,
  customer_id: 'c1',
  property_id: 'p1',
  ...over,
})
const visit = (id: string, planId: string, servedOn: string, over: Partial<DoneVisit> = {}): DoneVisit => ({
  visitId: id,
  planId,
  customerId: 'c1',
  propertyId: 'p1',
  servedOn,
  visitStep: 'service',
  price: 45,
  taxable: false,
  ...over,
})
const none = { visitIds: new Set<string>(), planMonths: new Set<string>() }
const addr = (id: string | null) => (id === 'p1' ? '1 Oak St' : id === 'p2' ? '9 Bay Rd' : null)

describe('buildBillingUnits', () => {
  const plans = new Map([
    ['mow', plan({ id: 'mow' })],
    ['care', plan({ id: 'care', name: 'Lawn care', billing_basis: 'per_month', price: 120, taxable: true })],
    ['year', plan({ id: 'year', name: 'Gutter plan', billing_basis: 'per_year', price: 300 })],
  ])

  it('a per-visit plan bills each visit at its own price snapshot', () => {
    const { units } = buildBillingUnits([visit('v1', 'mow', '2026-10-06'), visit('v2', 'mow', '2026-10-13', { price: 50 })], plans, none)
    expect(units.map((u) => [u.key, u.amountCents])).toEqual([['v:v1', 4500], ['v:v2', 5000]])
  })

  it('a monthly plan bills one plan-month with its done visits listed, at the price on the 1st', () => {
    const p = new Map(plans)
    p.set('care', plan({ id: 'care', name: 'Lawn care', billing_basis: 'per_month', price: 130, previous_price: 120, price_starts_on: '2026-11-01', taxable: true }))
    const { units } = buildBillingUnits(
      [visit('m1', 'care', '2026-10-07', { price: null }), visit('m2', 'care', '2026-10-21', { price: null }), visit('m3', 'care', '2026-11-04', { price: null })],
      p,
      none
    )
    expect(units.map((u) => [u.key, u.amountCents, u.taxable, u.visits.map((v) => v.visitId)])).toEqual([
      ['m:care:2026-10', 12000, true, ['m1', 'm2']],
      ['m:care:2026-11', 13000, true, ['m3']],
    ])
  })

  it('skips billed visits / months, follow-on steps; reports yearly and unpriced visits', () => {
    const { units, notBillable } = buildBillingUnits(
      [
        visit('v1', 'mow', '2026-10-06'),
        visit('v2', 'mow', '2026-10-13'),
        visit('i1', 'mow', '2026-10-14', { visitStep: 'inspection', price: null }),
        visit('m1', 'care', '2026-10-07', { price: null }),
        visit('y1', 'year', '2026-10-08', { price: null }),
        visit('z1', 'mow', '2026-10-09', { price: null }),
        visit('z2', 'mow', '2026-10-10', { price: 0 }),
      ],
      plans,
      { visitIds: new Set(['v1']), planMonths: new Set(['care|2026-10-01']) }
    )
    expect(units.map((u) => u.key)).toEqual(['v:v2'])
    expect(notBillable.map((n) => [n.visitId, n.reason])).toEqual([['y1', 'yearly'], ['z1', 'no_price'], ['z2', 'no_price']])
  })

  it('a monthly plan with no price lists its visits as not billable', () => {
    const p = new Map([['care', plan({ id: 'care', billing_basis: 'per_month', price: null })]])
    const { units, notBillable } = buildBillingUnits([visit('m1', 'care', '2026-10-07', { price: null })], p, none)
    expect(units).toEqual([])
    expect(notBillable).toEqual([expect.objectContaining({ visitId: 'm1', reason: 'no_price' })])
  })

  it('a visit whose plan did not load never bills', () => {
    expect(buildBillingUnits([visit('v1', 'gone', '2026-10-06')], plans, none).units).toEqual([])
  })
})

describe('grouping', () => {
  const plans = new Map([
    ['mow', plan({ id: 'mow' })],
    ['care', plan({ id: 'care', name: 'Lawn care', billing_basis: 'per_month', price: 120 })],
    ['mow2', plan({ id: 'mow2', property_id: 'p2' })],
    ['other', plan({ id: 'other', customer_id: 'c2', property_id: 'p9' })],
  ])
  const visits = [
    visit('v1', 'mow', '2026-10-06'),
    visit('v2', 'mow', '2026-10-13'),
    visit('m1', 'care', '2026-10-07', { price: null }),
    visit('w1', 'mow2', '2026-10-08', { propertyId: 'p2' }),
    visit('n1', 'mow', '2026-11-03'),
    visit('o1', 'other', '2026-10-06', { customerId: 'c2', propertyId: 'p9' }),
  ]
  const { units } = buildBillingUnits(visits, plans, none)

  it('monthly: one invoice per customer per month, every visit listed; two homes name their address', () => {
    const drafts = groupDraftInvoices(units, 'month', addr)
    expect(drafts.map((d) => [d.key, d.subtotalCents])).toEqual([
      ['c:c1:2026-10', 4500 + 12000 + 4500 + 4500],
      ['c:c2:2026-10', 4500],
      ['c:c1:2026-11', 4500],
    ])
    const oct = drafts[0]
    expect(oct.propertyId).toBeNull()
    expect(oct.lines.map((l) => [l.description, l.unit_price_cents, l.work_order_id ?? null, l.billing_month ?? null])).toEqual([
      ['1 Oak St · Lawn care — October 2026', 12000, null, '2026-10-01'],
      ['1 Oak St · Lawn care visit (included)', 0, 'm1', null],
      ['1 Oak St · Weekly mowing', 4500, 'v1', null],
      ['9 Bay Rd · Weekly mowing', 4500, 'w1', null],
      ['1 Oak St · Weekly mowing', 4500, 'v2', null],
    ])
    // one home: no address prefix, the invoice carries the property
    expect(drafts[1].propertyId).toBe('p9')
    expect(drafts[1].lines[0].description).toBe('Weekly mowing')
  })

  it('per property: a customer with two homes gets one invoice per home per month, each carrying its property', () => {
    const drafts = groupDraftInvoices(units, 'property', addr).sort((a, b) => a.key.localeCompare(b.key))
    expect(drafts.map((d) => [d.key, d.propertyId, d.subtotalCents])).toEqual([
      ['p:c1:p1:2026-10', 'p1', 4500 + 12000 + 4500],
      ['p:c1:p1:2026-11', 'p1', 4500],
      ['p:c1:p2:2026-10', 'p2', 4500],
      ['p:c2:p9:2026-10', 'p9', 4500],
    ])
    // one home per invoice: no address prefix on the lines
    expect(drafts.every((d) => d.lines.every((l) => !l.description.includes(' · ')))).toBe(true)
    // every visit is on exactly one invoice
    const ids = drafts.flatMap((d) => d.lines.map((l) => l.work_order_id).filter(Boolean))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('per property waits for the month to end like monthly, but per visit never waits', () => {
    const u = units.find((x) => x.key === 'v:n1')!
    expect(unitWaits(u, 'property', '2026-11', false)).toBe(true)
    expect(unitWaits(u, 'visit', '2026-11', false)).toBe(false)
    expect(unitWaits(u, 'property', '2026-11', true)).toBe(false)
  })

  it('per visit: one invoice per visit (and per plan-month)', () => {
    const drafts = groupDraftInvoices(units, 'visit', addr)
    expect(drafts.map((d) => d.key).sort()).toEqual(['m:care:2026-10', 'v:n1', 'v:o1', 'v:v1', 'v:v2', 'v:w1'])
    expect(drafts.find((d) => d.key === 'm:care:2026-10')!.lines).toHaveLength(2)
  })

  it('the current month waits in monthly grouping (and for plan-months) unless included', () => {
    const nov = units.find((u) => u.key === 'v:n1')!
    const oct = units.find((u) => u.key === 'v:v1')!
    const careNov = { ...units.find((u) => u.key === 'm:care:2026-10')!, month: '2026-11' }
    expect(unitWaits(nov, 'month', '2026-11', false)).toBe(true)
    expect(unitWaits(nov, 'month', '2026-11', true)).toBe(false)
    expect(unitWaits(nov, 'visit', '2026-11', false)).toBe(false)
    expect(unitWaits(careNov, 'visit', '2026-11', false)).toBe(true)
    expect(unitWaits(oct, 'month', '2026-11', false)).toBe(false)
  })
})

describe('preview totals = the invoice tax rule (lib/sales-tax.ts)', () => {
  const settings = { enabled: true, rates: [{ id: 'fl', name: 'FL', percent: 6, active: true }, { id: 'leon', name: 'Leon', percent: 1.5, active: true }], defaultRateIds: ['fl', 'leon'] }
  const lines = [
    { description: 'Mowing', qty: 1, unit_price_cents: 4500, taxable: false },
    { description: 'Gutter care — October', qty: 1, unit_price_cents: 20033, taxable: true },
  ]
  it('taxes taxable lines only (ARX Care / commercial window cleaning taxable; FL lawn not)', () => {
    expect(draftInvoiceTotals({ lines }, settings, false)).toEqual({ subtotalCents: 24533, taxCents: 1202 + 300, totalCents: 24533 + 1502 })
  })
  it('exempt customer and a company without sales tax pay none', () => {
    expect(draftInvoiceTotals({ lines }, settings, true).taxCents).toBe(0)
    expect(draftInvoiceTotals({ lines }, null, false).taxCents).toBe(0)
  })
})

describe('look-back', () => {
  it('is clamped to 1…730 days', () => {
    expect(lookbackFrom('2026-11-11', 120)).toBe('2026-07-14')
    expect(lookbackFrom('2026-11-11', 5000)).toBe('2024-11-11')
    expect(lookbackFrom('2026-11-11', 0)).toBe('2026-07-14')
  })
})

describe('hours lines (time & materials)', () => {
  it('validates hours and the work day', () => {
    expect(invoiceItemLineFields({ unit: 'hour', qty: 2.5, service_date: '2026-11-03' })).toEqual({ value: { unit: 'hour', service_date: '2026-11-03' } })
    expect(invoiceItemLineFields({ qty: 1 })).toEqual({ value: {} })
    expect(invoiceItemLineFields({ unit: 'hour', qty: 0 })).toHaveProperty('error')
    expect(invoiceItemLineFields({ unit: 'hour', qty: 1.255 })).toHaveProperty('error')
    expect(invoiceItemLineFields({ unit: 'day', qty: 1 })).toHaveProperty('error')
    expect(invoiceItemLineFields({ service_date: '2026-02-30' })).toHaveProperty('error')
  })
  it('labels: "2.5 hrs" × "$80.00/hr"; plain lines print as before', () => {
    expect(invoiceItemQtyLabel({ qty: 2.5, unit: 'hour' })).toBe('2.5 hrs')
    expect(invoiceItemQtyLabel({ qty: 1, unit: 'hour' })).toBe('1 hr')
    expect(invoiceItemPriceLabel({ unit_price_cents: 8000, unit: 'hour' })).toBe('$80.00/hr')
    expect(invoiceItemQtyLabel({ qty: 1, unit: null })).toBe('1')
    expect(invoiceItemPriceLabel({ unit_price_cents: 1632500, unit: null })).toBe('$16,325.00')
  })
})
