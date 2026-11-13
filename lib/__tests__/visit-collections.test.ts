import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { allocateCollection, cleanCollectionInput, dollarsToCents, summarizeOwed } from '@/lib/visit-collections'
import { confirmCollection, loadCrewMoney, loadOwedByCustomer, loadPendingCollections, recordPendingCollection, rejectCollection } from '@/lib/visit-collections-db'

const mockUnpaid = jest.fn()
const mockRecord = jest.fn()
const mockJobRecord = jest.fn()
const mockApply = jest.fn()
const mockFindInvoice = jest.fn()
jest.mock('@/lib/service-billing-db', () => ({ loadUnpaidInvoices: (...a: unknown[]) => mockUnpaid(...a) }))
jest.mock('@/lib/invoices', () => ({
  recordCustomerInvoicePayment: (...a: unknown[]) => mockRecord(...a),
  applyPaymentToInvoice: (...a: unknown[]) => mockApply(...a),
  findOrgInvoice: (...a: unknown[]) => mockFindInvoice(...a),
}))
jest.mock('@/lib/job-invoice-payment', () => ({ recordJobInvoicePayment: (...a: unknown[]) => mockJobRecord(...a) }))
jest.mock('@/lib/cron-orgs', () => ({ loadOrgTimeZone: async () => 'America/New_York' }))
jest.mock('@/lib/online-payments/accounts', () => ({ loadOnlinePayments: async () => ({ ready: true }) }))

const ORG = 'org-a'
const row = (id: string, customerId: string, balanceCents: number, jobId: string | null = null, jobCancelled = false) => ({
  id,
  invoiceNumber: `INV-${id}`,
  customerId,
  customerName: 'Pat',
  jobId,
  jobNumber: null,
  jobCancelled,
  dueAt: null,
  issuedAt: null,
  balanceCents,
})

beforeEach(() => {
  mockUnpaid.mockReset()
  mockRecord.mockReset()
  mockJobRecord.mockReset()
  mockApply.mockReset()
  mockFindInvoice.mockReset()
  mockFindInvoice.mockImplementation(async (_c: unknown, id: string) => (id === 'ij' ? { id: 'ij', job_id: 'job-1', status: 'sent' } : null))
  mockJobRecord.mockImplementation(async () => ({ ok: true, paymentId: 'jpay-1', balanceCents: 0 }))
  mockUnpaid.mockResolvedValue({ rows: [row('i1', 'c1', 4000), row('i2', 'c1', 3000), row('ij', 'c1', 9999, 'job-1'), row('i3', 'c2', 5000)], capped: false })
  let n = 0
  mockRecord.mockImplementation(async () => ({ ok: true, paymentId: `pay-${++n}`, status: 'paid', balanceCents: 0, duplicate: false }))
})

const db = () => createFakeDb({ visit_collections: [], job_payments: [], customers: [{ id: 'c1', org_id: ORG, name: 'Pat' }], sub_contractors: [{ id: 's1', org_id: ORG, company_name: 'Crew One' }], work_orders: [{ id: 'v1', org_id: ORG, address: '1 Oak St' }] }, { unique: { visit_collections: [['org_id', 'client_tap_id']] } })

describe('pure rules', () => {
  it('reads dollars and cleans a collection body', () => {
    expect(dollarsToCents('$45.50')).toBe(4550)
    expect(dollarsToCents('0')).toBeNull()
    expect(dollarsToCents('abc')).toBeNull()
    expect(cleanCollectionInput({ amount: '45', method: 'check', checkNumber: ' 1042 ', tapId: 'abcdefgh12' })).toEqual({ ok: true, value: { amountCents: 4500, method: 'check', checkNumber: '1042', note: null, tapId: 'abcdefgh12' } })
    expect(cleanCollectionInput({ amount: '45', method: 'card' })).toMatchObject({ ok: false })
    expect(cleanCollectionInput({ amount: '-5', method: 'cash' })).toMatchObject({ ok: false })
  })
  it('splits oldest first and never more than an invoice owes', () => {
    const inv = [{ id: 'a', number: 'A', balanceCents: 4000 }, { id: 'b', number: 'B', balanceCents: 3000 }]
    expect(allocateCollection(5000, inv)).toEqual({ parts: [{ invoiceId: 'a', cents: 4000 }, { invoiceId: 'b', cents: 1000 }], leftoverCents: 0 })
    expect(allocateCollection(8000, inv).leftoverCents).toBe(1000)
    expect(summarizeOwed(inv, 2000)).toMatchObject({ totalCents: 7000, pendingCents: 2000, dueCents: 5000 })
  })
})

describe('what a crew can see', () => {
  it('owed is ALL the customer’s open invoices (job and service) and carries no price or invoice detail', async () => {
    const m = await loadCrewMoney(db().client, ORG, [{ id: 'v1', customerId: 'c1' }, { id: 'v9', customerId: null }])
    expect(m).toEqual({ v1: { dueCents: 16999, pendingCents: 0, canPayOnline: true } })
    expect(JSON.stringify(m)).not.toMatch(/job-1|INV-|ij/)
    expect(Object.keys(m.v1).sort()).toEqual(['canPayOnline', 'dueCents', 'pendingCents'])
  })
  it('a cancelled job’s invoice is never the crew’s to collect (the office settles or voids it)', async () => {
    mockUnpaid.mockResolvedValue({ rows: [row('i1', 'c1', 4000), row('ix', 'c1', 9999, 'job-x', true)], capped: false })
    const m = await loadCrewMoney(db().client, ORG, [{ id: 'v1', customerId: 'c1' }])
    expect(m.v1.dueCents).toBe(4000)
  })
  it('nothing owed = no money block', async () => {
    mockUnpaid.mockResolvedValue({ rows: [], capped: false })
    expect(await loadCrewMoney(db().client, ORG, [{ id: 'v1', customerId: 'c1' }])).toEqual({})
  })
})

describe('pending collection lifecycle', () => {
  const input = (cents: number, tapId: string | null = null) => ({ amountCents: cents, method: 'cash' as const, checkNumber: null, note: null, tapId })

  it('pending is not money: no payment is written, the invoice still owes, but the crew can no longer take it twice', async () => {
    const d = db()
    const r = await recordPendingCollection(d.client, ORG, { subId: 's1', visitId: 'v1', customerId: 'c1', input: input(4000) })
    expect(r).toMatchObject({ ok: true, duplicate: false })
    expect(mockRecord).not.toHaveBeenCalled()
    const owed = (await loadOwedByCustomer(d.client, ORG, ['c1'])).get('c1')!
    expect(owed.totalCents).toBe(16999) // invoice balances untouched
    expect(owed.pendingCents).toBe(4000)
    expect(owed.dueCents).toBe(12999)
    expect(await recordPendingCollection(d.client, ORG, { subId: 's1', visitId: 'v1', customerId: 'c1', input: input(13000) })).toMatchObject({ ok: false, status: 400 })
  })

  it('a resend with the same tap id is the same row', async () => {
    const d = db()
    const a = await recordPendingCollection(d.client, ORG, { subId: 's1', visitId: 'v1', customerId: 'c1', input: input(1000, 'tap-12345678') })
    const b = await recordPendingCollection(d.client, ORG, { subId: 's1', visitId: 'v1', customerId: 'c1', input: input(1000, 'tap-12345678') })
    expect(a.ok && b.ok && a.id === b.id && b.duplicate).toBe(true)
    expect(d.tables.visit_collections).toHaveLength(1)
  })

  it('nothing owed → nothing to collect', async () => {
    mockUnpaid.mockResolvedValue({ rows: [], capped: false })
    expect(await recordPendingCollection(db().client, ORG, { subId: 's1', visitId: 'v1', customerId: 'c1', input: input(100) })).toMatchObject({ ok: false, status: 409 })
  })

  it('confirm writes real payments oldest first through the invoice writer, once', async () => {
    const d = db()
    const r = await recordPendingCollection(d.client, ORG, { subId: 's1', visitId: 'v1', customerId: 'c1', input: input(5000) })
    const id = (r as { id: string }).id
    expect((await loadPendingCollections(d.client, ORG)).map((p) => [p.customerName, p.crewName, p.amountCents])).toEqual([['Pat', 'Crew One', 5000]])
    expect(await confirmCollection(d.client, ORG, 'office-1', id)).toEqual({ ok: true })
    expect(mockRecord.mock.calls.map((c) => [c[2], c[3].amountCents, c[3].method, c[3].idempotencyKey, c[3].createdBy])).toEqual([
      ['i1', 4000, 'cash', `visit-collection:${id}:i1`, 'office-1'],
      ['i2', 1000, 'cash', `visit-collection:${id}:i2`, 'office-1'],
    ])
    expect(d.tables.visit_collections[0]).toMatchObject({ status: 'confirmed', decided_by: 'office-1' })
    expect(await confirmCollection(d.client, ORG, 'office-1', id)).toMatchObject({ ok: false, status: 409 })
    expect(mockRecord).toHaveBeenCalledTimes(2)
    expect(await loadPendingCollections(d.client, ORG)).toEqual([])
  })

  it('a confirm that stops half way finishes the SAME split on retry (no double counting)', async () => {
    const d = db()
    const id = ((await recordPendingCollection(d.client, ORG, { subId: 's1', visitId: 'v1', customerId: 'c1', input: input(5000) })) as { id: string }).id
    mockRecord.mockResolvedValueOnce({ ok: true, paymentId: 'pay-1', status: 'paid', balanceCents: 0, duplicate: false }).mockResolvedValueOnce({ ok: false, status: 400, error: 'boom' })
    expect(await confirmCollection(d.client, ORG, 'office-1', id)).toMatchObject({ ok: false, status: 409 })
    expect(d.tables.visit_collections[0].status).toBe('pending')
    // Part one is real money: the collection can no longer be thrown away, only finished.
    expect(await rejectCollection(d.client, ORG, 'office-1', id, null)).toMatchObject({ ok: false, status: 409 })
    // i1 is now paid in full: a fresh split would send all 5000 to i2. The stored split must be used instead.
    mockUnpaid.mockResolvedValue({ rows: [row('i2', 'c1', 3000)], capped: false })
    mockRecord.mockClear()
    mockRecord.mockResolvedValue({ ok: true, paymentId: 'pay-2', status: 'paid', balanceCents: 0, duplicate: false })
    expect(await confirmCollection(d.client, ORG, 'office-1', id)).toEqual({ ok: true })
    expect(mockRecord.mock.calls.map((c) => [c[2], c[3].amountCents])).toEqual([['i2', 1000]])
  })

  it('a refused part is dropped so the rest is split again (never stuck between confirm and reject)', async () => {
    const d = db()
    const id = ((await recordPendingCollection(d.client, ORG, { subId: 's1', visitId: 'v1', customerId: 'c1', input: input(5000) })) as { id: string }).id
    // i1 records; i2 is refused (e.g. paid online meanwhile)
    mockRecord.mockResolvedValueOnce({ ok: true, paymentId: 'pay-1', status: 'paid', balanceCents: 0, duplicate: false }).mockResolvedValueOnce({ ok: false, status: 400, error: 'That is more than the balance due' })
    expect(await confirmCollection(d.client, ORG, 'office-1', id)).toMatchObject({ ok: false, status: 409 })
    expect(d.tables.visit_collections[0].payments).toEqual([{ invoice_id: 'i1', cents: 4000, payment_id: 'pay-1', job_id: null }])
    // The office opens a new invoice i4 for the rest: the remaining 1000 goes there, i1 is never paid twice.
    mockUnpaid.mockResolvedValue({ rows: [row('i1', 'c1', 4000), row('i4', 'c1', 2500)], capped: false })
    mockRecord.mockClear()
    mockRecord.mockResolvedValue({ ok: true, paymentId: 'pay-4', status: 'partially_paid', balanceCents: 1500, duplicate: false })
    expect(await confirmCollection(d.client, ORG, 'office-1', id)).toEqual({ ok: true })
    expect(mockRecord.mock.calls.map((c) => [c[2], c[3].amountCents])).toEqual([['i4', 1000]])
  })

  it('two confirms at once: only one split is written', async () => {
    const d = db()
    const id = ((await recordPendingCollection(d.client, ORG, { subId: 's1', visitId: 'v1', customerId: 'c1', input: input(3000) })) as { id: string }).id
    // Someone else stored a split after this confirm read the row: the compare-and-set refuses this one.
    const client = d.client as unknown as { from: (t: string) => unknown }
    const realFrom = client.from.bind(client)
    let raced = false
    client.from = (t: string) => {
      if (t === 'visit_collections' && !raced) {
        const q = realFrom(t) as { update: (p: Record<string, unknown>) => unknown }
        const origUpdate = q.update.bind(q)
        q.update = (p: Record<string, unknown>) => {
          if (Array.isArray(p.payments) && !raced) {
            raced = true
            d.tables.visit_collections[0].payments = [{ invoice_id: 'i2', cents: 3000, payment_id: null }]
          }
          return origUpdate(p)
        }
        return q
      }
      return realFrom(t)
    }
    expect(await confirmCollection(d.client, ORG, 'office-1', id)).toMatchObject({ ok: false, status: 409 })
    expect(mockRecord).not.toHaveBeenCalled()
    expect(d.tables.visit_collections[0].payments).toEqual([{ invoice_id: 'i2', cents: 3000, payment_id: null }])
  })

  it('reject writes nothing; a half-recorded collection cannot be rejected', async () => {
    const d = db()
    const id = ((await recordPendingCollection(d.client, ORG, { subId: 's1', visitId: 'v1', customerId: 'c1', input: input(1000) })) as { id: string }).id
    expect(await rejectCollection(d.client, ORG, 'office-1', id, '  never arrived ')).toEqual({ ok: true })
    expect(mockRecord).not.toHaveBeenCalled()
    expect(d.tables.visit_collections[0]).toMatchObject({ status: 'rejected', reject_reason: 'never arrived' })
    expect(await rejectCollection(d.client, ORG, 'office-1', id, null)).toMatchObject({ ok: false, status: 409 })
    expect(await confirmCollection(d.client, ORG, 'office-1', id)).toMatchObject({ ok: false, status: 409 })

    const half = db()
    half.tables.visit_collections.push({ id: 'h1', org_id: ORG, customer_id: 'c1', amount_cents: 500, method: 'cash', status: 'pending', collected_at: '2026-11-10T15:00:00Z', payments: [{ invoice_id: 'i1', cents: 500, payment_id: 'pay-9' }] })
    expect(await rejectCollection(half.client, ORG, 'office-1', 'h1', null)).toMatchObject({ ok: false, status: 409 })
  })

  it('a confirm that has stored its split (payment possibly in flight) cannot be rejected', async () => {
    const d = db()
    d.tables.visit_collections.push({ id: 'f1', org_id: ORG, customer_id: 'c1', amount_cents: 500, method: 'cash', status: 'pending', collected_at: '2026-11-10T15:00:00Z', payments: [{ invoice_id: 'i1', cents: 500, payment_id: null }] })
    expect(await rejectCollection(d.client, ORG, 'office-1', 'f1', null)).toMatchObject({ ok: false, status: 409 })
    expect(d.tables.visit_collections[0].status).toBe('pending')
  })

  it('another company’s collection is not found', async () => {
    const d = db()
    d.tables.visit_collections.push({ id: 'x1', org_id: 'org-b', customer_id: 'cx', amount_cents: 500, method: 'cash', status: 'pending', collected_at: '2026-11-10T15:00:00Z', payments: [] })
    expect(await confirmCollection(d.client, ORG, 'office-1', 'x1')).toMatchObject({ ok: false, status: 404 })
    expect(await rejectCollection(d.client, ORG, 'office-1', 'x1', null)).toMatchObject({ ok: false, status: 404 })
    expect(await loadPendingCollections(d.client, ORG)).toEqual([])
  })

  it('confirm is refused when the invoices no longer owe that much', async () => {
    const d = db()
    const id = ((await recordPendingCollection(d.client, ORG, { subId: 's1', visitId: 'v1', customerId: 'c1', input: input(7000) })) as { id: string }).id
    mockUnpaid.mockResolvedValue({ rows: [row('i2', 'c1', 3000)], capped: false })
    expect(await confirmCollection(d.client, ORG, 'office-1', id)).toMatchObject({ ok: false, status: 409 })
    expect(mockRecord).not.toHaveBeenCalled()
    expect(d.tables.visit_collections[0].status).toBe('pending')
  })

  describe('job invoices', () => {
    const jobOnly = () => mockUnpaid.mockResolvedValue({ rows: [row('i1', 'c1', 4000), row('ij', 'c1', 9999, 'job-1')], capped: false })
    const make = async (d: ReturnType<typeof db>, cents: number) => ((await recordPendingCollection(d.client, ORG, { subId: 's1', visitId: 'v1', customerId: 'c1', input: input(cents) })) as { id: string }).id

    it('confirm splits oldest first across service and job invoices, each through its own writer', async () => {
      jobOnly()
      const d = db()
      const id = await make(d, 6000)
      expect(await confirmCollection(d.client, ORG, 'office-1', id)).toEqual({ ok: true })
      expect(mockRecord.mock.calls.map((c) => [c[2], c[3].amountCents])).toEqual([['i1', 4000]])
      expect(mockJobRecord).toHaveBeenCalledTimes(1)
      const [, org, inv, p] = mockJobRecord.mock.calls[0]
      expect([org, inv, p.amountCents, p.method, p.createdBy, p.idempotencyKey]).toEqual([ORG, { id: 'ij', job_id: 'job-1', status: 'sent' }, 2000, 'cash', 'office-1', `visit-collection:${id}:ij`])
      expect(d.tables.visit_collections[0]).toMatchObject({ status: 'confirmed' })
      expect(d.tables.visit_collections[0].payments).toEqual([
        { invoice_id: 'i1', cents: 4000, payment_id: 'pay-1', job_id: null },
        { invoice_id: 'ij', cents: 2000, payment_id: 'jpay-1', job_id: 'job-1' },
      ])
    })

    it('pending job money is no payment: nothing is written until confirmed, and a reject writes nothing', async () => {
      jobOnly()
      const d = db()
      const id = await make(d, 6000)
      expect(mockJobRecord).not.toHaveBeenCalled()
      expect(mockRecord).not.toHaveBeenCalled()
      expect(await rejectCollection(d.client, ORG, 'office-1', id, null)).toEqual({ ok: true })
      expect(mockJobRecord).not.toHaveBeenCalled()
    })

    it('a retry finds the job payment already saved under the key and only applies it (never a second payment)', async () => {
      jobOnly()
      const d = db()
      const id = await make(d, 6000)
      // First try: the service part is real, the job payment is saved but its apply fails.
      mockJobRecord.mockResolvedValueOnce({ ok: false, status: 500, error: 'saved on the job but could not be applied' })
      expect(await confirmCollection(d.client, ORG, 'office-1', id)).toMatchObject({ ok: false, status: 500 })
      // The split is kept (a retry must not split again) and the collection can't be thrown away.
      expect((d.tables.visit_collections[0].payments as unknown[]).length).toBe(2)
      expect(await rejectCollection(d.client, ORG, 'office-1', id, null)).toMatchObject({ ok: false, status: 409 })
      d.tables.job_payments.push({ id: 'jp-saved', job_id: 'job-1', idempotency_key: `visit-collection:${id}:ij` })
      mockRecord.mockClear()
      mockJobRecord.mockClear()
      expect(await confirmCollection(d.client, ORG, 'office-1', id)).toEqual({ ok: true })
      expect(mockApply).toHaveBeenCalledWith(expect.anything(), ORG, 'ij', 'jp-saved', 2000, 'office-1')
      expect(mockJobRecord).not.toHaveBeenCalled()
      expect(mockRecord).not.toHaveBeenCalled() // the service part was already real
    })

    it('a saved job payment whose invoice was voided meanwhile still finishes (the money is on the job), never stuck', async () => {
      jobOnly()
      const d = db()
      const id = await make(d, 6000)
      mockJobRecord.mockResolvedValueOnce({ ok: false, status: 500, error: 'saved on the job but could not be applied' })
      expect(await confirmCollection(d.client, ORG, 'office-1', id)).toMatchObject({ ok: false, status: 500 })
      d.tables.job_payments.push({ id: 'jp-saved', job_id: 'job-1', idempotency_key: `visit-collection:${id}:ij` })
      mockFindInvoice.mockImplementation(async () => ({ id: 'ij', job_id: 'job-1', status: 'void' }))
      mockApply.mockRejectedValueOnce(new Error('Cannot apply payment to voided invoice'))
      expect(await confirmCollection(d.client, ORG, 'office-1', id)).toEqual({ ok: true })
      expect((d.tables.visit_collections[0].payments as Array<{ payment_id: string }>)[1].payment_id).toBe('jp-saved')
      expect(mockJobRecord).toHaveBeenCalledTimes(1)
    })

    it('a job invoice that is gone from this company is refused and dropped, not paid', async () => {
      jobOnly()
      mockFindInvoice.mockResolvedValue(null)
      const d = db()
      const id = await make(d, 6000)
      expect(await confirmCollection(d.client, ORG, 'office-1', id)).toMatchObject({ ok: false, status: 409 })
      expect(mockJobRecord).not.toHaveBeenCalled()
      expect(d.tables.visit_collections[0].status).toBe('pending')
    })
  })
})
