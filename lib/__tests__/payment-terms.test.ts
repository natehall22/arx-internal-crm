/** @jest-environment node */
/**
 * Payment terms: company default + per-customer override, the due day worked out ONCE at issue in the company's own
 * calendar day (never the server's UTC day), shown on the invoice email, overdue = a balance past that day.
 */
const sendMail = jest.fn(async () => ({}))
jest.mock('@/lib/setter-email', () => ({ getMailTransport: () => ({ sendMail }), getCrmEmailFrom: () => 'decoy@product.example' }))
jest.mock('@/lib/company-links', () => ({ orgAppUrl: async () => 'https://acme.crm.test', tryOrgAppUrl: async () => 'https://acme.crm.test' }))
jest.mock('@/lib/integrations', () => ({ ...jest.requireActual('@/lib/integrations'), enqueueRecordEvent: async () => undefined, enqueuePaymentRecorded: async () => undefined }))

import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { finalizeAndSendInvoice, duplicateInvoiceAsDraft } from '@/lib/invoices'
import { renderInvoiceEmail } from '@/lib/invoice-email'
import {
  dueDayFor,
  dueLabel,
  effectivePaymentTerms,
  invoiceDaysOverdue,
  loadPaymentTerms,
  parsePaymentTerms,
  readOrgPaymentTerms,
  termsLabelFor,
} from '@/lib/payment-terms'

const ORG = 'org-a'
type Row = Record<string, unknown>

describe('pure rules', () => {
  test('parse / read / effective', () => {
    expect(parsePaymentTerms('net_30')).toBe('net_30')
    expect(parsePaymentTerms('net_45')).toBeNull()
    expect(readOrgPaymentTerms({ paymentTerms: { defaultTerms: 'net_15' } })).toBe('net_15')
    expect(readOrgPaymentTerms({})).toBe('due_on_receipt')
    expect(readOrgPaymentTerms(null)).toBe('due_on_receipt')
    expect(effectivePaymentTerms('net_15', 'net_30')).toBe('net_30') // the customer's own wins
    expect(effectivePaymentTerms('net_15', null)).toBe('net_15')
    expect(effectivePaymentTerms('net_15', 'junk')).toBe('net_15')
  })

  test('due day is calendar math, so DST never moves it (March and November transitions)', () => {
    expect(dueDayFor('2026-03-01', 'net_30')).toBe('2026-03-31') // spans the Mar 8 spring-forward
    expect(dueDayFor('2026-10-20', 'net_15')).toBe('2026-11-04') // spans the Nov 1 fall-back
    expect(dueDayFor('2026-11-03', 'net_30')).toBe('2026-12-03')
    expect(dueDayFor('2026-12-20', 'net_30')).toBe('2027-01-19')
    expect(dueDayFor('2026-11-03', 'due_on_receipt')).toBe('2026-11-03')
  })

  test('overdue = a balance past the due day; paid up, due today and no due day are never late', () => {
    expect(invoiceDaysOverdue('2026-11-01', '2026-11-11', 5000)).toBe(10)
    expect(invoiceDaysOverdue('2026-11-11', '2026-11-11', 5000)).toBe(0)
    expect(invoiceDaysOverdue('2026-11-20', '2026-11-11', 5000)).toBe(0)
    expect(invoiceDaysOverdue('2026-11-01', '2026-11-11', 0)).toBe(0)
    expect(invoiceDaysOverdue(null, '2026-11-11', 5000)).toBe(0)
  })

  test('the label the customer reads', () => {
    const d = (y: string) => y
    expect(dueLabel('2026-11-03', '2026-11-03', d)).toBe('Due on receipt')
    expect(dueLabel('2026-11-03', null, d)).toBe('Due on receipt')
    expect(dueLabel('2026-11-03', '2026-12-03', d)).toBe('Due 2026-12-03 · Net 30')
    expect(dueLabel('2026-11-03', '2026-11-20', d)).toBe('Due 2026-11-20') // a hand-set day names no terms
    expect(termsLabelFor('2026-11-03', '2026-11-18')).toBe('Net 15')
    expect(termsLabelFor('2026-11-03', '2026-11-20')).toBe('')
  })
})

function world(opts: { orgTerms?: string; customerTerms?: string | null; timezone?: string } = {}) {
  return createFakeDb(
    {
      orgs: [{ id: ORG, name: 'Acme Lawn', email: 'office@acme.example', address: '1 Main St', phone: '7045551234', timezone: opts.timezone ?? 'America/New_York', settings: opts.orgTerms ? { paymentTerms: { defaultTerms: opts.orgTerms } } : {} }],
      customers: [{ id: 'c1', org_id: ORG, name: 'Pat Doe', email: 'pat@example.com', payment_terms: opts.customerTerms ?? null }],
      production_jobs: [{ id: 'job1', org_id: ORG, customer_id: 'c1' }],
      job_invoices: [
        { id: 'svc', org_id: ORG, job_id: null, customer_id: 'c1', invoice_number: 'INV-1', status: 'draft', total_cents: 10000, due_at: null, issued_at: null },
        { id: 'jobinv', org_id: ORG, job_id: 'job1', customer_id: null, invoice_number: 'INV-2', status: 'draft', total_cents: 10000, due_at: null, issued_at: null },
        { id: 'old', org_id: ORG, job_id: 'job1', customer_id: null, invoice_number: 'INV-0', status: 'sent', total_cents: 10000, due_at: '2025-01-05', issued_at: '2025-01-01' },
      ],
      job_invoice_items: [
        { id: 'i1', invoice_id: 'svc', description: 'Mow', qty: 1, unit_price_cents: 10000, line_total_cents: 10000, sort_order: 0 },
        { id: 'i2', invoice_id: 'jobinv', description: 'Work', qty: 1, unit_price_cents: 10000, line_total_cents: 10000, sort_order: 0 },
      ],
    },
    { relations: { job_invoices: { job_invoice_items: { table: 'job_invoice_items', fk: 'invoice_id', many: true } } } }
  )
}

describe('loading terms', () => {
  test('company default, customer override, and a database without the column', async () => {
    expect(await loadPaymentTerms(world({ orgTerms: 'net_15' }).client as never, ORG, 'c1')).toBe('net_15')
    expect(await loadPaymentTerms(world({ orgTerms: 'net_15', customerTerms: 'net_30' }).client as never, ORG, 'c1')).toBe('net_30')
    expect(await loadPaymentTerms(world().client as never, ORG, null)).toBe('due_on_receipt')
  })
})

describe('issuing an invoice sets the due day', () => {
  afterEach(() => jest.useRealTimers())

  test('Net 30 customer: issue + 30 in the company day, even when UTC is already tomorrow', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-04T01:30:00Z')) // 8:30pm Nov 3 in New York
    const d = world({ orgTerms: 'net_15', customerTerms: 'net_30' })
    const sent = await finalizeAndSendInvoice(d.client as never, 'svc', 'pat@example.com')
    expect(sent.issued_at).toBe('2026-11-03')
    expect(sent.due_at).toBe('2026-12-03')
  })

  test('a JOB invoice follows the job customer and the company default', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-03-05T17:00:00Z'))
    const d = world({ orgTerms: 'net_30' })
    const sent = await finalizeAndSendInvoice(d.client as never, 'jobinv', 'pat@example.com')
    expect(sent.due_at).toBe('2026-04-04')
  })

  test('default company (no terms set) is unchanged: due on the day it is issued', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-04T15:00:00Z'))
    const sent = await finalizeAndSendInvoice(world().client as never, 'svc', 'pat@example.com')
    expect(sent.due_at).toBe(sent.issued_at)
  })

  test('a due day already set on the draft is kept', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-04T15:00:00Z'))
    const d = world({ orgTerms: 'net_30' })
    ;(d.tables.job_invoices as Row[])[0].due_at = '2026-11-10'
    expect((await finalizeAndSendInvoice(d.client as never, 'svc', 'pat@example.com')).due_at).toBe('2026-11-10')
  })

  test('a copy of an old invoice does not inherit its old due day', async () => {
    const d = world({ orgTerms: 'net_30' })
    const copy = await duplicateInvoiceAsDraft(d.client as never, 'old', 'u1')
    expect(copy.due_at).toBeNull()
  })
})

describe('the invoice email', () => {
  test('says the terms, or Due on receipt', () => {
    const doc = (issued: string | null, due: string | null) =>
      ({
        invoice: { invoice_number: 'INV-9', issued_at: issued, due_at: due, subtotal_cents: 100, total_cents: 100, public_note: null },
        company: { legalName: 'Acme', address: '', phone: '', email: '' },
        billTo: { name: 'Pat', address: '' },
        items: [],
        taxRows: [],
        appliedCents: 0,
        balanceCents: 100,
        isPaid: false,
      }) as never
    expect(renderInvoiceEmail(doc('2026-11-03', '2026-12-03')).text).toContain('Net 30')
    expect(renderInvoiceEmail(doc('2026-11-03', '2026-11-03')).text).toContain('Due on receipt')
    expect(renderInvoiceEmail(doc(null, null)).text).toContain('Due on receipt')
  })
})
