/** @jest-environment node */
/**
 * Master invoices (batches) + customer PO: the pure rules, the billable-job list with the development filter, creating a batch,
 * sending it (one email, each house issued through the one issuer), and one payment split over the houses (retry-safe).
 * Job money stays per job: nothing here writes money or the outbox itself (guard test at the bottom).
 */
import fs from 'fs'
import path from 'path'

const sendMail = jest.fn(async () => ({}))
jest.mock('@/lib/setter-email', () => ({ getMailTransport: () => ({ sendMail }) }))
jest.mock('@/lib/cron-orgs', () => ({ loadOrgTimeZone: async () => 'America/New_York' }))
jest.mock('@/lib/company-links', () => ({ tryOrgAppUrl: async () => 'https://builder.example' }))
const mockCreate = jest.fn<Promise<{ id: string }>, [unknown, string, string, number]>()
const mockUpdateItem = jest.fn(async (..._a: unknown[]) => ({}))
const mockVoid = jest.fn(async (..._a: unknown[]) => ({}))
const mockFinalize = jest.fn(async (..._a: unknown[]) => ({}))
const mockBalance = jest.fn<Promise<{ balance_cents: number }>, [unknown, string]>()
jest.mock('@/lib/invoices', () => ({
  CUSTOMER_PAYMENT_METHODS: ['cash', 'check', 'card', 'ach', 'other'],
  createCustomAmountInvoice: (c: unknown, j: string, u: string, cents: number) => mockCreate(c, j, u, cents),
  updateInvoiceItem: (...a: unknown[]) => mockUpdateItem(...a),
  voidInvoice: (...a: unknown[]) => mockVoid(...a),
  finalizeAndSendInvoice: (...a: unknown[]) => mockFinalize(...a),
  issueDatesFor: async () => ({ issuedAt: '2026-11-18', dueAt: '2026-12-18' }),
  computeInvoiceBalance: (c: unknown, id: string) => mockBalance(c, id),
}))
jest.mock('@/lib/invoice-document', () => ({
  isUsableCustomerEmail: (e: string) => !!e && e.includes('@'),
  loadInvoiceDocument: async () => ({ billTo: { name: 'Acme Homes', email: 'ap@acme.example' }, company: { legalName: 'Precision Maintenance LLC', address: '', phone: '', email: '' } }),
}))
jest.mock('@/lib/invoice-email', () => ({ resolveInvoiceSender: async () => ({ ok: true, from: 'x@y.z', replyTo: 'x@y.z' }) }))
const mockReceipt = jest.fn(async (..._a: unknown[]) => 'sent')
jest.mock('@/lib/payment-receipt', () => ({ sendPaymentReceipt: (...a: unknown[]) => mockReceipt(...a) }))
type PayPartArgs = [unknown, string, { invoice_id: string; cents: number; job_id: string | null }, { key: string }]
const mockPayPart = jest.fn<Promise<unknown>, PayPartArgs>()
jest.mock('@/lib/visit-collections-db', () => ({ payPart: (...a: PayPartArgs) => mockPayPart(...a) }))

import { createFakeDb } from '@/lib/test-helpers/fake-db'
import {
  batchDevelopment, batchLineWhere, batchNumberFor, developmentOptions, filterByDevelopment, nextBatchSeq, normalizeCustomerPo, renderBatchEmail, splitBatchPayment, type BatchDocument,
} from '@/lib/invoice-batch'
import { createInvoiceBatch, loadBatchDocument, loadBillableJobs, recordBatchPayment, sendInvoiceBatch } from '@/lib/invoice-batch-db'
import { invoiceRowsToResult, invoiceSearchText } from '@/lib/invoice-list'

const ORG = 'org-a'
const U1 = '00000000-0000-4000-8000-000000000001'

describe('pure rules', () => {
  it('numbers B-0001 upward from the company\'s own', () => {
    expect(batchNumberFor(3)).toBe('B-0003')
    expect(nextBatchSeq([])).toBe(1)
    expect(nextBatchSeq(['B-0002', 'B-0010', 'junk'])).toBe(11)
  })
  it('names the development in the header only when every house is in one', () => {
    expect(batchDevelopment([{ community: 'Oak Ridge' }, { community: 'Oak Ridge' }])).toBe('Oak Ridge')
    expect(batchDevelopment([{ community: 'Oak Ridge' }, { community: 'Pine Glen' }])).toBeNull()
    expect(batchDevelopment([{ community: 'Oak Ridge' }, { community: null }])).toBeNull()
    expect(batchDevelopment([{ community: null }])).toBeNull()
  })
  it('lot first, then address; the development only when the header does not carry it', () => {
    expect(batchLineWhere({ lot: '14', address: '220 Oak Ln', community: 'Oak Ridge' }, true)).toBe('Oak Ridge · Lot 14 · 220 Oak Ln')
    expect(batchLineWhere({ lot: 'Lot 14', address: '220 Oak Ln', community: 'Oak Ridge' }, false)).toBe('Lot 14 · 220 Oak Ln')
    expect(batchLineWhere({ lot: null, address: '5 Main', community: null }, true)).toBe('5 Main')
  })
  it('the development filter: all, or one development; none offered when no house has one', () => {
    const jobs = [{ community: 'A' }, { community: 'B' }, { community: 'A' }, { community: null }]
    expect(developmentOptions(jobs)).toEqual([{ name: 'A', count: 2 }, { name: 'B', count: 1 }])
    expect(filterByDevelopment(jobs, '')).toHaveLength(4)
    expect(filterByDevelopment(jobs, 'A')).toHaveLength(2)
    expect(developmentOptions([{ community: null }])).toEqual([])
  })
  it('splits one payment oldest first, never more than each owes, and reports a leftover', () => {
    expect(splitBatchPayment(700, [{ id: 'a', balanceCents: 500 }, { id: 'b', balanceCents: 500 }])).toEqual({ parts: [{ invoiceId: 'a', cents: 500 }, { invoiceId: 'b', cents: 200 }], leftoverCents: 0 })
    expect(splitBatchPayment(2000, [{ id: 'a', balanceCents: 500 }]).leftoverCents).toBe(1500)
  })
  it('reads a typed PO once: trimmed, blank = none, 60 characters at most', () => {
    expect(normalizeCustomerPo('  PO  123 ')).toEqual({ ok: true, value: 'PO 123' })
    expect(normalizeCustomerPo('   ')).toEqual({ ok: true, value: null })
    expect(normalizeCustomerPo('x'.repeat(61)).ok).toBe(false)
    expect(normalizeCustomerPo(5).ok).toBe(false)
  })
  it('the invoice list searches and exports the PO and master invoice', () => {
    const row = { invoiceNumber: 'INV-1', customerName: 'Acme', jobNumber: '26-1', customerPo: 'PO-77', batchNumber: 'B-0003' } as never
    expect(invoiceSearchText(row)).toContain('PO-77')
    expect(invoiceSearchText(row)).toContain('B-0003')
    const out = invoiceRowsToResult([{ ...(row as object), id: 'i', customerId: 'c', jobId: 'j', status: 'sent', createdAt: '', createdDay: '', issuedAt: null, dueAt: null, totalCents: 100, paidCents: 0, balanceCents: 100, daysOverdue: 0, batchId: 'b' } as never])
    expect(out.rows[0]).toMatchObject({ po: 'PO-77', master: 'B-0003' })
  })
})

const doc = (over: Partial<BatchDocument> = {}): BatchDocument => ({
  batch: { id: 'b1', number: 'B-0003', sentAt: null, sentToEmail: null, publicNote: null, createdAt: '2026-11-18T00:00:00Z' },
  lines: [
    { invoiceId: 'i1', invoiceNumber: 'INV-1', jobId: 'j1', jobNumber: '26-0001', address: '220 Oak Ln', lot: '14', community: 'Oak Ridge', customerPo: 'PO-9', amountCents: 150000, paidCents: 0 },
    { invoiceId: 'i2', invoiceNumber: 'INV-2', jobId: 'j2', jobNumber: '26-0002', address: '222 Oak Ln', lot: '15', community: 'Oak Ridge', customerPo: null, amountCents: 250000, paidCents: 0, rollCount: 12 },
  ],
  totalCents: 400000, paidCents: 0, balanceCents: 400000, development: 'Oak Ridge', taxCents: 0, dueAt: '2026-12-18', issued: false,
  billTo: { name: 'Acme Homes', email: 'ap@acme.example' },
  company: { legalName: 'Precision Maintenance LLC', address: '', phone: '', email: '' },
  ...over,
})

describe('the master invoice email', () => {
  it('one block per house with job, lot / address, PO and amount; one total; the development in the header; roll count only when supplied', () => {
    const m = renderBatchEmail(doc(), { portalUrl: 'https://x.example/portal/batches/b1' })
    expect(m.subject).toBe('Invoice B-0003 — Oak Ridge from Precision Maintenance LLC')
    expect(m.text).toContain('Lot 14 · 220 Oak Ln (job 26-0001, PO PO-9): $1,500.00')
    expect(m.text).toContain('(job 26-0002, 12 rolls)')
    expect(m.html).toContain('due Fri, Dec 18, 2026') // a readable date, never 2026-12-18
    expect(m.text).not.toContain('(job 26-0001, PO PO-9, ')
    expect(m.text).toContain('Total $4,000.00')
    expect(m.html).toContain('View this invoice online')
    expect(m.text).not.toContain('Oak Ridge ·') // the header carries the development, the lines do not repeat it
  })
  it('across developments the header names none and each line carries its own', () => {
    const d = doc({ development: null })
    expect(renderBatchEmail(d).text).toContain('Oak Ridge · Lot 14 · 220 Oak Ln')
    expect(renderBatchEmail(d).subject).toBe('Invoice B-0003 from Precision Maintenance LLC')
  })
})

function seed() {
  const job = (id: string, n: string, over: Record<string, unknown> = {}) => ({ id, org_id: ORG, customer_id: 'c1', job_number: n, address_text: `${n} Oak Ln`, sale_amount: 1500, status: 'complete', completed_at: `2026-11-1${n.slice(-1)}T00:00:00Z`, customer_po: `PO-${n}`, property_id: null, billing_mode: 'fixed', allow_close_with_balance: false, close_balance_by: null, ...over })
  return createFakeDb(
    {
      production_jobs: [
        job('j1', '1', { property_id: 'p1' }),
        job('j2', '2', { property_id: 'p2' }),
        job('j3', '3', { property_id: 'p3', sale_amount: 1500 }),
        job('j4', '4', { status: 'in_progress' }), // not finished
        job('j5', '5'), // already billed
        job('j6', '6', { billing_mode: 'time_materials' }),
        job('j7', '7', { sale_amount: 2000 }), // 500 collected already
        job('j8', '8', { customer_id: 'other' }),
        job('j9', '9'), // paid in full
      ],
      properties: [
        { id: 'p1', org_id: ORG, community: 'Oak Ridge', lot: '14' },
        { id: 'p2', org_id: ORG, community: 'Oak Ridge', lot: '15' },
        { id: 'p3', org_id: ORG, community: 'Pine Glen', lot: '2' },
      ],
      job_invoices: [
        { id: 'inv5', org_id: ORG, job_id: 'j5', status: 'sent', invoice_kind: 'final', batch_id: null, subtotal_cents: 150000 },
        { id: 'inv7d', org_id: ORG, job_id: 'j7', status: 'paid', invoice_kind: 'deposit', batch_id: null, subtotal_cents: 50000 },
        { id: 'inv3', org_id: ORG, job_id: 'j3', status: 'draft', invoice_kind: 'standard', batch_id: null, subtotal_cents: 120000, created_at: '2026-11-01' },
      ],
      job_invoice_items: [{ id: 'it3', org_id: ORG, invoice_id: 'inv3' }],
      job_payments: [
        { id: 'pay7', job_id: 'j7', payment_type: 'deposit', amount_cents: 50000, funding_status: null },
        { id: 'pay9', job_id: 'j9', payment_type: 'final', amount_cents: 150000, funding_status: null },
        { id: 'pay1p', job_id: 'j1', payment_type: 'other', amount_cents: 100000, funding_status: 'pending' }, // pending money is not money in hand
      ],
      customers: [{ id: 'c1', org_id: ORG, name: 'Acme Homes' }],
      invoice_batches: [],
    },
    { idFactory: (() => { let n = 0; return () => `00000000-0000-4000-8000-0000000001${String(++n).padStart(2, '0')}` })() }
  )
}

describe('Bill finished jobs', () => {
  beforeEach(() => jest.clearAllMocks())
  it('lists finished, unbilled jobs at the amount the collection rule says is owed, with development and lot; paid-in-full jobs are left out', async () => {
    const { jobs, developmentsAvailable } = await loadBillableJobs(seed().client as never, ORG, 'c1')
    expect(developmentsAvailable).toBe(true)
    expect(jobs.map((j) => j.jobNumber)).toEqual(['1', '2', '3', '7']) // 9 is paid in full, 5 billed, 6 hourly, 4 unfinished
    expect(jobs[0]).toMatchObject({ community: 'Oak Ridge', lot: '14', customerPo: 'PO-1', amountCents: 150000, draftInvoiceId: null })
    expect(jobs[2]).toMatchObject({ draftInvoiceId: 'inv3', draftCents: 120000, amountCents: 150000 })
    expect(jobs[3].amountCents).toBe(150000) // 2000 sale − 500 collected
    expect(developmentOptions(jobs)).toEqual([{ name: 'Oak Ridge', count: 2 }, { name: 'Pine Glen', count: 1 }])
  })

  it('reads in a fixed number of queries however many jobs there are (no per-job reads)', async () => {
    const reads: Record<string, number> = {}
    const db = createFakeDb({ production_jobs: [], job_invoices: [], job_payments: [], properties: [] }, { onSelect: (t) => { reads[t] = (reads[t] ?? 0) + 1 } })
    void db
    const big = seed()
    const counts: Record<string, number> = {}
    const wrapped = createFakeDb(
      { production_jobs: Array.from({ length: 30 }, (_, i) => ({ id: `x${i}`, org_id: ORG, customer_id: 'c1', job_number: `${i}`, address_text: 'a', sale_amount: 1000, status: 'complete', property_id: null, billing_mode: 'fixed', allow_close_with_balance: false, close_balance_by: null })) },
      { onSelect: (t) => { counts[t] = (counts[t] ?? 0) + 1 } }
    )
    void big
    await loadBillableJobs(wrapped.client as never, ORG, 'c1')
    expect(counts.job_payments).toBe(1)
    expect(counts.job_invoices).toBe(1)
    expect(counts.production_jobs).toBe(1)
  })

  const wireCreate = (db: ReturnType<typeof seed>, sideEffect?: (jobId: string) => void) =>
    mockCreate.mockImplementation(async (_c, jobId) => {
      const id = `new-${jobId}`
      await (db.client as never as { from: (t: string) => { insert: (r: unknown) => Promise<unknown> } }).from('job_invoices').insert({ id, org_id: ORG, job_id: jobId, status: 'draft', invoice_kind: 'standard', batch_id: null })
      sideEffect?.(jobId)
      return { id }
    })

  it('makes one batch: each house gets its own invoice at the real amount, drafts linked, numbers count up', async () => {
    const db = seed()
    wireCreate(db)
    const a = await createInvoiceBatch(db.client as never, ORG, U1, { customerId: 'c1', jobIds: ['j1', 'j2'] })
    expect(a).toMatchObject({ ok: true, number: 'B-0001' })
    expect(mockCreate.mock.calls.map((c) => [c[1], c[3]])).toEqual([['j1', 150000], ['j2', 150000]])
    const linked = (db.tables.job_invoices as Array<{ id: string; batch_id: string | null }>).filter((i) => i.batch_id).map((i) => i.id).sort()
    expect(linked).toEqual(['new-j1', 'new-j2'])
    expect(await createInvoiceBatch(db.client as never, ORG, U1, { customerId: 'c1', jobIds: ['j1'] })).toMatchObject({ ok: false, status: 409 }) // already billed
    expect(await createInvoiceBatch(db.client as never, ORG, U1, { customerId: 'c1', jobIds: ['j7'] })).toMatchObject({ ok: true, number: 'B-0002' })
  })

  it('refuses a reused draft whose total differs and offers the real amount; "Use" sets the draft to it', async () => {
    const db = seed()
    wireCreate(db)
    const refused = await createInvoiceBatch(db.client as never, ORG, U1, { customerId: 'c1', jobIds: ['j1', 'j3'] })
    expect(refused).toMatchObject({ ok: false, status: 409, code: 'draft_differs', drafts: [{ jobId: 'j3', jobNumber: '3', draftCents: 120000, billableCents: 150000 }] })
    expect(mockCreate).not.toHaveBeenCalled() // nothing was made or changed before the office said yes
    expect(mockUpdateItem).not.toHaveBeenCalled()
    const ok = await createInvoiceBatch(db.client as never, ORG, U1, { customerId: 'c1', jobIds: ['j1', 'j3'], useBillable: ['j3'] })
    expect(ok).toMatchObject({ ok: true })
    expect(mockUpdateItem).toHaveBeenCalledWith(expect.anything(), 'inv3', 'it3', { qty: 1, unit_price_cents: 150000 })
  })

  it('a second Bill call racing the first loses cleanly: 409, its own invoices voided, no empty batch, the winner keeps the house', async () => {
    const db = seed()
    // While this call is making j1's invoice, another call links the reusable draft (inv3) to ITS batch.
    wireCreate(db, (jobId) => {
      if (jobId === 'j1') (db.tables.job_invoices as Array<{ id: string; batch_id: string | null }>).find((i) => i.id === 'inv3')!.batch_id = 'winner'
    })
    const r = await createInvoiceBatch(db.client as never, ORG, U1, { customerId: 'c1', jobIds: ['j1', 'j3'], useBillable: ['j3'] })
    expect(r).toMatchObject({ ok: false, status: 409 })
    expect(mockVoid).toHaveBeenCalledWith(expect.anything(), 'new-j1', expect.any(String))
    expect(db.tables.invoice_batches).toHaveLength(0)
    const rows = db.tables.job_invoices as Array<{ id: string; batch_id: string | null }>
    expect(rows.find((i) => i.id === 'inv3')!.batch_id).toBe('winner')
    expect(rows.find((i) => i.id === 'new-j1')!.batch_id).toBeNull()
  })

  it('refuses a house that is not finished or another customer\'s, and an empty pick', async () => {
    const db = seed()
    expect(await createInvoiceBatch(db.client as never, ORG, U1, { customerId: 'c1', jobIds: ['j4'] })).toMatchObject({ ok: false, status: 409 })
    expect(await createInvoiceBatch(db.client as never, ORG, U1, { customerId: 'c1', jobIds: ['j8'] })).toMatchObject({ ok: false, status: 409 })
    expect(await createInvoiceBatch(db.client as never, ORG, U1, { customerId: 'c1', jobIds: ['j9'] })).toMatchObject({ ok: false, status: 409 }) // paid in full
    expect(await createInvoiceBatch(db.client as never, ORG, U1, { customerId: 'c1', jobIds: [] })).toMatchObject({ ok: false, status: 400 })
  })
})

function batchDb(statuses: Record<string, string> = { i1: 'sent', i2: 'sent' }, over: { sent_at?: string | null } = {}) {
  const inv = (id: string, job: string, total: number, at: string) => ({ id, org_id: ORG, job_id: job, batch_id: 'b1', status: statuses[id], total_cents: total, tax_cents: 0, invoice_number: `INV-${id}`, created_at: at, due_at: null, customer_po: id === 'i1' ? 'PO-9' : null })
  return createFakeDb({
    invoice_batches: [{ id: 'b1', org_id: ORG, customer_id: 'c1', batch_number: 'B-0003', public_note: null, sent_at: over.sent_at ?? null, sent_to_email: over.sent_at ? 'ap@acme.example' : null, created_at: '2026-11-18T00:00:00Z' }],
    job_invoices: [inv('i1', 'j1', 150000, '2026-11-10'), inv('i2', 'j2', 250000, '2026-11-11')],
    production_jobs: [{ id: 'j1', org_id: ORG, job_number: '26-0001', address_text: '220 Oak Ln', property_id: 'p1' }, { id: 'j2', org_id: ORG, job_number: '26-0002', address_text: '222 Oak Ln', property_id: 'p1' }],
    properties: [{ id: 'p1', org_id: ORG, community: 'Oak Ridge', lot: '14' }],
    invoice_payments: [],
    job_payments: [],
    batch_payments: [],
  })
}
const batchRow = { id: 'b1', customer_id: 'c1', batch_number: 'B-0003', public_note: null, sent_at: null as string | null, sent_to_email: null as string | null, created_at: '2026-11-18T00:00:00Z' }
const sentRow = { ...batchRow, sent_at: '2026-11-18T12:00:00Z', sent_to_email: 'ap@acme.example' }

describe('send', () => {
  beforeEach(() => jest.clearAllMocks())
  it('issues every draft house FIRST, then sends the one email, then records sent_at', async () => {
    const db = batchDb({ i1: 'draft', i2: 'draft' })
    const r = await sendInvoiceBatch(db.client as never, ORG, batchRow)
    expect(r).toEqual({ ok: true, to: 'ap@acme.example' })
    expect(sendMail).toHaveBeenCalledTimes(1)
    expect(mockFinalize).toHaveBeenCalledTimes(2)
    expect(Math.max(...mockFinalize.mock.invocationCallOrder)).toBeLessThan(sendMail.mock.invocationCallOrder[0])
    expect((db.tables.invoice_batches as Array<{ sent_at: string | null }>)[0].sent_at).not.toBeNull()
  })
  it('a retry of a batch whose email went sends nothing again; "Email again" (resend) does', async () => {
    const db = batchDb()
    expect(await sendInvoiceBatch(db.client as never, ORG, sentRow)).toMatchObject({ ok: true, alreadySent: true })
    expect(sendMail).not.toHaveBeenCalled()
    expect(await sendInvoiceBatch(db.client as never, ORG, sentRow, { resend: true })).toMatchObject({ ok: true })
    expect(sendMail).toHaveBeenCalledTimes(1)
    expect(mockFinalize).not.toHaveBeenCalled()
  })
  it('an email failure leaves sent_at empty; the retry only sends the email (the houses are already issued)', async () => {
    const db = batchDb({ i1: 'draft', i2: 'draft' })
    sendMail.mockRejectedValueOnce(new Error('smtp down'))
    expect(await sendInvoiceBatch(db.client as never, ORG, batchRow)).toMatchObject({ ok: false })
    expect((db.tables.invoice_batches as Array<{ sent_at: string | null }>)[0].sent_at).toBeNull()
    mockFinalize.mockClear()
    for (const i of db.tables.job_invoices as Array<{ status: string }>) i.status = 'sent'
    expect(await sendInvoiceBatch(db.client as never, ORG, batchRow)).toMatchObject({ ok: true })
    expect(mockFinalize).not.toHaveBeenCalled()
    expect(sendMail).toHaveBeenCalledTimes(2)
  })
  it('the document carries the PO, lot, development and totals of the houses', async () => {
    const d = await loadBatchDocument(batchDb().client as never, ORG, batchRow, { rollCounts: new Map([['j2', 12]]) })
    expect(d).toMatchObject({ totalCents: 400000, development: 'Oak Ridge', lines: [{ customerPo: 'PO-9', lot: '14' }, { rollCount: 12 }] })
  })
})

describe('one payment split over the houses', () => {
  beforeEach(() => jest.clearAllMocks())
  function wire(db: ReturnType<typeof batchDb>, failOn?: string) {
    const bal: Record<string, number> = { i1: 150000, i2: 250000 }
    mockBalance.mockImplementation(async (_c, id) => ({ balance_cents: bal[id] }))
    mockPayPart.mockImplementation(async (_c, _o, part, c) => {
      if (failOn && part.invoice_id === failOn) return { ok: false, status: 500, error: 'boom' }
      bal[part.invoice_id] -= part.cents
      await (db.client as never as { from: (t: string) => { insert: (r: unknown) => Promise<unknown> } }).from('job_payments').insert({ id: `pay-${c.key}`, job_id: part.job_id, amount_cents: part.cents, idempotency_key: c.key })
      return { ok: true, paymentId: `pay-${c.key}` }
    })
    return bal
  }
  const input = { amountCents: 200000, paidAt: '2026-11-20', method: 'check' as const, clientKey: 'key-12345678' }
  const rowOf = (db: ReturnType<typeof batchDb>) => (db.tables.batch_payments as Array<{ allocations: Array<{ invoice_id: string; cents: number; payment_id: string | null }>; receipt_claimed_at: string | null }>)[0]

  it('saves the split first, pays the oldest house first through the per-invoice writer with one key per house, and sends ONE receipt', async () => {
    const db = batchDb()
    const bal = wire(db)
    expect(await recordBatchPayment(db.client as never, ORG, U1, batchRow, input)).toEqual({ ok: true, parts: 2, alreadyRecorded: false })
    expect(bal).toEqual({ i1: 0, i2: 200000 })
    expect(mockPayPart.mock.calls.map((c) => [c[2].invoice_id, c[2].cents, c[2].job_id])).toEqual([['i1', 150000, 'j1'], ['i2', 50000, 'j2']])
    expect(mockPayPart.mock.calls[0][3].key).toBe('batch-pay:b1:key-12345678:i1')
    expect(rowOf(db).allocations.every((a) => a.payment_id)).toBe(true)
    expect(mockReceipt).toHaveBeenCalledTimes(1)
    expect(mockReceipt.mock.calls[0][2]).toMatchObject({ amountCents: 200000, customerId: 'c1' })
  })

  it('a retry applies each SAVED allocation exactly and never re-splits live balances', async () => {
    const db = batchDb()
    const bal = wire(db, 'i2')
    expect(await recordBatchPayment(db.client as never, ORG, U1, batchRow, input)).toMatchObject({ ok: false })
    expect(rowOf(db).allocations.map((a) => [a.invoice_id, a.cents, !!a.payment_id])).toEqual([['i1', 150000, true], ['i2', 50000, false]])
    expect(mockReceipt).not.toHaveBeenCalled()
    // Balances moved meanwhile (a refund reopened house 1): a live re-split would now pay house 1 again.
    bal.i1 = 100000
    mockPayPart.mockClear()
    wire(db) // payPart works now
    mockBalance.mockImplementation(async (_c, id) => ({ balance_cents: id === 'i1' ? 100000 : 250000 }))
    expect(await recordBatchPayment(db.client as never, ORG, U1, batchRow, input)).toMatchObject({ ok: true, parts: 1 })
    expect(mockPayPart.mock.calls.map((c) => [c[2].invoice_id, c[2].cents])).toEqual([['i2', 50000]])
    expect(mockReceipt).toHaveBeenCalledTimes(1)
  })

  it('a double tap (same key) writes nothing twice and sends ONE receipt', async () => {
    const db = batchDb()
    wire(db)
    await recordBatchPayment(db.client as never, ORG, U1, batchRow, input)
    mockPayPart.mockClear()
    expect(await recordBatchPayment(db.client as never, ORG, U1, batchRow, input)).toEqual({ ok: true, parts: 0, alreadyRecorded: true })
    expect(mockPayPart).not.toHaveBeenCalled()
    expect(mockReceipt).toHaveBeenCalledTimes(1)
    expect(db.tables.batch_payments).toHaveLength(1)
  })

  it('refuses more than the balance, an unsent master invoice, a missing key, and a reused key with another amount', async () => {
    const db = batchDb()
    wire(db)
    expect(await recordBatchPayment(db.client as never, ORG, U1, batchRow, { ...input, amountCents: 900000 })).toMatchObject({ ok: false, status: 400 })
    expect(mockPayPart).not.toHaveBeenCalled()
    expect(db.tables.batch_payments).toHaveLength(0)
    expect(await recordBatchPayment(batchDb({ i1: 'draft', i2: 'sent' }).client as never, ORG, U1, batchRow, input)).toMatchObject({ ok: false, status: 409 })
    expect(await recordBatchPayment(db.client as never, ORG, U1, batchRow, { ...input, clientKey: '' })).toMatchObject({ ok: false, status: 400 })
    await recordBatchPayment(db.client as never, ORG, U1, batchRow, input)
    expect(await recordBatchPayment(db.client as never, ORG, U1, batchRow, { ...input, amountCents: 100 })).toMatchObject({ ok: false, status: 409 })
  })
})

describe('job money stays per job', () => {
  const ROOT = path.resolve(__dirname, '../..')
  const src = fs.readFileSync(path.join(ROOT, 'lib/invoice-batch-db.ts'), 'utf8')
  const migration = fs.readFileSync(path.join(ROOT, 'supabase/migrations/202611300180_customer_po_and_invoice_batches.sql'), 'utf8')
  it('the batch module never writes money or the QuickBooks outbox itself', () => {
    expect(src).not.toMatch(/lib\/integrations|enqueue[A-Z]/)
    expect(src).not.toMatch(/from\('job_payments'\)\s*\.(insert|update|delete)/)
    expect(src).not.toMatch(/from\('(job_invoice_items|invoice_payments)'\)\s*\.(insert|update|delete)/)
    expect(src).not.toMatch(/job_id:\s*null/)
  })
  it('the batch table holds a header only: no amounts, and no policy for browsers', () => {
    const table = migration.slice(migration.indexOf('CREATE TABLE IF NOT EXISTS public.invoice_batches'), migration.indexOf('CREATE UNIQUE INDEX'))
    expect(table).not.toMatch(/cents|amount|total/i)
    expect(migration).toMatch(/ENABLE ROW LEVEL SECURITY/)
    expect(migration).toMatch(/REVOKE ALL ON public\.invoice_batches FROM anon, authenticated/)
    expect(migration).not.toMatch(/CREATE POLICY/i)
  })
  it('a house on a master invoice cannot be sent or issued on its own, on any path (checked on the row, fails closed)', () => {
    for (const f of ['lib/invoice-email.ts', 'lib/online-payments/autopay.ts', 'app/api/invoices/[invoiceId]/pay-link/route.ts']) {
      expect(`${f}: ${/invoice\.batch_id\)/.test(fs.readFileSync(path.join(ROOT, f), 'utf8'))}`).toBe(`${f}: true`)
    }
    const link = fs.readFileSync(path.join(ROOT, 'app/api/invoices/[invoiceId]/pay-link/route.ts'), 'utf8')
    expect(link.indexOf('invoice.batch_id')).toBeLessThan(link.indexOf('finalizeAndSendInvoice(a.admin'))
  })
})
