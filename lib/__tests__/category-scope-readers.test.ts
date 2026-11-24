/** @jest-environment node */
/**
 * Work category limits, the readers the first pass missed (review round 2): sales side (leads, deals, proposals, appointments),
 * the id-keyed record gates (one table-driven "limited gets 404 / unlimited gets the record" test), customer PATCH, the AI write
 * tools, Today's invoice customer + visible count, the morning email, and "no extra query for an unlimited person".
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { NextRequest } from 'next/server'

import {
  UNLIMITED_SCOPE,
  categoryScopeOf,
  collectionInScope,
  dealHiddenFrom,
  filterByLeadScope,
  filterDealsToScope,
  filterProposalsToScope,
  invoiceInScope,
  leadInScope,
  limitCol,
  proposalHiddenFrom,
  purchaseOrderInScope,
  recordHiddenFrom,
  refInScope,
  resolveCategoryScope,
  servicePlanInScope,
  visitInScope,
  workOrderInScope,
} from '@/lib/category-scope'
import { mayReadLead } from '@/lib/contact-scope'
import { scopeQueues, type Queue } from '@/lib/today'
import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { ToolError, type ToolContext } from '@/lib/ai-connector/tools/types'

let authResult: unknown = null
jest.mock('@/lib/auth', () => ({
  requireAuthApi: jest.fn(async () => {
    if (!authResult) throw new Error('Unauthorized')
    return authResult
  }),
}))
let db: ReturnType<typeof createFakeDb>
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
jest.mock('@/lib/finance-access', () => ({ callerCanAccessJobBilling: async () => true }))
jest.mock('@/lib/ops-access', () => ({ resolveOpsAccess: async () => ({ canJobBoard: true, canEditJobs: true, canViewJobFinancials: true }) }))
jest.mock('@/lib/effective-permissions', () => ({ ...jest.requireActual('@/lib/effective-permissions'), resolveEffectivePermissionNames: async () => ['customers:edit'] }))
jest.mock('@/lib/permissions', () => ({ ...jest.requireActual('@/lib/permissions'), canEditCustomerRecordsFromPermissionNames: () => true }))
jest.mock('@/lib/threads/viewer', () => ({ resolveThreadViewer: async () => ({ orgId: 'org-a', userId: 'u1' }) }))
jest.mock('@/lib/threads/visibility', () => ({ ...jest.requireActual('@/lib/threads/visibility'), isFieldRole: () => false }))
jest.mock('@/lib/service-billing-access', () => ({ canBillService: async () => ({ feature: true, bill: true }) }))
jest.mock('@/lib/purchase-orders-access', () => ({ resolvePoAccess: async () => ({ canView: true, canEdit: true, canBill: true, canSeeMoney: true }) }))
jest.mock('@/lib/purchase-orders-db', () => ({
  ...jest.requireActual('@/lib/purchase-orders-db'),
  loadPoTarget: async () => ({ jobId: 'j-com', cancelled: false, reference: 'x', address: null, scheduledDate: null, workOrderId: null }),
}))

import { PATCH as customerPatch } from '@/app/api/customers/[id]/route'
import { addCostLine, draftInvoice, draftPurchaseOrder } from '@/lib/ai-connector/tools/writes'
import { authorizeJobCost } from '@/lib/job-cost-record'

const ORG = 'org-a'
const U = (id: string) => `00000000-0000-4000-8000-${id.padStart(12, '0')}`
const limited = (...slugs: string[]) => categoryScopeOf({ role: 'sales_manager', category_limit: slugs })
const mgr = { id: 'u-mgr', org_id: ORG, role: 'sales_manager', custom_role_id: null, category_limit: ['residential'] }
const admin = { id: 'u-admin', org_id: ORG, role: 'admin', custom_role_id: null, category_limit: null }
const asAuth = (profile: Record<string, unknown>) => ({ authUser: { id: profile.id, email: null }, profile })

const seed = () =>
  createFakeDb({
    orgs: [{ id: ORG, settings: {} }],
    customers: [
      { id: 'c-res', org_id: ORG, category: 'residential', name: 'Res', email: null, phone: null, address_text: null },
      { id: 'c-com', org_id: ORG, category: 'commercial', name: 'Com', email: null, phone: null, address_text: null },
    ],
    production_jobs: [
      { id: 'j-res', org_id: ORG, customer_id: 'c-res', category: null },
      { id: 'j-com', org_id: ORG, customer_id: 'c-com', category: null },
    ],
    leads: [
      { id: 'l-res', org_id: ORG, category: 'residential' },
      { id: 'l-com', org_id: ORG, category: 'commercial' },
      { id: 'l-none', org_id: ORG, category: null },
    ],
    opportunities: [
      { id: 'o-res', org_id: ORG, customer_id: 'c-res', lead_id: null },
      { id: 'o-com', org_id: ORG, customer_id: 'c-com', lead_id: null },
      { id: 'o-lead-com', org_id: ORG, customer_id: null, lead_id: 'l-com' },
      { id: 'o-lead-res', org_id: ORG, customer_id: null, lead_id: 'l-res' },
    ],
    proposals: [
      { id: 'p-res', org_id: ORG, opportunity_id: 'o-res' },
      { id: 'p-com', org_id: ORG, opportunity_id: 'o-com' },
      { id: 'p-orphan', org_id: ORG, opportunity_id: null },
    ],
    work_orders: [
      { id: 'w-visit-res', org_id: ORG, job_id: null, customer_id: 'c-res' },
      { id: 'w-visit-com', org_id: ORG, job_id: null, customer_id: 'c-com' },
      { id: 'w-trade-res', org_id: ORG, job_id: 'j-res', customer_id: null },
      { id: 'w-trade-com', org_id: ORG, job_id: 'j-com', customer_id: null },
    ],
    job_invoices: [
      { id: 'i-job-res', org_id: ORG, job_id: 'j-res', customer_id: null },
      { id: 'i-job-com', org_id: ORG, job_id: 'j-com', customer_id: 'c-res' }, // stale customer column: the JOB decides
      { id: 'i-cust-res', org_id: ORG, job_id: null, customer_id: 'c-res' },
      { id: 'i-cust-com', org_id: ORG, job_id: null, customer_id: 'c-com' },
    ],
    service_plans: [
      { id: 'sp-res', org_id: ORG, customer_id: 'c-res' },
      { id: 'sp-com', org_id: ORG, customer_id: 'c-com' },
    ],
    supplier_orders: [
      { id: 'po-job-res', org_id: ORG, job_id: 'j-res', work_order_id: null },
      { id: 'po-job-com', org_id: ORG, job_id: 'j-com', work_order_id: null },
      { id: 'po-visit-com', org_id: ORG, job_id: null, work_order_id: 'w-visit-com' },
      { id: 'po-none', org_id: ORG, job_id: null, work_order_id: null },
    ],
    visit_collections: [
      { id: 'vc-res', org_id: ORG, customer_id: 'c-res' },
      { id: 'vc-com', org_id: ORG, customer_id: 'c-com' },
    ],
    scheduled_appointments: [{ id: 'a-com', org_id: ORG, lead_id: 'l-com' }],
    users: [mgr, admin],
  })

beforeEach(() => {
  db = seed()
  authResult = null
})

/** Count every table read, to prove "no limit = no extra query". */
function counting() {
  const d = seed()
  const calls: string[] = []
  const client = new Proxy(d.client as object, {
    get(t, p, r) {
      if (p === 'from') return (table: string) => { calls.push(table); return (t as { from: (x: string) => unknown }).from(table) }
      return Reflect.get(t, p, r)
    },
  })
  return { client: client as never, calls }
}

describe('HIGH 1 — sales side: leads, deals, proposals, appointments', () => {
  const s = limited('residential')
  it('a lead follows its own category; no lead = Not set', async () => {
    expect(await leadInScope(db.client as never, ORG, s, 'l-res')).toBe(true)
    expect(await leadInScope(db.client as never, ORG, s, 'l-com')).toBe(false)
    expect(await leadInScope(db.client as never, ORG, s, 'l-none')).toBe(false)
    expect(await leadInScope(db.client as never, ORG, s, null)).toBe(false)
  })
  it('mayReadLead (every lead reader) applies the category rule for a limited person', async () => {
    expect(await mayReadLead(db.client as never, { id: 'u-mgr', org_id: ORG, role: 'sales_manager', category_limit: ['residential'] } as never, 'l-com')).toBe(false)
    expect(await mayReadLead(db.client as never, { id: 'u-mgr', org_id: ORG, role: 'sales_manager', category_limit: ['residential'] } as never, 'l-res')).toBe(true)
    expect(await mayReadLead(db.client as never, { id: 'u-adm', org_id: ORG, role: 'admin', category_limit: ['residential'] } as never, 'l-com')).toBe(true)
  })
  it('deals: a customer deal follows its customer, a lead-only deal follows its lead', async () => {
    const rows = db.tables.opportunities as unknown as Array<{ id: string; customer_id: string | null; lead_id: string | null }>
    const kept = await filterDealsToScope(db.client as never, ORG, s, rows)
    expect(kept.map((r) => r.id).sort()).toEqual(['o-lead-res', 'o-res'])
  })
  it('dealHiddenFrom / proposalHiddenFrom: hidden for out-of-scope, unknown and orphan; open for in-scope; never for an admin', async () => {
    const p = mgr as never
    expect(await dealHiddenFrom(db.client as never, p, 'o-com')).toBe(true)
    expect(await dealHiddenFrom(db.client as never, p, 'o-res')).toBe(false)
    expect(await dealHiddenFrom(db.client as never, p, 'nope')).toBe(true)
    expect(await proposalHiddenFrom(db.client as never, p, 'p-com')).toBe(true)
    expect(await proposalHiddenFrom(db.client as never, p, 'p-res')).toBe(false)
    expect(await proposalHiddenFrom(db.client as never, p, 'p-orphan')).toBe(true)
    expect(await dealHiddenFrom(db.client as never, admin as never, 'o-com')).toBe(false)
  })
  it('proposal / measurement lists keep only rows whose deal is in scope', async () => {
    const rows = db.tables.proposals as unknown as Array<{ id: string; opportunity_id: string | null }>
    expect((await filterProposalsToScope(db.client as never, ORG, s, rows)).map((r) => r.id)).toEqual(['p-res'])
  })
  it('appointments follow their lead', async () => {
    const rows = db.tables.scheduled_appointments as unknown as Array<{ id: string; lead_id: string | null }>
    expect(await filterByLeadScope(db.client as never, ORG, s, rows, (r) => r.lead_id)).toEqual([])
    expect(await filterByLeadScope(db.client as never, ORG, UNLIMITED_SCOPE, rows, (r) => r.lead_id)).toBe(rows)
  })
})

describe('MEDIUM 4 — every id-keyed record route: limited gets 404, in scope and unlimited do not', () => {
  // [label, in-scope checker, id of an in-scope record, id of an out-of-scope record]
  const table: Array<[string, (...a: never[]) => Promise<boolean>, string, string]> = [
    ['invoice (job invoice, job decides)', invoiceInScope as never, 'i-job-res', 'i-job-com'],
    ['invoice (customer invoice)', invoiceInScope as never, 'i-cust-res', 'i-cust-com'],
    ['service plan (+ history)', servicePlanInScope as never, 'sp-res', 'sp-com'],
    ['purchase order on a job', purchaseOrderInScope as never, 'po-job-res', 'po-job-com'],
    ['purchase order on a visit', purchaseOrderInScope as never, 'po-job-res', 'po-visit-com'],
    ['purchase order with no job / visit (Not set)', purchaseOrderInScope as never, 'po-job-res', 'po-none'],
    ['door collection', collectionInScope as never, 'vc-res', 'vc-com'],
    ['work order (trade crew: roll, moves, assign, unassign)', workOrderInScope as never, 'w-trade-res', 'w-trade-com'],
    ['work order (visit)', workOrderInScope as never, 'w-visit-res', 'w-visit-com'],
    ['visit (photos register / finalize / list / open)', visitInScope as never, 'w-visit-res', 'w-visit-com'],
  ]
  it.each(table)('%s', async (_label, inScope, okId, hiddenId) => {
    const c = db.client as never
    const gate = (profile: unknown, id: string) => recordHiddenFrom(c, profile as never, id, inScope as never)
    expect(await gate(mgr, hiddenId)).toBe(true)
    expect(await gate(mgr, okId)).toBe(false)
    expect(await gate(mgr, 'does-not-exist')).toBe(true) // unknown looks the same as not yours
    expect(await gate(admin, hiddenId)).toBe(false)
    expect(await gate({ ...mgr, category_limit: null }, hiddenId)).toBe(false)
  })
  it('refInScope: job first, then work order, then customer, nothing = Not set; a read failure fails closed', async () => {
    const s = limited('residential')
    expect(await refInScope(db.client as never, ORG, s, { jobId: 'j-com', customerId: 'c-res' })).toBe(false)
    expect(await refInScope(db.client as never, ORG, s, { workOrderId: 'w-visit-res' })).toBe(true)
    expect(await refInScope(db.client as never, ORG, s, {})).toBe(false)
    const boom = { from: () => { throw new Error('db down') } } as never
    expect(await recordHiddenFrom(boom, mgr as never, 'i-job-res', invoiceInScope as never)).toBe(true)
  })

  // The routes themselves must keep calling their gate (a route that loses it silently opens the record).
  const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8')
  const gated: Array<[string, RegExp]> = [
    ['app/invoices/[invoiceId]/print/page.tsx', /invoiceInScope/],
    ['app/api/invoices/[invoiceId]/route.ts', /invoiceInScope/],
    ['app/api/invoices/[invoiceId]/payments/route.ts', /invoiceInScope/],
    ['app/api/invoices/[invoiceId]/pdf/route.ts', /invoiceInScope/],
    ['app/api/invoices/[invoiceId]/pay-link/route.ts', /invoiceInScope/],
    ['app/api/invoices/[invoiceId]/pay-link/text/route.ts', /invoiceInScope/],
    ['app/api/service-plans/[id]/route.ts', /servicePlanInScope/],
    ['app/api/service-plans/[id]/history/route.ts', /servicePlanInScope/],
    ['app/api/ops/purchase-orders/[id]/route.ts', /purchaseOrderInScope/],
    ['app/api/ops/purchase-orders/[id]/send/route.ts', /purchaseOrderInScope/],
    ['app/api/ops/purchase-orders/[id]/preview/route.ts', /purchaseOrderInScope/],
    ['app/api/ops/purchase-orders/[id]/receive/route.ts', /purchaseOrderInScope/],
    ['app/api/ops/purchase-orders/[id]/acknowledge/route.ts', /purchaseOrderInScope/],
    ['app/api/ops/purchase-orders/[id]/bills/route.ts', /purchaseOrderInScope/],
    ['app/api/ops/purchase-orders/[id]/bills/[billId]/route.ts', /purchaseOrderInScope/],
    ['app/api/ops/purchase-orders/route.ts', /refInScope/],
    ['app/api/ops/collections/[id]/route.ts', /collectionInScope/],
    ['app/api/ops/visits/[id]/route.ts', /visitInScope/],
    ['app/api/ops/visits/[id]/photos/route.ts', /visitInScope/],
    ['app/api/ops/visits/[id]/photos/register/route.ts', /visitInScope/],
    ['app/api/ops/visits/[id]/photos/finalize/route.ts', /visitInScope/],
    ['app/api/ops/visits/[id]/photos/[photoId]/route.ts', /visitInScope/],
    ['app/api/ops/visits/order/route.ts', /categoryScopeOf\(ctx\.profile\)\.limited/],
    ['app/api/ops/visits/shift/route.ts', /categoryScopeOf\(ctx\.profile\)\.limited/],
    ['app/api/ops/visits/sheet/route.ts', /categoryScopeOf\(ctx\.profile\)\.limited/],
    ['app/api/ops/subs/[id]/crew-day-link/route.ts', /categoryScopeOf\(ctx\.profile\)\.limited/],
    ['app/api/ops/work-orders/[id]/roll/route.ts', /workOrderInScope/],
    ['app/api/ops/work-orders/[id]/moves/route.ts', /workOrderInScope/],
    ['app/api/ops/install-schedule/assign/route.ts', /workOrderInScope/],
    ['app/api/ops/install-schedule/unassign/route.ts', /workOrderInScope/],
    ['app/api/ops/checkups/[id]/route.ts', /categoryScopeOf|inScopeJobIds|jobHiddenFrom/],
    ['app/api/leads/[id]/category/route.ts', /leadInScope/],
    ['app/api/leads/[id]/route.ts', /leadInScope|categoryAllowed/],
    ['app/api/opportunities/[id]/route.ts', /dealHiddenFrom/],
    ['app/api/proposals/[id]/route.ts', /proposalHiddenFrom/],
    ['app/api/customers/[id]/route.ts', /customerInScope/],
    ['app/api/appointments/[id]/route.ts', /filterByLeadScope/],
    ['app/api/invoice-batches/route.ts', /categoryScopeOf/],
    ['app/api/invoice-batches/billable/route.ts', /categoryScopeOf/],
  ]
  it.each(gated)('%s keeps its gate', (file, re) => {
    const src = read(file)
    expect(src).toMatch(re)
    expect(src.indexOf('category-scope') >= 0 || /categoryScope|InScope/.test(src)).toBe(true)
  })
})

describe('HIGH 3 — the morning email', () => {
  const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8')
  it('a limited recipient is dropped before anything is loaded or sent', async () => {
    process.env.SMTP_HOST = 'smtp.example.test'
    const sendMail = jest.fn(async () => ({}))
    jest.resetModules()
    jest.doMock('@/lib/setter-email', () => ({ getCrmEmailFrom: async () => 'x@example.com', getMailTransport: () => ({ sendMail }) }))
    jest.doMock('@/lib/crm-email-from', () => ({ getCrmEmailFrom: async () => 'x@example.com' }))
    const { sendMorningUpdateEmail } = await import('@/lib/morning-update-email')
    db = createFakeDb({
      orgs: [{ id: ORG, settings: {} }],
      users: [
        { id: 'u-mgr', org_id: ORG, email: 'mgr@example.com', role: 'sales_manager', is_super_admin: false, active: true, category_limit: ['residential'] },
      ],
    })
    const res = await sendMorningUpdateEmail(db.client as never, { orgId: ORG, testToEmails: ['mgr@example.com'], metrics: {} as never })
    expect(res).toMatchObject({ sent: 0, skipped: true, reason: 'no_recipients' })
    expect(sendMail).not.toHaveBeenCalled()
  })
  it('the source drops limited recipients by role + stored limit (admins / owners are never limited)', () => {
    const src = read('lib/morning-update-email.ts')
    expect(src).toMatch(/limitedEmails/)
    expect(src).toMatch(/categoryScopeOf\(u as/)
  })
})

describe('LOW 7 / 8 — Today: a job invoice follows its JOB; the count is the visible count', () => {
  const it0 = (id: string, href: string) => ({ id, title: id, detail: '', href, ref: '', note: '' })
  it('invoice customer comes from production_jobs, not job_invoices.customer_id', async () => {
    const d = createFakeDb({
      customers: [{ id: U('1'), org_id: ORG, category: 'residential' }, { id: U('2'), org_id: ORG, category: 'commercial' }],
      production_jobs: [
        { id: U('10'), org_id: ORG, customer_id: U('1'), category: null },
        { id: U('11'), org_id: ORG, customer_id: U('2'), category: null },
      ],
      // The invoice rows carry the WRONG customer on purpose: only the job's customer counts.
      job_invoices: [
        { id: U('20'), org_id: ORG, job_id: U('10'), customer_id: U('2') },
        { id: U('21'), org_id: ORG, job_id: U('11'), customer_id: U('1') },
      ],
    })
    const queues: Queue[] = [{ id: 'q', title: 'q', count: 2, empty: '', items: [it0('a', `/invoices/${U('20')}/print`), it0('b', `/invoices/${U('21')}/print`)] }]
    const [q] = await scopeQueues(d.client as never, ORG, limited('residential'), queues)
    expect(q.items.map((i) => i.id)).toEqual(['a'])
  })
  it('a capped list reports what the person can see, never the hidden total', async () => {
    const d = createFakeDb({ customers: [{ id: U('1'), org_id: ORG, category: 'residential' }] })
    const queues: Queue[] = [{ id: 'q', title: 'q', count: 40, empty: '', items: [it0('a', `/customers/${U('1')}`)] }]
    const [q] = await scopeQueues(d.client as never, ORG, limited('residential'), queues)
    expect(q.count).toBe(1)
  })
})

describe('MEDIUM 5 — customer PATCH', () => {
  const patch = (id: string, body: unknown) =>
    customerPatch(new Request('https://crm.example/api/customers/x', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), { params: { id } })
  it('a limited person gets 404 on a customer outside the categories and nothing is written', async () => {
    authResult = asAuth(mgr)
    const res = await patch('c-com', { name: 'Hijack' })
    expect(res.status).toBe(404)
    expect(db.tables.customers.find((c) => c.id === 'c-com')?.name).toBe('Com')
  })
  it('an admin is not limited (the gate lets the request through; it never answers "not found" for scope)', async () => {
    authResult = asAuth(admin)
    const res = await patch('c-com', { name: 'Com 2' })
    expect(res.status).not.toBe(404)
  })
})

describe('MEDIUM 6 — AI write tools respect the category limit', () => {
  const ctxFor = (profile: Record<string, unknown>): ToolContext => ({ admin: db.client as never, profile: profile as never, userId: String(profile.id), orgId: ORG, clientName: 'Claude', now: Date.UTC(2026, 10, 15) })
  const fail = async (p: Promise<unknown>) => { try { await p; return null } catch (e) { return e as ToolError } }
  it('authorizeJobCost: 404 for a job outside the categories, ok inside, ok unlimited', async () => {
    expect((await authorizeJobCost(db.client as never, mgr as never, 'j-com')).ok).toBe(false)
    expect(await authorizeJobCost(db.client as never, mgr as never, 'j-com')).toMatchObject({ ok: false, status: 404 })
    expect((await authorizeJobCost(db.client as never, mgr as never, 'j-res')).ok).toBe(true)
    expect((await authorizeJobCost(db.client as never, admin as never, 'j-com')).ok).toBe(true)
  })
  it('add_cost_line: out-of-scope job is not_found on prepare AND apply', async () => {
    const a = { job_id: 'j-com', description: 'tape', amount: 5 }
    expect((await fail(addCostLine.write.prepare(ctxFor(mgr), a as never)))?.code).toBe('not_found')
    expect((await fail(addCostLine.write.apply(ctxFor(mgr), a as never, 'chg')))?.code).toBe('not_found')
  })
  it('draft_invoice: a customer outside the categories is not_found', async () => {
    const e = await fail(draftInvoice.write.prepare(ctxFor(mgr), { customer_id: 'c-com', lines: [{ description: 'x', qty: 1, unit_price: 5 }] } as never))
    expect(e?.code).toBe('not_found')
  })
  it('draft_purchase_order: a job outside the categories is not_found', async () => {
    const e = await fail(draftPurchaseOrder.write.prepare(ctxFor(mgr), { job_id: 'j-com', vendor_id: 'v1', lines: [{ description: 'x', quantity: 1 }] } as never))
    expect(e?.code).toBe('not_found')
  })
})

describe('LOW 11 — an unlimited person (ARX today) costs no extra query', () => {
  it('every filter and gate returns the same array / false with zero reads for UNLIMITED_SCOPE', async () => {
    const { client, calls } = counting()
    const rows = [{ id: 'x', customer_id: 'c-com', lead_id: 'l-com', opportunity_id: 'o-com' }]
    expect(await filterDealsToScope(client, ORG, UNLIMITED_SCOPE, rows)).toBe(rows)
    expect(await filterProposalsToScope(client, ORG, UNLIMITED_SCOPE, rows)).toBe(rows)
    expect(await filterByLeadScope(client, ORG, UNLIMITED_SCOPE, rows, (r) => r.lead_id)).toBe(rows)
    expect(await refInScope(client, ORG, UNLIMITED_SCOPE, { jobId: 'j-com' })).toBe(true)
    for (const fn of [invoiceInScope, servicePlanInScope, purchaseOrderInScope, collectionInScope, workOrderInScope]) {
      expect(await recordHiddenFrom(client, { ...mgr, category_limit: null } as never, 'x', fn as never)).toBe(false)
    }
    expect(await dealHiddenFrom(client, { ...mgr, category_limit: null } as never, 'o-com')).toBe(false)
    expect(await proposalHiddenFrom(client, { ...mgr, category_limit: null } as never, 'p-com')).toBe(false)
    expect(calls).toEqual([])
  })
  it('resolveCategoryScope: a full user row, or an owner / admin, reads nothing', async () => {
    const { client, calls } = counting()
    expect((await resolveCategoryScope(client, { id: 'u', org_id: ORG, role: 'sales_rep', category_limit: null } as never)).limited).toBe(false)
    expect((await resolveCategoryScope(client, { id: 'u', org_id: ORG, role: 'admin' } as never)).limited).toBe(false)
    expect((await resolveCategoryScope(client, { id: 'u', org_id: ORG, role: 'owner' } as never)).limited).toBe(false)
    expect(calls).toEqual([])
  })
  it('limitCol: the column probe is once per server, not once per request', async () => {
    const { client, calls } = counting()
    jest.resetModules()
    jest.doMock('@/lib/supabase/service', () => ({ createServiceClient: () => client }))
    const mod = await import('@/lib/category-scope')
    expect(await mod.limitCol()).toBe(', category_limit')
    expect(await mod.limitCol()).toBe(', category_limit')
    expect(await mod.limitCol()).toBe(', category_limit')
    expect(calls.filter((t) => t === 'users')).toHaveLength(1)
    jest.dontMock('@/lib/supabase/service')
    expect(typeof limitCol).toBe('function')
  })
  it('limitCol: before the migration it answers "" (hand-rolled selects keep working) without a per-request query', async () => {
    const missing = { from: jest.fn(() => ({ select: () => ({ limit: async () => ({ data: null, error: { code: '42703', message: 'column users.category_limit does not exist' } }) }) })) }
    jest.resetModules()
    jest.doMock('@/lib/supabase/service', () => ({ createServiceClient: () => missing }))
    const mod = await import('@/lib/category-scope')
    expect(await mod.limitCol()).toBe('')
    expect(await mod.limitCol()).toBe('')
    expect(missing.from).toHaveBeenCalledTimes(1)
    // and a non-admin partial profile then needs no read either: nobody can be limited yet
    expect((await mod.resolveCategoryScope(missing as never, { id: 'u', org_id: ORG, role: 'sales_rep' } as never)).limited).toBe(false)
    expect(missing.from).toHaveBeenCalledTimes(1)
  })
})

// keep the helper imported even when a case above is skipped
void NextRequest
