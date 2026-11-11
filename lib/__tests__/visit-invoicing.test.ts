/** @jest-environment node */
/**
 * Invoicing recurring service on the ONE invoice system (job_invoices without a job, migration 202611110060):
 * monthly batch, idempotent re-run, void frees, tax by the invoice's customer, email with the company's own brand,
 * "Mark paid" through the one payment writer, paid in full without a job, a billed visit can't be reopened, and the
 * company fence on invoices without a job. The SQL itself (locks, skips, refusals) runs in
 * supabase/tests/customer_invoices.test.sql against real Postgres.
 */
const sendMail = jest.fn(async () => ({}))
jest.mock('@/lib/setter-email', () => ({ getMailTransport: () => ({ sendMail }), getCrmEmailFrom: () => 'Green Co <office@green.example>' }))
jest.mock('@/lib/cron-orgs', () => ({ loadOrgTimeZone: async () => 'America/New_York' }))

import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { applyPaymentToInvoice, computeInvoiceBalance, findOrgInvoice, recordCustomerInvoicePayment } from '@/lib/invoices'
import { createServiceInvoices, loadReadyToBill, visitInvoiceNumber } from '@/lib/service-billing-db'
import { findPrintableInvoice, loadInvoiceDocument } from '@/lib/invoice-document'
import { renderInvoiceEmail } from '@/lib/invoice-email'
import { applyVisitAction } from '@/lib/service-plans-db'

const ORG = 'org-a'
const OTHER = 'org-b'
const NOW = new Date('2026-11-11T15:00:00Z')
const salesTax = { enabled: true, rates: [{ id: 'fl', name: 'Florida', percent: 6, active: true }], defaultRateIds: ['fl'] }

const relations = {
  job_invoice_items: { job_invoices: { table: 'job_invoices', fk: 'invoice_id' } },
  job_invoices: { job_invoice_items: { table: 'job_invoice_items', fk: 'invoice_id', many: true }, production_jobs: { table: 'production_jobs', fk: 'job_id' } },
}

const visit = (id: string, plan: string, customer: string, property: string, day: string, status = 'completed') => ({
  id,
  org_id: ORG,
  work_order_type: 'service_visit',
  visit_step: 'service',
  status,
  service_plan_id: plan,
  customer_id: customer,
  property_id: property,
  scheduled_date: day,
  completed_at: status === 'completed' ? `${day}T16:00:00Z` : null,
  updated_at: '2026-11-01T00:00:00Z',
})

function seed() {
  let n = 0
  const rpcCalls: string[] = []
  const db = createFakeDb(
    {
      orgs: [
        { id: ORG, name: 'Green Co', phone: '8505551234', email: 'office@green.example', address: '1 Main St\nCrawfordville, FL', settings: { salesTax, brand: { legalName: 'Green Co, LLC' } }, timezone: 'America/New_York' },
        { id: OTHER, name: 'Other Co', settings: {} },
      ],
      customers: [
        { id: 'c1', org_id: ORG, name: 'Pat <Lee>', email: 'pat@example.com', tax_exempt: false },
        { id: 'c2', org_id: ORG, name: 'Sam', email: null, tax_exempt: false },
        { id: 'cx', org_id: OTHER, name: 'Other', email: 'x@example.com' },
      ],
      properties: [
        { id: 'p1', org_id: ORG, customer_id: 'c1', address_text: '1 Oak St' },
        { id: 'p2', org_id: ORG, customer_id: 'c2', address_text: '2 Elm St' },
      ],
      service_plans: [
        { id: 'mow', org_id: ORG, customer_id: 'c1', property_id: 'p1', name: 'Weekly mowing', billing_basis: 'per_visit', price: 45, taxable: false },
        { id: 'care', org_id: ORG, customer_id: 'c1', property_id: 'p1', name: 'Gutter care', billing_basis: 'per_month', price: 100, taxable: true },
        { id: 'mow2', org_id: ORG, customer_id: 'c2', property_id: 'p2', name: 'Weekly mowing', billing_basis: 'per_visit', price: 40, taxable: false },
      ],
      work_orders: [
        visit('v1', 'mow', 'c1', 'p1', '2026-10-06'),
        visit('v2', 'mow', 'c1', 'p1', '2026-10-13'),
        visit('g1', 'care', 'c1', 'p1', '2026-10-20'),
        visit('s1', 'mow2', 'c2', 'p2', '2026-10-07'),
        visit('open', 'mow2', 'c2', 'p2', '2026-10-28', 'scheduled'),
        visit('nov', 'mow', 'c1', 'p1', '2026-11-03'),
      ],
      service_visit_charges: [
        { work_order_id: 'v1', org_id: ORG, price: 45, taxable: false },
        { work_order_id: 'v2', org_id: ORG, price: 45, taxable: false },
        { work_order_id: 'g1', org_id: ORG, price: null, taxable: true },
        { work_order_id: 's1', org_id: ORG, price: 40, taxable: false },
        { work_order_id: 'nov', org_id: ORG, price: 45, taxable: false },
      ],
      job_invoices: [],
      job_invoice_items: [],
      invoice_payments: [],
      job_payments: [],
      production_jobs: [],
    },
    {
      relations,
      rpc: {
        // Shape only (the real rules are SQL, tested in Postgres): one invoice + its lines.
        create_service_invoice: (args, t) => {
          rpcCalls.push(String(args.p_customer))
          const id = `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`
          t.job_invoices.push({ id, org_id: args.p_org, customer_id: args.p_customer, property_id: args.p_property, job_id: null, status: 'draft', invoice_kind: 'service', invoice_number: `INV-26-0000${n}`, subtotal_cents: 0, total_cents: 0, created_at: NOW.toISOString(), due_at: null })
          ;(args.p_lines as Array<Record<string, unknown>>).forEach((l, i) =>
            t.job_invoice_items.push({ id: `${id}-l${i}`, invoice_id: id, ...l, line_total_cents: Math.round(Number(l.qty) * Number(l.unit_price_cents)), sort_order: i })
          )
          return { invoice_id: id, skipped: [] }
        },
        record_customer_invoice_payment: (args, t) => {
          const inv = t.job_invoices.find((r) => r.id === args.p_invoice && r.org_id === args.p_org && r.job_id == null)
          if (!inv) throw Object.assign(new Error('not found'), { code: 'P0002' })
          const applied = t.invoice_payments.filter((p) => p.invoice_id === inv.id).reduce((s, p) => s + Number(p.applied_cents), 0)
          const balance = Number(inv.total_cents) - applied
          if (Number(args.p_amount_cents) > balance) throw Object.assign(new Error('That is more than the balance due'), { code: '22023' })
          const pay = `pay-${t.job_payments.length + 1}`
          t.job_payments.push({ id: pay, job_id: null, org_id: args.p_org, customer_id: inv.customer_id, amount_cents: args.p_amount_cents, method: args.p_method, paid_at: args.p_paid_at })
          t.invoice_payments.push({ id: `ip-${pay}`, invoice_id: inv.id, job_payment_id: pay, applied_cents: args.p_amount_cents })
          inv.status = balance - Number(args.p_amount_cents) <= 0 ? 'paid' : 'partially_paid'
          return { payment_id: pay, status: inv.status, balance_cents: balance - Number(args.p_amount_cents) }
        },
      },
    }
  )
  return { ...db, rpcCalls }
}

beforeEach(() => {
  sendMail.mockClear()
  process.env.SMTP_HOST = 'smtp.example'
})

describe('Ready to bill → monthly batch', () => {
  it('groups October per customer (November waits), previews and bills with tax, emails who has an email', async () => {
    const d = seed()
    const ready = await loadReadyToBill(d.client, ORG, { now: NOW })
    if (!ready.ready) throw new Error('not ready')
    expect(ready.currentMonth).toBe('2026-11')
    expect(ready.units.map((u) => u.key).sort()).toEqual(['m:care:2026-10', 'v:nov', 'v:s1', 'v:v1', 'v:v2'])

    const res = await createServiceInvoices(d.client, ORG, 'u1', { keys: ['c:c1:2026-10', 'c:c2:2026-10'], grouping: 'month', includeCurrentMonth: false, send: true }, NOW)
    if ('error' in res) throw new Error(res.error)
    expect(res.failed).toEqual([])
    expect(res.created.map((c) => [c.customerName, c.totalCents, c.sent, c.sendError])).toEqual([
      ['Pat <Lee>', 4500 + 4500 + 10000 + 600, true, null], // gutter care taxable at 6%
      ['Sam', 4000, false, 'No email on file — left as a draft'],
    ])
    const pat = d.tables.job_invoices.find((r) => r.customer_id === 'c1')!
    expect(pat).toMatchObject({ status: 'sent', sent_to_email: 'pat@example.com', tax_cents: 600, subtotal_cents: 19000, job_id: null })
    expect(d.tables.job_invoices.find((r) => r.customer_id === 'c2')!.status).toBe('draft')
    // every visit listed: the month + its visit at $0, then the 2 mowing visits (by date)
    expect(d.tables.job_invoice_items.filter((i) => i.invoice_id === pat.id).map((i) => i.unit_price_cents)).toEqual([10000, 0, 4500, 4500])
    expect(sendMail).toHaveBeenCalledTimes(1)
    const mail = (sendMail.mock.calls[0] as unknown as [Record<string, string>])[0]
    expect(mail).toMatchObject({ to: 'pat@example.com', replyTo: 'office@green.example', subject: 'Invoice INV-26-00001 from Green Co, LLC' })
    expect(mail.html).toContain('Pat &lt;Lee&gt;')
    expect(mail.html).not.toMatch(/ARX/)
  })

  it('is idempotent: a second run bills nothing and never calls the writer again', async () => {
    const d = seed()
    await createServiceInvoices(d.client, ORG, 'u1', { keys: ['c:c1:2026-10'], grouping: 'month', includeCurrentMonth: false, send: false }, NOW)
    expect(d.rpcCalls).toEqual(['c1'])
    const again = await createServiceInvoices(d.client, ORG, 'u1', { keys: ['c:c1:2026-10'], grouping: 'month', includeCurrentMonth: false, send: false }, NOW)
    if ('error' in again) throw new Error(again.error)
    expect(again).toEqual({ created: [], alreadyBilled: ['c:c1:2026-10'], failed: [] })
    expect(d.rpcCalls).toEqual(['c1'])
    // the same visits asked for one-by-one are billed too
    const perVisit = await createServiceInvoices(d.client, ORG, 'u1', { keys: ['v:v1', 'm:care:2026-10'], grouping: 'visit', includeCurrentMonth: false, send: false }, NOW)
    if ('error' in perVisit) throw new Error(perVisit.error)
    expect(perVisit.alreadyBilled).toEqual(['v:v1', 'm:care:2026-10'])
    expect(await visitInvoiceNumber(d.client, ORG, 'v1')).toBe('INV-26-00001')
    expect(await visitInvoiceNumber(d.client, OTHER, 'v1')).toBeNull()
  })

  it('voiding the invoice makes its visits billable again', async () => {
    const d = seed()
    await createServiceInvoices(d.client, ORG, 'u1', { keys: ['c:c1:2026-10'], grouping: 'month', includeCurrentMonth: false, send: false }, NOW)
    d.tables.job_invoices[0].status = 'void'
    const ready = await loadReadyToBill(d.client, ORG, { now: NOW })
    if (!ready.ready) throw new Error('not ready')
    expect(ready.units.map((u) => u.key)).toEqual(expect.arrayContaining(['v:v1', 'v:v2', 'm:care:2026-10']))
  })

  it('this month only when included; per-request cap; nothing picked', async () => {
    const d = seed()
    const waiting = await createServiceInvoices(d.client, ORG, 'u1', { keys: ['c:c1:2026-11'], grouping: 'month', includeCurrentMonth: false, send: false }, NOW)
    expect(waiting).toEqual({ created: [], alreadyBilled: ['c:c1:2026-11'], failed: [] })
    const inc = await createServiceInvoices(d.client, ORG, 'u1', { keys: ['c:c1:2026-11'], grouping: 'month', includeCurrentMonth: true, send: false }, NOW)
    if ('error' in inc) throw new Error(inc.error)
    expect(inc.created).toHaveLength(1)
    expect(await createServiceInvoices(d.client, ORG, 'u1', { keys: [], grouping: 'month', includeCurrentMonth: false, send: false }, NOW)).toMatchObject({ status: 400 })
    const many = Array.from({ length: 26 }, (_, i) => `v:${i}`)
    expect(await createServiceInvoices(d.client, ORG, 'u1', { keys: many, grouping: 'visit', includeCurrentMonth: false, send: false }, NOW)).toMatchObject({ status: 400 })
  })

  it('another company sees none of these visits', async () => {
    const d = seed()
    const ready = await loadReadyToBill(d.client, OTHER, { now: NOW })
    expect(ready.ready && ready.units).toEqual([])
  })
})

describe('invoices without a job: company fence, payments, paid in full', () => {
  async function billed() {
    const d = seed()
    await createServiceInvoices(d.client, ORG, 'u1', { keys: ['v:s1'], grouping: 'visit', includeCurrentMonth: false, send: false }, NOW)
    return { d, id: d.tables.job_invoices[0].id as string }
  }

  it('findOrgInvoice / findPrintableInvoice: own company only', async () => {
    const { d, id } = await billed()
    await expect(findOrgInvoice(d.client, id, ORG)).resolves.toEqual({ id, job_id: null, status: 'draft', customer_id: 'c2' })
    await expect(findOrgInvoice(d.client, id, OTHER)).resolves.toBeNull()
    await expect(findPrintableInvoice(d.client, OTHER, id)).resolves.toBeNull()
    await expect(findPrintableInvoice(d.client, OTHER, 'INV-26-00001')).resolves.toBeNull()
    expect((await findPrintableInvoice(d.client, ORG, 'INV-26-00001'))?.id).toBe(id)
  })

  it('the printed / emailed document bills the customer at the property, with the company brand', async () => {
    const { d, id } = await billed()
    const inv = (await findPrintableInvoice(d.client, ORG, id))!
    const doc = await loadInvoiceDocument(d.client, ORG, inv)
    expect(doc.billTo).toEqual({ name: 'Sam', address: '2 Elm St', email: null, phone: null, isLinked: true })
    expect(doc.company).toEqual({ legalName: 'Green Co, LLC', address: '1 Main St\nCrawfordville, FL', phone: '(850) 555-1234', email: 'office@green.example' })
    const mail = renderInvoiceEmail(doc)
    expect(mail.text).toContain('Weekly mowing (Wed, Oct 7, 2026): 1 × $40.00 = $40.00')
  })

  it('Mark paid: partial then full = paid in full with no job; never over; job payments cannot be applied', async () => {
    const { d, id } = await billed()
    expect(await recordCustomerInvoicePayment(d.client, ORG, id, { amountCents: 1500, paidAt: '2026-11-05', method: 'cash', createdBy: 'u1' })).toMatchObject({ ok: true, status: 'partially_paid', balanceCents: 2500 })
    expect(await recordCustomerInvoicePayment(d.client, ORG, id, { amountCents: 9999, paidAt: '2026-11-05', method: 'cash', createdBy: 'u1' })).toEqual({ ok: false, status: 400, error: 'That is more than the balance due' })
    expect(await recordCustomerInvoicePayment(d.client, OTHER, id, { amountCents: 1, paidAt: '2026-11-05', method: 'cash', createdBy: 'u1' })).toEqual({ ok: false, status: 404, error: 'Invoice not found' })
    expect(await recordCustomerInvoicePayment(d.client, ORG, id, { amountCents: 1, paidAt: 'soon', method: 'cash', createdBy: 'u1' })).toMatchObject({ ok: false, status: 400 })
    expect(await recordCustomerInvoicePayment(d.client, ORG, id, { amountCents: 1, paidAt: '2026-11-05', method: 'bitcoin' as never, createdBy: 'u1' })).toMatchObject({ ok: false, status: 400 })
    expect(await recordCustomerInvoicePayment(d.client, ORG, id, { amountCents: 2500, paidAt: '2026-11-06', method: 'check', note: '#1042', createdBy: 'u1' })).toMatchObject({ ok: true, status: 'paid', balanceCents: 0 })
    await expect(computeInvoiceBalance(d.client, id)).resolves.toEqual({ total_cents: 4000, applied_cents: 4000, balance_cents: 0, is_paid: true })
    // the payment rows carry the company + customer and no job, so no job total / payroll ever counts them
    expect(d.tables.job_payments.every((p) => p.job_id === null && p.org_id === ORG && p.customer_id === 'c2')).toBe(true)
    // a payment can't be "applied" to an invoice without a job (no job to match it on)
    d.tables.job_invoices[0].status = 'sent'
    await expect(applyPaymentToInvoice(d.client, id, 'pay-1', 1, 'u1')).rejects.toThrow('Payment not found')
  })

  it('a billed visit cannot be reopened (void the invoice first); an unbilled one can', async () => {
    const { d } = await billed()
    expect(await applyVisitAction(d.client, ORG, 's1', { action: 'reopen' }, { userId: 'u1', subId: null }, { now: NOW })).toEqual({
      ok: false,
      status: 409,
      error: 'This visit is on invoice INV-26-00001 — void that invoice first',
    })
    expect(await applyVisitAction(d.client, ORG, 'v1', { action: 'reopen' }, { userId: 'u1', subId: null }, { now: NOW })).toEqual({ ok: true })
  })
})
