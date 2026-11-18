/** @jest-environment node */
/**
 * New invoice from the customer page: validated lines → createServiceInvoiceFromLines (THE writer; no second one).
 * Price-book lines are priced on the server from the customer's own price list; typed lines are the office's price.
 */
const created: Array<Record<string, unknown>> = []
jest.mock('@/lib/invoices', () => ({
  ...jest.requireActual('@/lib/invoices'),
  createServiceInvoiceFromLines: async (_c: unknown, _o: string, p: Record<string, unknown>) => {
    created.push(p)
    return { invoiceId: 'new-inv', skipped: [] }
  },
}))

import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { buildOneOffLines, createOneOffInvoice, loadCustomerCatalog, parseOneOffBody } from '@/lib/one-off-invoice'

const ORG = 'org-a'
function db() {
  return createFakeDb({
    customers: [{ id: 'c1', org_id: ORG, name: 'Pat', pricebook_id: 'plB' }],
    properties: [{ id: 'p1', org_id: ORG, customer_id: 'c1', address_text: '9 Elm' }, { id: 'p2', org_id: ORG, customer_id: 'c2', address_text: 'Other' }],
    pricebooks: [{ id: 'plA', org_id: ORG, name: 'Standard', is_default: true }, { id: 'plB', org_id: ORG, name: 'Builder', is_default: false }],
    pricebook_items: [
      { id: 'mow', org_id: ORG, name: 'Mow', unit: 'visit', unit_price: 40, is_taxable: true, active: true, pricebook_id: 'plB', price_options: [{ key: 's', label: 'Small', price: 30 }, { key: 'l', label: 'Large', price: 60 }] },
      { id: 'edge', org_id: ORG, name: 'Edging', unit: 'each', unit_price: 15.5, is_taxable: false, active: true, pricebook_id: 'plB' },
      { id: 'std-only', org_id: ORG, name: 'Default list item', unit: 'each', unit_price: 9, is_taxable: true, active: true, pricebook_id: 'plA' },
      { id: 'off', org_id: ORG, name: 'Retired', unit: 'each', unit_price: 5, is_taxable: true, active: false, pricebook_id: 'plB' },
      { id: 'labor', org_id: ORG, name: 'Crew hour', unit: 'hour', unit_price: 55, is_taxable: false, active: true, pricebook_id: 'plB' },
      { id: 'theirs', org_id: 'org-b', name: 'Other company', unit: 'each', unit_price: 1, is_taxable: true, active: true, pricebook_id: 'plB' },
    ],
  })
}

beforeEach(() => (created.length = 0))

describe('parseOneOffBody', () => {
  test('needs lines, quantities, descriptions and prices', () => {
    expect(parseOneOffBody({})).toMatchObject({ ok: false })
    expect(parseOneOffBody({ lines: [] })).toMatchObject({ ok: false })
    expect(parseOneOffBody({ lines: [{ description: 'x', qty: 0, priceCents: 100 }] })).toMatchObject({ ok: false })
    expect(parseOneOffBody({ lines: [{ description: '', qty: 1, priceCents: 100 }] })).toMatchObject({ ok: false })
    expect(parseOneOffBody({ lines: [{ description: 'x', qty: 1 }] })).toMatchObject({ ok: false })
    expect(parseOneOffBody({ lines: [{ description: 'x', qty: 1, priceCents: -1 }] })).toMatchObject({ ok: false })
    expect(parseOneOffBody({ lines: [{ description: 'x', qty: 1, priceCents: 1.5 }] })).toMatchObject({ ok: false })
    expect(parseOneOffBody({ lines: Array.from({ length: 41 }, () => ({ description: 'x', qty: 1, priceCents: 1 })) })).toMatchObject({ ok: false })
    const ok = parseOneOffBody({ lines: [{ itemId: 'mow', optionKey: 's', qty: 2 }, { description: ' Gate repair ', qty: 1, priceCents: 8000, taxable: true }], propertyId: 'p1', publicNote: ' thanks ' })
    expect(ok).toEqual({ ok: true, value: { lines: [{ kind: 'item', itemId: 'mow', optionKey: 's', qty: 2, priceCents: null }, { kind: 'typed', description: 'Gate repair', qty: 1, priceCents: 8000, taxable: true }], propertyId: 'p1', publicNote: 'thanks' } })
  })
})

describe('the customer catalog', () => {
  test('the customer’s own price list, active items, this company only', async () => {
    const c = await loadCustomerCatalog(db().client as never, ORG, 'c1')
    expect(c.map((i) => i.id).sort()).toEqual(['edge', 'labor', 'mow'])
    expect(c.find((i) => i.id === 'mow')!.options).toEqual([{ key: 's', label: 'Small', priceCents: 3000 }, { key: 'l', label: 'Large', priceCents: 6000 }])
  })
})

describe('buildOneOffLines', () => {
  const build = (lines: Parameters<typeof buildOneOffLines>[3]) => buildOneOffLines(db().client as never, ORG, 'c1', lines)

  test('price-book lines are priced from the book (option, item, hour unit); typed lines as typed', async () => {
    const { lines: out, manualNotes } = await build([
      { kind: 'item', itemId: 'mow', optionKey: 'l', qty: 2, priceCents: null },
      { kind: 'item', itemId: 'edge', optionKey: null, qty: 1, priceCents: null },
      { kind: 'item', itemId: 'labor', optionKey: null, qty: 1.5, priceCents: null },
      { kind: 'typed', description: 'Gate repair', qty: 1, priceCents: 8000, taxable: true },
    ])
    expect(out).toEqual([
      { description: 'Mow (Large)', qty: 2, unit_price_cents: 6000, taxable: true },
      { description: 'Edging', qty: 1, unit_price_cents: 1550, taxable: false },
      { description: 'Crew hour', qty: 1.5, unit_price_cents: 5500, taxable: false, unit: 'hour' },
      { description: 'Gate repair', qty: 1, unit_price_cents: 8000, taxable: true },
    ])
    expect(manualNotes).toEqual([])
  })
  test('a typed price on a price-book line overrides it and is tagged manual for staff', async () => {
    const r = await build([{ kind: 'item', itemId: 'edge', optionKey: null, qty: 1, priceCents: 2000 }])
    expect(r.lines[0].unit_price_cents).toBe(2000)
    expect(r.manualNotes).toEqual(['Manual price: Edging at $20.00 (price book $15.50)'])
  })
  test('an item with sizes needs one; an unknown size, another list’s item, a retired or another company’s item are refused', async () => {
    await expect(build([{ kind: 'item', itemId: 'mow', optionKey: null, qty: 1, priceCents: null }])).rejects.toThrow('Pick a size')
    await expect(build([{ kind: 'item', itemId: 'mow', optionKey: 'xl', qty: 1, priceCents: null }])).rejects.toThrow('not offered')
    await expect(build([{ kind: 'item', itemId: 'std-only', optionKey: null, qty: 1, priceCents: null }])).rejects.toThrow('no longer available')
    await expect(build([{ kind: 'item', itemId: 'off', optionKey: null, qty: 1, priceCents: null }])).rejects.toThrow('no longer available')
    await expect(build([{ kind: 'item', itemId: 'theirs', optionKey: null, qty: 1, priceCents: null }])).rejects.toThrow('no longer available')
  })
})

describe('createOneOffInvoice', () => {
  test('goes through the one writer with the customer, property, note and priced lines', async () => {
    const r = await createOneOffInvoice(db().client as never, ORG, 'u1', 'c1', { lines: [{ kind: 'item', itemId: 'edge', optionKey: null, qty: 2, priceCents: null }], propertyId: 'p1', publicNote: 'Thanks' })
    expect(r).toEqual({ invoiceId: 'new-inv' })
    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({ customerId: 'c1', propertyId: 'p1', createdBy: 'u1', publicNote: 'Thanks', lines: [{ description: 'Edging', qty: 2, unit_price_cents: 1550, taxable: false }] })
  })
  test('another customer’s property is refused and nothing is made', async () => {
    await expect(createOneOffInvoice(db().client as never, ORG, 'u1', 'c1', { lines: [{ kind: 'typed', description: 'x', qty: 1, priceCents: 100, taxable: false }], propertyId: 'p2', publicNote: null })).rejects.toThrow('not this customer')
    expect(created).toHaveLength(0)
  })
})

describe('manual price shows on the staff view', () => {
  test('the invoice\'s internal note carries the manual-price line (customer copy untouched)', async () => {
    await createOneOffInvoice(db().client as never, ORG, 'u1', 'c1', { lines: [{ kind: 'item', itemId: 'edge', optionKey: null, qty: 1, priceCents: 2000 }], propertyId: null, publicNote: 'Thanks' })
    expect(created[0]).toMatchObject({ internalNote: 'Manual price: Edging at $20.00 (price book $15.50)', publicNote: 'Thanks' })
  })
})
