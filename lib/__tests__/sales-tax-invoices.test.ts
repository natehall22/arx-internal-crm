import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { addInvoiceItem, deleteInvoiceItem } from '@/lib/invoices'

const ORG = 'org-a'
const salesTax = {
  enabled: true,
  rates: [
    { id: 'state', name: 'State', percent: 6, active: true },
    { id: 'county', name: 'Leon County', percent: 1.5, active: true },
  ],
  defaultRateIds: ['state', 'county'],
}

function db(settings: Record<string, unknown>, customer: Record<string, unknown> = { id: 'c1', org_id: ORG, tax_exempt: false }) {
  return createFakeDb({
    orgs: [{ id: ORG, settings }],
    customers: [customer],
    production_jobs: [{ id: 'j1', org_id: ORG, customer_id: 'c1', sale_amount: 1000 }],
    job_invoices: [{ id: 'i1', job_id: 'j1', status: 'draft', subtotal_cents: 0, total_cents: 0 }],
    job_invoice_items: [],
  }, { relations: { job_invoice_items: { job_invoices: { table: 'job_invoices', fk: 'invoice_id' } } } })
}

const invoice = (d: ReturnType<typeof db>) => d.tables.job_invoices.find((r) => r.id === 'i1')!

describe('invoice sales tax (lib/invoices.ts recalculation)', () => {
  it('taxes only lines marked taxable, one row per company rate, total = subtotal + tax', async () => {
    const d = db({ salesTax })
    await addInvoiceItem(d.client, 'i1', { description: 'Mowing (not taxable in FL)', qty: 4, unit_price_cents: 4500 })
    await addInvoiceItem(d.client, 'i1', { description: 'Window cleaning', qty: 1, unit_price_cents: 20033, taxable: true })
    const inv = invoice(d)
    expect(inv.subtotal_cents).toBe(18000 + 20033)
    expect(inv.taxable_subtotal_cents).toBe(20033)
    expect(inv.tax_lines).toEqual([
      { id: 'state', name: 'State', percent: 6, amount_cents: 1202 }, // 1201.98
      { id: 'county', name: 'Leon County', percent: 1.5, amount_cents: 300 }, // 300.495
    ])
    expect(inv.tax_cents).toBe(1502)
    expect(inv.total_cents).toBe(38033 + 1502)
  })

  it('exempt customer: nothing charged', async () => {
    const d = db({ salesTax }, { id: 'c1', org_id: ORG, tax_exempt: true })
    await addInvoiceItem(d.client, 'i1', { description: 'Window cleaning', qty: 1, unit_price_cents: 10000, taxable: true })
    expect(invoice(d)).toMatchObject({ tax_cents: 0, tax_lines: [], total_cents: 10000 })
  })

  it('company not set up (the original company): a taxable line still adds no tax', async () => {
    const d = db({})
    await addInvoiceItem(d.client, 'i1', { description: 'Roofing - Per Contract', qty: 1, unit_price_cents: 1632500 })
    expect(invoice(d)).toMatchObject({ subtotal_cents: 1632500, tax_cents: 0, total_cents: 1632500 })
    // and the line row is written without a taxable column, exactly as before
    expect(d.tables.job_invoice_items[0]).not.toHaveProperty('taxable')
  })

  it('removing the taxable line removes the tax', async () => {
    const d = db({ salesTax })
    const item = await addInvoiceItem(d.client, 'i1', { description: 'Window cleaning', qty: 1, unit_price_cents: 10000, taxable: true })
    await deleteInvoiceItem(d.client, 'i1', item.id)
    expect(invoice(d)).toMatchObject({ subtotal_cents: 0, tax_cents: 0, total_cents: 0 })
  })
})
