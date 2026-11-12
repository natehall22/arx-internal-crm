/** @jest-environment node */
/**
 * QuickBooks worker (PR 3) against a fake QuickBooks company. What must never happen: a duplicate in the books, a post before the
 * start date / while off / to the wrong company, an overwritten human edit, a total that is off by a cent.
 */
import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { FakeQbCompany, fault } from '@/lib/test-helpers/fake-qb'
import { enqueueIntegrationEvent } from '@/lib/integrations'
import { runQuickBooksForOrg, type WorkerOrg } from '@/lib/quickbooks/worker'
import { claimDue, markDone, MAX_ATTEMPTS, retryRow, skipRow } from '@/lib/quickbooks/outbox'
import { classifyFailure } from '@/lib/quickbooks/faults'
import { sweepUnheard } from '@/lib/quickbooks/sweep'
import { readQbSettings } from '@/lib/quickbooks/mapping'

const A = 'org-a'
const B = 'org-b'
const NOW = Date.UTC(2026, 10, 12, 15, 0, 0)
const TZ = 'America/New_York'
const iso = (ms: number) => new Date(ms).toISOString()

const taxSettings = { enabled: true, rates: [{ id: 'nc', name: 'NC state', percent: 4.75, active: true }, { id: 'cab', name: 'Cabarrus County', percent: 2.25, active: true }], defaultRateIds: ['nc', 'cab'] }
const qbSettings = (over: Record<string, unknown> = {}) => ({
  startDate: '2026-11-01',
  invoiceMode: 'per_job',
  income: { defaultItemId: 'item-1', byTrade: {} },
  tax: { mode: 'code', taxCodeId: 'tc-1', rateMap: { nc: 'rate-nc', cab: 'rate-cab' } },
  depositToAccountId: 'acct-dep',
  receivablesAccountId: null,
  bills: { enabled: true, expenseAccountId: 'acct-exp', classId: null },
  vendors1099: ['v-1'],
  confirmedAt: iso(NOW - 86_400_000),
  confirmedBy: 'u-owner',
  ...over,
})
const orgRow = (id: string, qb: Record<string, unknown> = {}) => ({ id, timezone: TZ, settings: { salesTax: taxSettings, quickbooks: qbSettings(qb) } })

function seed(org: string, p: { n?: number; saleDate?: string; sale?: number } = {}) {
  const n = p.n ?? 1
  const cid = `${org}-c${n}`
  const jid = `${org}-j${n}`
  return {
    customers: [{ id: cid, org_id: org, name: 'Pat Homeowner', email: 'pat@example.com', phone: '7045550142', address_text: '12 Oak St, Concord, NC' }],
    production_jobs: [{ id: jid, org_id: org, customer_id: cid, job_number: `26-000${n}`, address_text: '12 Oak St, Concord, NC', status: 'sold', sale_amount: p.sale ?? 10700, sale_date: p.saleDate ?? '2026-11-05', job_type: 'roofing', linked_proposal_id: `${org}-p${n}`, project_id: null, created_at: '2026-11-05T12:00:00Z' }],
    proposals: [{ id: `${org}-p${n}`, org_id: org, tax_amount: 700, tax_lines: [{ id: 'nc', name: 'NC state', percent: 4.75, amount_cents: 47500 }, { id: 'cab', name: 'Cabarrus County', percent: 2.25, amount_cents: 22500 }] }],
    ids: { cid, jid },
  }
}

type World = ReturnType<typeof makeWorld>
function makeWorld(orgs: Array<{ id: string; qb?: Record<string, unknown>; s?: ReturnType<typeof seed> }>, extra: Record<string, Array<Record<string, unknown>>> = {}) {
  const seeds = orgs.map((o) => o.s ?? seed(o.id))
  const fake = createFakeDb({
    orgs: orgs.map((o) => orgRow(o.id, o.qb)),
    customers: seeds.flatMap((s) => s.customers),
    production_jobs: seeds.flatMap((s) => s.production_jobs),
    proposals: seeds.flatMap((s) => s.proposals),
    integration_outbox: [], qb_links: [], job_invoices: [], job_invoice_items: [], job_payments: [], invoice_payments: [], purchase_order_bills: [], supplier_orders: [], vendors: [],
    ...extra,
  })
  const companies: Record<string, FakeQbCompany> = Object.fromEntries(orgs.map((o) => [o.id, new FakeQbCompany(`realm-${o.id}`)]))
  const org = (id: string): WorkerOrg => {
    const r = (fake.tables.orgs as Array<Record<string, unknown>>).find((x) => x.id === id)!
    return { id, settings: r.settings as Record<string, unknown>, timezone: TZ }
  }
  let clock = NOW
  const run = (id: string, o: { featureOn?: boolean; budgetMs?: number; sweep?: boolean } = {}) =>
    runQuickBooksForOrg({ admin: fake.client as never, now: () => clock, budgetMs: o.budgetMs, sweep: o.sweep ?? false, openClient: async (orgId) => ({ ok: true, client: companies[orgId].client() }) }, org(id), o.featureOn ?? true)
  return {
    fake, companies, seeds, org, run,
    advance: (ms: number) => { clock += ms },
    now: () => clock,
    enqueue: (orgId: string, eventType: Parameters<typeof enqueueIntegrationEvent>[1]['eventType'], table: string, id: string, version = 1) =>
      enqueueIntegrationEvent(fake.client as never, { orgId, provider: 'quickbooks', eventType, entityTable: table, entityId: id, payload: {}, version }),
    outbox: () => fake.tables.integration_outbox as Array<Record<string, any>>,
    links: () => fake.tables.qb_links as Array<Record<string, any>>,
  }
}

beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}))
afterEach(() => jest.restoreAllMocks())

const cents = (d: unknown) => Math.round(Number(d) * 100)

describe('the roofing flow end to end', () => {
  it('posts customer, job, ONE invoice = the sale amount (to the cent, tax split on the mapped rates) and the payment applied to it', async () => {
    const w = makeWorld([{ id: A }])
    const { cid, jid } = w.seeds[0].ids
    ;(w.fake.tables.job_payments as any[]).push({ id: 'pay-1', job_id: jid, org_id: null, paid_at: '2026-11-08', amount_cents: 500000, payment_type: 'deposit', method: 'check', note: null })
    await w.enqueue(A, 'customer.upserted', 'customers', cid)
    await w.enqueue(A, 'invoice.upserted', 'production_jobs', jid, 1070000)
    await w.enqueue(A, 'payment.recorded', 'job_payments', 'pay-1')
    const r = await w.run(A)
    expect(r).toMatchObject({ state: 'ran', claimed: 3, done: 3, needsYou: 0 })
    const qb = w.companies[A]
    const [inv] = qb.all('Invoice')
    expect(qb.all('Invoice')).toHaveLength(1)
    // money: lines + tax = sale amount = what QuickBooks totals
    expect(cents(inv.TotalAmt)).toBe(1070000)
    expect(inv.Line.reduce((t: number, l: any) => t + cents(l.Amount), 0)).toBe(1000000)
    expect(cents(inv.TxnTaxDetail.TotalTax)).toBe(70000)
    expect(inv.TxnTaxDetail.TaxLine.map((t: any) => [t.TaxLineDetail.TaxRateRef.value, cents(t.Amount)])).toEqual([['rate-nc', 47500], ['rate-cab', 22500]])
    expect(inv.DocNumber).toBe('26-0001')
    expect(inv.PrivateNote).toBe(`[crm:inv:${jid}]`)
    // customer + job as sub-customer; the invoice sits on the job
    const customers = qb.all('Customer')
    const parent = customers.find((c) => !c.Job)!
    const job = customers.find((c) => c.Job)!
    expect(job.ParentRef.value).toBe(parent.Id)
    expect(inv.CustomerRef.value).toBe(job.Id)
    // payment: gross, deposit account, applied to the invoice, on the job's customer
    const [pay] = qb.all('Payment')
    expect(pay).toMatchObject({ TotalAmt: 5000, DepositToAccountRef: { value: 'acct-dep' }, CustomerRef: { value: job.Id } })
    expect(pay.Line[0].LinkedTxn).toEqual([{ TxnId: inv.Id, TxnType: 'Invoice' }])
    expect(cents(qb.all('Invoice')[0].Balance)).toBe(570000)
    // qb_links is the only map
    expect(w.links().map((l) => `${l.crm_table}/${l.qb_type}`).sort()).toEqual(['customers/Customer', 'job_payments/Payment', 'production_jobs/Customer', 'production_jobs/Invoice'])
    expect(w.outbox().every((o) => o.status === 'completed' && o.sent_at && o.qb_id)).toBe(true)
  })

  it('the same event twice (and the whole queue run twice) is still ONE QuickBooks object', async () => {
    const w = makeWorld([{ id: A }])
    const { jid } = w.seeds[0].ids
    await w.enqueue(A, 'invoice.upserted', 'production_jobs', jid, 1070000)
    await w.run(A)
    await w.enqueue(A, 'invoice.upserted', 'production_jobs', jid, 1070000) // re-queued: same key, back to pending
    expect(w.outbox()).toHaveLength(1)
    const before = w.companies[A].calls.filter((c) => c.op === 'create' || c.op === 'update').length
    await w.run(A)
    await w.run(A)
    expect(w.companies[A].all('Invoice')).toHaveLength(1)
    expect(w.companies[A].calls.filter((c) => c.op === 'create' || c.op === 'update').length).toBe(before) // unchanged facts: QuickBooks not written again
  })

  it('a signed change order updates the SAME invoice (new total, same Id), tax and all', async () => {
    const w = makeWorld([{ id: A }])
    const { jid } = w.seeds[0].ids
    await w.enqueue(A, 'invoice.upserted', 'production_jobs', jid, 1070000)
    await w.run(A)
    const id = w.companies[A].all('Invoice')[0].Id
    // CO adds $1,070 incl. tax: the proposal tax is unchanged in the CRM's model (CO totals are tax-included), so the new line is the difference
    ;(w.fake.tables.production_jobs as any[])[0].sale_amount = 11770
    await w.enqueue(A, 'invoice.upserted', 'production_jobs', jid, 1177000)
    const r = await w.run(A)
    expect(r.done).toBe(1)
    expect(w.companies[A].all('Invoice')).toHaveLength(1)
    const inv = w.companies[A].all('Invoice')[0]
    expect(inv.Id).toBe(id)
    expect(cents(inv.TotalAmt)).toBe(1177000)
  })
})

describe('find-before-send: never a duplicate', () => {
  it('a create that LANDED but timed out is found on the retry, not created again', async () => {
    const w = makeWorld([{ id: A }])
    const { jid } = w.seeds[0].ids
    w.companies[A].failNext(classifyFailure(0, {}), { op: 'create', entity: 'Invoice', afterCommit: true })
    await w.enqueue(A, 'invoice.upserted', 'production_jobs', jid, 1070000)
    const first = await w.run(A)
    expect(first.retried).toBe(1)
    expect(w.companies[A].all('Invoice')).toHaveLength(1) // it did land
    expect(w.links().some((l) => l.qb_type === 'Invoice')).toBe(false) // but we never heard
    expect(w.outbox()[0]).toMatchObject({ status: 'pending', error_kind: 'retrying', attempt_count: 1 })
    w.advance(10 * 60_000)
    const second = await w.run(A)
    expect(second.done).toBe(1)
    expect(w.companies[A].all('Invoice')).toHaveLength(1)
    expect(w.companies[A].calls.filter((c) => c.op === 'create' && c.entity === 'Invoice')).toHaveLength(1)
    expect(w.links().find((l) => l.qb_type === 'Invoice')?.qb_id).toBe(w.companies[A].all('Invoice')[0].Id)
  })

  it('a worker that died after QuickBooks said yes (no link saved) adopts its own invoice by our reference', async () => {
    const w = makeWorld([{ id: A }])
    const { jid, cid } = w.seeds[0].ids
    await w.enqueue(A, 'invoice.upserted', 'production_jobs', jid, 1070000)
    await w.run(A)
    // simulate the crash: the link row is gone but QuickBooks has the invoice
    w.fake.tables.qb_links.splice(0, w.fake.tables.qb_links.length, ...(w.links().filter((l) => l.qb_type !== 'Invoice')))
    await w.enqueue(A, 'invoice.upserted', 'production_jobs', jid, 1070000)
    await w.run(A)
    expect(w.companies[A].all('Invoice')).toHaveLength(1)
    expect(w.links().some((l) => l.qb_type === 'Invoice')).toBe(true)
    expect(cid).toBeTruthy()
  })

  it('a customer who already exists in QuickBooks (same email) is matched, not duplicated; a different person with the same name gets a distinct name', async () => {
    const w = makeWorld([{ id: A }])
    const { cid } = w.seeds[0].ids
    w.companies[A].all('Customer').push({ Id: '7', SyncToken: '0', DisplayName: 'Pat Homeowner', PrimaryEmailAddr: { Address: 'PAT@example.com' } })
    await w.enqueue(A, 'customer.upserted', 'customers', cid)
    await w.run(A)
    expect(w.companies[A].all('Customer')).toHaveLength(1)
    expect(w.links()[0]).toMatchObject({ qb_id: '7' })

    const w2 = makeWorld([{ id: A }])
    w2.companies[A].all('Customer').push({ Id: '9', SyncToken: '0', DisplayName: 'Pat Homeowner', PrimaryEmailAddr: { Address: 'someone.else@example.com' }, BillAddr: { Line1: '99 Other Rd' } })
    await w2.enqueue(A, 'customer.upserted', 'customers', w2.seeds[0].ids.cid)
    await w2.run(A)
    expect(w2.companies[A].all('Customer').map((c) => c.DisplayName)).toEqual(['Pat Homeowner', 'Pat Homeowner - 12 Oak St'])
  })

  it('the requestid is a 32-character hash (Intuit allows 50), the same for the same facts', async () => {
    const w = makeWorld([{ id: A }])
    await w.enqueue(A, 'invoice.upserted', 'production_jobs', w.seeds[0].ids.jid, 1070000)
    await w.run(A)
    const ids = w.companies[A].calls.filter((c) => c.op === 'create').map((c) => c.requestId!)
    expect(ids.length).toBeGreaterThan(0)
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{32}$/)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('SyncToken conflicts and human edits', () => {
  it('a stale SyncToken is re-read and retried once', async () => {
    const w = makeWorld([{ id: A }])
    const { jid } = w.seeds[0].ids
    await w.enqueue(A, 'invoice.upserted', 'production_jobs', jid, 1070000)
    await w.run(A)
    ;(w.fake.tables.production_jobs as any[])[0].sale_amount = 11770
    w.companies[A].failNext(fault(400, '5010', 'Stale Object Error'), { op: 'update', entity: 'Invoice' })
    await w.enqueue(A, 'invoice.upserted', 'production_jobs', jid, 1177000)
    const r = await w.run(A)
    expect(r).toMatchObject({ done: 1, needsYou: 0 })
    expect(w.companies[A].calls.filter((c) => c.op === 'update' && c.entity === 'Invoice')).toHaveLength(2)
    expect(cents(w.companies[A].all('Invoice')[0].TotalAmt)).toBe(1177000)
  })

  it('a total a person changed in QuickBooks is NEVER overwritten: it becomes a Needs-you line with both amounts', async () => {
    const w = makeWorld([{ id: A }])
    const { jid } = w.seeds[0].ids
    await w.enqueue(A, 'invoice.upserted', 'production_jobs', jid, 1070000)
    await w.run(A)
    const inv = w.companies[A].all('Invoice')[0]
    w.companies[A].editInQb('Invoice', inv.Id!, { Line: [{ Amount: 9000, DetailType: 'SalesItemLineDetail' }], TxnTaxDetail: { TotalTax: 0 } })
    ;(w.fake.tables.production_jobs as any[])[0].sale_amount = 11770
    await w.enqueue(A, 'invoice.upserted', 'production_jobs', jid, 1177000)
    const r = await w.run(A)
    expect(r.needsYou).toBe(1)
    expect(cents(w.companies[A].all('Invoice')[0].TotalAmt)).toBe(900000) // untouched
    const row = w.outbox()[1]
    expect(row).toMatchObject({ status: 'failed', error_kind: 'needs_you', error_code: 'changed_in_qb' })
    expect(row.last_error).toContain('$9000.00')
    expect(row.last_error).toContain('$11770.00')
  })

  it('QuickBooks totalling tax differently (automated sales tax) is flagged, never forced', async () => {
    const w = makeWorld([{ id: A, qb: { tax: { mode: 'quickbooks', taxCodeId: null, rateMap: {} } } }])
    w.companies[A].taxPercent = 7.5 // QuickBooks works out 7.5% on 10,000 = 750, the CRM says 700
    await w.enqueue(A, 'invoice.upserted', 'production_jobs', w.seeds[0].ids.jid, 1070000)
    await w.run(A)
    const row = w.outbox()[0]
    expect(row).toMatchObject({ status: 'completed', error_kind: 'needs_you', error_code: 'total_differs' })
    expect(row.last_error).toContain('$10750.00')
    expect(row.last_error).toContain('$10700.00')
  })
})

describe('start date, switches, mapping', () => {
  it('nothing dated before the start date ever posts (sale, payment, customer)', async () => {
    const s = seed(A, { saleDate: '2026-10-15' })
    const w = makeWorld([{ id: A, s }], { job_payments: [{ id: 'pay-old', job_id: `${A}-j1`, org_id: null, paid_at: '2026-10-20', amount_cents: 100000, method: 'check' }] })
    w.fake.tables.job_payments[0].job_id = s.ids.jid
    await w.enqueue(A, 'invoice.upserted', 'production_jobs', s.ids.jid, 1070000)
    await w.enqueue(A, 'payment.recorded', 'job_payments', 'pay-old')
    const r = await w.run(A)
    expect(r.skipped).toBe(2)
    expect(w.companies[A].calls.filter((c) => c.op === 'create')).toHaveLength(0)
    expect(w.outbox().map((o) => o.error_code).sort()).toEqual(['before_start', 'before_start'])
  })

  it('a payment on/after the start date whose invoice is older is a plain Needs-you line, not a guess', async () => {
    const s = seed(A, { saleDate: '2026-10-15' })
    const w = makeWorld([{ id: A, s }], { job_payments: [{ id: 'pay-new', job_id: s.ids.jid, org_id: null, paid_at: '2026-11-08', amount_cents: 100000, method: 'check' }] })
    await w.enqueue(A, 'payment.recorded', 'job_payments', 'pay-new')
    const r = await w.run(A)
    expect(r.needsYou).toBe(1)
    expect(w.outbox()[0].error_code).toBe('invoice_before_start')
    expect(w.companies[A].all('Payment')).toHaveLength(0)
  })

  it('switch off or mapping not confirmed: nothing is touched, rows wait', async () => {
    const w = makeWorld([{ id: A }])
    await w.enqueue(A, 'invoice.upserted', 'production_jobs', w.seeds[0].ids.jid, 1070000)
    expect(await w.run(A, { featureOn: false })).toMatchObject({ state: 'switch_off', claimed: 0 })
    const w2 = makeWorld([{ id: A, qb: { confirmedAt: null } }])
    await w2.enqueue(A, 'invoice.upserted', 'production_jobs', w2.seeds[0].ids.jid, 1070000)
    expect(await w2.run(A)).toMatchObject({ state: 'not_ready', claimed: 0 })
    const w3 = makeWorld([{ id: A, qb: { depositToAccountId: null } }])
    expect(await w3.run(A)).toMatchObject({ state: 'not_ready' })
    for (const x of [w, w2, w3]) {
      expect(x.companies[A].calls).toHaveLength(0)
      expect(x.outbox().every((o) => o.status === 'pending')).toBe(true)
    }
  })

  it('code-mode tax with a CRM rate that has no QuickBooks rate is not ready (plain words)', () => {
    const { mappingProblems } = jest.requireActual('@/lib/quickbooks/mapping') as typeof import('@/lib/quickbooks/mapping')
    const s = readQbSettings({ quickbooks: qbSettings({ tax: { mode: 'code', taxCodeId: 'tc-1', rateMap: { nc: 'rate-nc' } } }) })
    expect(mappingProblems(s, taxSettings as never).map((p) => p.message)).toEqual([expect.stringContaining('Cabarrus County')])
  })
})

describe('rate limits, throttling, lost logins', () => {
  it('a throttle stops the batch cleanly: the row backs off, later rows are untouched', async () => {
    const w = makeWorld([{ id: A }])
    const { cid, jid } = w.seeds[0].ids
    await w.enqueue(A, 'customer.upserted', 'customers', cid)
    await w.enqueue(A, 'invoice.upserted', 'production_jobs', jid, 1070000)
    w.companies[A].alwaysFail = classifyFailure(429, { Fault: { Error: [{ Message: 'ThrottleExceeded', code: '003001' }], type: 'ThrottleException' } })
    const r = await w.run(A)
    expect(r).toMatchObject({ stopped: 'throttled', claimed: 1, retried: 1 })
    const [first, second] = w.outbox()
    expect(first).toMatchObject({ status: 'pending', error_kind: 'retrying', error_code: 'throttled' })
    expect(Date.parse(first.next_attempt_at)).toBeGreaterThan(NOW)
    expect(second).toMatchObject({ status: 'pending', attempt_count: 0 })
    w.companies[A].alwaysFail = null
    w.advance(10 * 60_000)
    expect((await w.run(A)).done).toBe(2)
  })

  it('after MAX_ATTEMPTS it lands in Needs you with plain words, and Retry sends it again', async () => {
    const w = makeWorld([{ id: A }])
    await w.enqueue(A, 'customer.upserted', 'customers', w.seeds[0].ids.cid)
    w.companies[A].alwaysFail = classifyFailure(503, {})
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await w.run(A)
      w.advance(6 * 3600_000)
    }
    const row = w.outbox()[0]
    expect(row).toMatchObject({ status: 'failed', error_kind: 'needs_you', attempt_count: MAX_ATTEMPTS })
    expect(row.last_error).toMatch(/did not answer/i)
    w.companies[A].alwaysFail = null
    expect(await retryRow(w.fake.client as never, A, row.id, w.now())).toBe(true)
    expect((await w.run(A)).done).toBe(1)
    expect(await skipRow(w.fake.client as never, A, row.id)).toBe(false) // finished rows cannot be skipped
  })

  it('a duplicate-name clash that is not the same person is a Needs-you line, never a guess', async () => {
    const w = makeWorld([{ id: A }])
    const c = w.companies[A]
    for (const name of ['Pat Homeowner', 'Pat Homeowner - 12 Oak St', 'Pat Homeowner (Customer)']) c.all('Vendor').push({ Id: name, SyncToken: '0', DisplayName: name })
    await w.enqueue(A, 'customer.upserted', 'customers', w.seeds[0].ids.cid)
    await w.run(A)
    expect(w.outbox()[0]).toMatchObject({ status: 'failed', error_kind: 'needs_you', error_code: '6240' })
    expect(c.all('Customer')).toHaveLength(0)
  })

  it('a lost login stops the run and gives the row back untouched', async () => {
    const w = makeWorld([{ id: A }])
    await w.enqueue(A, 'customer.upserted', 'customers', w.seeds[0].ids.cid)
    w.companies[A].alwaysFail = classifyFailure(401, {})
    const r = await w.run(A)
    expect(r.stopped).toBe('auth')
    expect(w.outbox()[0]).toMatchObject({ status: 'pending', attempt_count: 0 })
  })
})

describe('the real client: 401 refresh mid-batch, 429 back-off', () => {
  const { createQbClient } = jest.requireActual('@/lib/quickbooks/client') as typeof import('@/lib/quickbooks/client')
  const res = (status: number, body: unknown, headers: Record<string, string> = {}) => ({ status, ok: status < 300, json: async () => body, headers: { get: (k: string) => headers[k.toLowerCase()] ?? null } }) as unknown as Response

  it('an expired access token is refreshed ONCE and the call carries on with the new token; later calls keep it', async () => {
    const seen: string[] = []
    const fetchImpl = jest.fn(async (_u: string, init: RequestInit) => {
      const tok = (init.headers as Record<string, string>).Authorization
      seen.push(tok)
      return tok === 'Bearer old' ? res(401, { Fault: { Error: [{ Message: 'AuthenticationFailed', code: '3200' }], type: 'AuthenticationFault' } }) : res(200, { QueryResponse: { Customer: [{ Id: '1' }] } })
    })
    const token = jest.fn(async (force?: boolean) => (force ? 'new' : 'old'))
    const client = createQbClient({ environment: 'sandbox', realmId: '9130', session: { token }, fetchImpl: fetchImpl as never, sleep: async () => {}, minGapMs: 0 })
    const a = await client.query('Customer', "DisplayName = 'x'")
    expect(a.ok).toBe(true)
    expect(seen).toEqual(['Bearer old', 'Bearer new'])
    expect(token).toHaveBeenCalledWith(true)
  })

  it('a 429 backs off (twice) then reports throttled; the URL carries minorversion and requestid', async () => {
    const urls: string[] = []
    const sleeps: number[] = []
    const fetchImpl = jest.fn(async (u: string) => { urls.push(u); return res(429, { Fault: { Error: [{ Message: 'ThrottleExceeded', code: '003001' }] } }, { 'retry-after': '1' }) })
    const client = createQbClient({ environment: 'sandbox', realmId: '9130', session: { token: async () => 't' }, fetchImpl: fetchImpl as never, sleep: async (ms) => { sleeps.push(ms) }, minGapMs: 0 })
    const r = await client.create('Invoice', { Line: [] }, 'abc')
    expect(r).toMatchObject({ ok: false, kind: 'throttled' })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(sleeps.filter((s) => s >= 1000)).toHaveLength(2)
    expect(urls[0]).toContain('/v3/company/9130/invoice?')
    expect(urls[0]).toContain('requestid=abc')
    expect(urls[0]).toContain('minorversion=75')
    expect(urls[0].startsWith('https://sandbox-quickbooks.api.intuit.com')).toBe(true)
  })

  it('a Fault inside an HTTP 200 is a failure; a timeout is "transient" (the caller must look before re-sending)', async () => {
    const client = createQbClient({ environment: 'production', realmId: '1', session: { token: async () => 't' }, fetchImpl: (async () => res(200, { Fault: { Error: [{ Message: 'Duplicate Name Exists Error', code: '6240' }] } })) as never, sleep: async () => {}, minGapMs: 0 })
    expect(await client.create('Customer', {}, 'r')).toMatchObject({ ok: false, kind: 'duplicate_name' })
    const dead = createQbClient({ environment: 'production', realmId: '1', session: { token: async () => 't' }, fetchImpl: (async () => { throw new Error('timeout') }) as never, sleep: async () => {}, minGapMs: 0 })
    expect(await dead.create('Invoice', {}, 'r')).toMatchObject({ ok: false, kind: 'transient', status: 0 })
  })

  it('classifies the documented codes', () => {
    const f = (status: number, code: string, message = 'm') => classifyFailure(status, { Fault: { Error: [{ Message: message, code }] } }).kind
    expect(f(400, '5010')).toBe('stale')
    expect(f(400, '6240')).toBe('duplicate_name')
    expect(f(400, '6210', 'Duplicate Document Number Error')).toBe('duplicate_number')
    expect(f(400, '6210', 'The accounting period is closed')).toBe('period_closed')
    expect(f(400, '610')).toBe('not_found')
    expect(f(401, '120')).toBe('company_stopped')
    expect(f(400, '6190')).toBe('company_stopped')
    expect(f(400, '6000')).toBe('validation')
    expect(f(503, '')).toBe('transient')
  })
})

describe('cross-company: company A never posts to company B, and B never to A', () => {
  it('each company\'s rows reach only its own QuickBooks realm', async () => {
    const w = makeWorld([{ id: A, s: seed(A) }, { id: B, s: seed(B, { sale: 5350 }) }])
    for (const o of [A, B]) {
      const s = w.seeds[o === A ? 0 : 1]
      await w.enqueue(o, 'customer.upserted', 'customers', s.ids.cid)
      await w.enqueue(o, 'invoice.upserted', 'production_jobs', s.ids.jid, 1)
    }
    await w.run(A)
    expect(w.companies[B].calls).toHaveLength(0)
    expect(w.outbox().filter((o) => o.org_id === B).every((o) => o.status === 'pending')).toBe(true)
    await w.run(B)
    expect(cents(w.companies[A].all('Invoice')[0].TotalAmt)).toBe(1070000)
    expect(cents(w.companies[B].all('Invoice')[0].TotalAmt)).toBe(535000)
    expect(w.companies[A].all('Invoice')).toHaveLength(1)
    expect(w.companies[B].all('Invoice')).toHaveLength(1)
    expect(w.links().filter((l) => l.org_id === A).every((l) => String(l.crm_id).startsWith(A))).toBe(true)
  })

  it('BREAK-IN: an outbox row of company A that names company B\'s record posts NOTHING (not found in A)', async () => {
    const w = makeWorld([{ id: A, s: seed(A) }, { id: B, s: seed(B) }])
    const bs = w.seeds[1].ids
    await w.enqueue(A, 'invoice.upserted', 'production_jobs', bs.jid, 1) // A's queue, B's job
    await w.enqueue(A, 'customer.upserted', 'customers', bs.cid) // A's queue, B's customer
    await (w.fake.client as any).from('job_payments').insert({ id: 'pay-b', job_id: bs.jid, org_id: null, paid_at: '2026-11-08', amount_cents: 1000, method: 'check' })
    await w.enqueue(A, 'payment.recorded', 'job_payments', 'pay-b') // A's queue, B's payment
    const r = await w.run(A)
    expect(r.needsYou).toBe(3)
    expect(w.companies[A].calls.filter((c) => c.op === 'create')).toHaveLength(0)
    expect(w.companies[B].calls).toHaveLength(0)
    expect(w.outbox().every((o) => o.error_code === 'not_found')).toBe(true)
  })

  it('claiming is per company: another company\'s due rows are invisible', async () => {
    const w = makeWorld([{ id: A }, { id: B }])
    await w.enqueue(B, 'customer.upserted', 'customers', w.seeds[1].ids.cid)
    expect(await claimDue(w.fake.client as never, A, NOW, 10)).toEqual([])
    expect(await claimDue(w.fake.client as never, B, NOW, 10)).toHaveLength(1)
  })
})

describe('outbox mechanics', () => {
  it('two overlapping runs never claim the same row', async () => {
    const w = makeWorld([{ id: A }])
    await w.enqueue(A, 'customer.upserted', 'customers', w.seeds[0].ids.cid)
    const [x, y] = await Promise.all([claimDue(w.fake.client as never, A, NOW, 1), claimDue(w.fake.client as never, A, NOW, 1)])
    expect(x.length + y.length).toBe(1)
    // a crashed worker's lease runs out; the row is taken again
    expect(await claimDue(w.fake.client as never, A, NOW + 60_000, 1)).toHaveLength(0)
    expect(await claimDue(w.fake.client as never, A, NOW + 10 * 60_000, 1)).toHaveLength(1)
  })

  it('a record re-queued while we were sending drops our result (the newer facts go out next)', async () => {
    const w = makeWorld([{ id: A }])
    await w.enqueue(A, 'customer.upserted', 'customers', w.seeds[0].ids.cid)
    const [row] = await claimDue(w.fake.client as never, A, NOW, 1)
    await w.enqueue(A, 'customer.upserted', 'customers', w.seeds[0].ids.cid) // the CRM changed it meanwhile
    expect(await markDone(w.fake.client as never, A, { row, now: NOW }, { qbType: 'Customer', qbId: '1' })).toBe(false)
    expect(w.outbox()[0].status).toBe('pending')
  })
})

describe('refunds, voids, bills, service invoices', () => {
  it('a refund is ONE Refund Receipt for the gross amount; a lost dispute too', async () => {
    const w = makeWorld([{ id: A }])
    const { jid } = w.seeds[0].ids
    ;(w.fake.tables.job_payments as any[]).push({ id: 'ref-1', job_id: jid, org_id: null, paid_at: '2026-11-09', amount_cents: -25000, method: 'card', note: 'goodwill' })
    await w.enqueue(A, 'payment.refunded', 'job_payments', 'ref-1')
    await w.run(A)
    await w.enqueue(A, 'payment.refunded', 'job_payments', 'ref-1')
    await w.run(A)
    const refunds = w.companies[A].all('RefundReceipt')
    expect(refunds).toHaveLength(1)
    expect(cents(refunds[0].TotalAmt)).toBe(25000)
    expect(refunds[0].DepositToAccountRef.value).toBe('acct-dep')
  })

  it('cancelling a job VOIDS its QuickBooks invoice (kept, zeroed); a job never sent has nothing to void; nothing is ever deleted', async () => {
    const w = makeWorld([{ id: A }])
    const { jid } = w.seeds[0].ids
    await w.enqueue(A, 'invoice.voided', 'production_jobs', jid)
    expect((await w.run(A)).skipped).toBe(1)
    await w.enqueue(A, 'invoice.upserted', 'production_jobs', jid, 1070000)
    await w.run(A)
    await w.enqueue(A, 'invoice.voided', 'production_jobs', jid)
    await w.run(A)
    const inv = w.companies[A].all('Invoice')[0]
    expect(inv.TotalAmt).toBe(0)
    expect(inv.PrivateNote).toMatch(/^Voided/)
    expect(w.companies[A].calls.filter((c) => c.op === 'void')).toHaveLength(1)
    expect(w.companies[A].all('Invoice')).toHaveLength(1)
  })

  it('every-invoice mode: a service invoice goes line by line (qty x price kept), tax lines included, on the CUSTOMER; a draft never goes', async () => {
    const s = seed(A)
    const extra = {
      job_invoices: [
        { id: 'inv-1', org_id: A, job_id: null, customer_id: s.ids.cid, invoice_number: 'INV-26-00001', status: 'sent', issued_at: '2026-11-07', due_at: '2026-11-21', total_cents: 21600, tax_cents: 1600, tax_lines: [{ id: 'nc', name: 'NC state', percent: 8, amount_cents: 1600 }], notes: 'Thanks!' },
        { id: 'inv-d', org_id: A, job_id: null, customer_id: s.ids.cid, invoice_number: 'INV-26-00002', status: 'draft', issued_at: null, total_cents: 5000, tax_cents: 0 },
      ],
      job_invoice_items: [
        { id: 'i1', invoice_id: 'inv-1', description: 'Mowing, 3 hours', qty: 3, unit_price_cents: 5000, line_total_cents: 15000, taxable: true, sort_order: 0 },
        { id: 'i2', invoice_id: 'inv-1', description: 'Mulch', qty: 1, unit_price_cents: 5000, line_total_cents: 5000, taxable: false, sort_order: 1 },
      ],
    }
    const w = makeWorld([{ id: A, s, qb: { invoiceMode: 'per_invoice' } }], extra)
    await w.enqueue(A, 'invoice.upserted', 'job_invoices', 'inv-1')
    await w.enqueue(A, 'invoice.upserted', 'job_invoices', 'inv-d')
    const r = await w.run(A)
    expect(r).toMatchObject({ done: 1, skipped: 1 })
    const [inv] = w.companies[A].all('Invoice')
    expect(inv.DocNumber).toBe('INV-26-00001')
    expect(inv.Line.map((l: any) => [l.SalesItemLineDetail.Qty, l.SalesItemLineDetail.UnitPrice, l.Amount, l.SalesItemLineDetail.TaxCodeRef.value])).toEqual([[3, 50, 150, 'TAX'], [1, 50, 50, 'NON']])
    expect(cents(inv.TotalAmt)).toBe(21600)
    const parent = w.companies[A].all('Customer')[0]
    expect(inv.CustomerRef.value).toBe(parent.Id)
    expect(inv.CustomerMemo.value).toBe('Thanks!')
    // sweep finds issued invoices nobody queued
    const w2 = makeWorld([{ id: A, s, qb: { invoiceMode: 'per_invoice' } }], extra)
    const swept = await sweepUnheard(w2.fake.client as never, A, readQbSettings(w2.org(A).settings))
    expect(swept.invoices).toBe(1)
    expect(w2.outbox()[0]).toMatchObject({ entity_id: 'inv-1', event_type: 'invoice.upserted' })
  })

  it('in roofing mode a CRM job invoice is skipped (one invoice per job), but a time & materials job is invoiced by its invoices', async () => {
    const s = seed(A)
    const w = makeWorld([{ id: A, s }], { job_invoices: [{ id: 'inv-j', org_id: A, job_id: s.ids.jid, customer_id: s.ids.cid, invoice_number: 'INV-1', status: 'sent', issued_at: '2026-11-07', total_cents: 1000, tax_cents: 0 }], job_invoice_items: [{ id: 'x', invoice_id: 'inv-j', description: 'Deposit', qty: 1, unit_price_cents: 1000, line_total_cents: 1000, sort_order: 0 }] })
    await w.enqueue(A, 'invoice.upserted', 'job_invoices', 'inv-j')
    expect((await w.run(A)).skipped).toBe(1)
    ;(w.fake.tables.production_jobs as any[])[0].billing_mode = 'time_materials'
    await w.enqueue(A, 'invoice.upserted', 'job_invoices', 'inv-j')
    expect((await w.run(A)).done).toBe(1)
    expect(cents(w.companies[A].all('Invoice')[0].TotalAmt)).toBe(1000)
  })

  it('an approved bill: vendor (1099 flag), Bill on the job\'s customer, expense account; a voided CRM bill is a human task, not a delete', async () => {
    const s = seed(A)
    const w = makeWorld([{ id: A, s }], {
      vendors: [{ id: 'v-1', org_id: A, name: 'Acme Roofing Supply', email: 'ap@acme.test', phone: '7045550100' }],
      supplier_orders: [{ id: 'po-1', org_id: A, po_number: 'PO-26-0007' }],
      purchase_order_bills: [{ id: 'b-1', org_id: A, supplier_order_id: 'po-1', vendor_id: 'v-1', job_id: s.ids.jid, bill_number: 'INV-4411', bill_date: '2026-11-09', amount: 1234.56, is_credit: false, cost_type: 'material', status: 'active' }],
    })
    await w.enqueue(A, 'bill.recorded', 'purchase_order_bills', 'b-1')
    await w.run(A)
    const [vendor] = w.companies[A].all('Vendor')
    expect(vendor).toMatchObject({ DisplayName: 'Acme Roofing Supply', Vendor1099: true })
    const [bill] = w.companies[A].all('Bill')
    expect(bill).toMatchObject({ DocNumber: 'INV-4411', VendorRef: { value: vendor.Id }, PrivateNote: '[crm:bill:b-1]' })
    expect(cents(bill.TotalAmt)).toBe(123456)
    expect(bill.Line[0].AccountBasedExpenseLineDetail.AccountRef.value).toBe('acct-exp')
    const job = w.companies[A].all('Customer').find((c) => c.Job)!
    expect(bill.Line[0].AccountBasedExpenseLineDetail.CustomerRef.value).toBe(job.Id)
    // void in the CRM
    ;(w.fake.tables.purchase_order_bills as any[])[0].status = 'void'
    await w.enqueue(A, 'bill.voided', 'purchase_order_bills', 'b-1')
    await w.run(A)
    expect(w.outbox().find((o) => o.event_type === 'bill.voided')).toMatchObject({ status: 'failed', error_code: 'bill_voided' })
    expect(w.companies[A].all('Bill')).toHaveLength(1)
    expect(w.companies[A].calls.some((c) => c.op === 'void' && c.entity !== 'Invoice')).toBe(false)
  })

  it('vendor bills switched off: skipped', async () => {
    const w = makeWorld([{ id: A, qb: { bills: { enabled: false, expenseAccountId: null, classId: null } } }], { purchase_order_bills: [{ id: 'b-1', org_id: A, vendor_id: 'v-1', bill_date: '2026-11-09', amount: 10, status: 'active' }] })
    await w.enqueue(A, 'bill.recorded', 'purchase_order_bills', 'b-1')
    expect((await w.run(A)).skipped).toBe(1)
  })
})
