/** @jest-environment node */
/**
 * Work category limits (lib/category-scope.ts): the rules, the gates, the list filters, the Cmd-K post-filter, Today, and the write
 * door (/api/admin/users). A NULL limit must change nothing: same rows, same array, no query.
 */
import { NextRequest } from 'next/server'

import {
  NO_CATEGORY,
  UNLIMITED_SCOPE,
  categoryAllowed,
  categoryOrFilter,
  categoryScopeOf,
  customerInScope,
  dealInScope,
  filterByCustomerScope,
  filterByLeadScope,
  filterJobOrCustomerRows,
  filterJobsToScope,
  inScopeJobIds,
  isNeverLimited,
  jobAllowed,
  jobHiddenFrom,
  leadInScope,
  loadCategoryScope,
  resetCategoryLimitColumnCache,
  resolveCategoryLimitInput,
} from '@/lib/category-scope'
import { scopeSearchHits } from '@/lib/global-search'
import { scopeQueues, type Queue } from '@/lib/today'
import { createFakeDb } from '@/lib/test-helpers/fake-db'

let authResult: unknown = null
jest.mock('@/lib/auth', () => ({
  requireAuthApi: jest.fn(async () => {
    if (!authResult) throw new Error('Unauthorized')
    return authResult
  }),
}))
jest.mock('@/lib/setter-email', () => ({ getCrmEmailFrom: () => 'x@example.com', getMailTransport: () => ({ sendMail: jest.fn() }) }))
jest.mock('@/lib/money-permission-guard', () => ({
  actorIsOwner: jest.fn(async () => false),
  isMoneyPermissionName: () => false,
  lockMoneyPermissions: (next: string[]) => next,
  moneyPermissionIds: jest.fn(async () => new Set<string>()),
}))
let db: ReturnType<typeof createFakeDb>
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({ ...(db.client as object), auth: { admin: { updateUserById: jest.fn(async () => ({ error: null })), createUser: jest.fn(), deleteUser: jest.fn() } } }),
}))

import { PUT } from '@/app/api/admin/users/route'

const ORG = 'org-a'
const U = (id: string) => `00000000-0000-4000-8000-${id.padStart(12, '0')}`
const limited = (...slugs: string[]) => categoryScopeOf({ role: 'sales_manager', category_limit: slugs })
const seed = () =>
  createFakeDb({
    orgs: [{ id: ORG, settings: {} }],
    customers: [
      { id: 'c-res', org_id: ORG, category: 'residential' },
      { id: 'c-com', org_id: ORG, category: 'commercial' },
      { id: 'c-none', org_id: ORG, category: null },
      { id: 'c-far', org_id: 'org-b', category: 'residential' },
    ],
    production_jobs: [
      { id: 'j-res', org_id: ORG, customer_id: 'c-res', category: null },
      { id: 'j-over', org_id: ORG, customer_id: 'c-res', category: 'commercial' }, // residential customer, commercial job
      { id: 'j-com', org_id: ORG, customer_id: 'c-com', category: null },
      { id: 'j-none', org_id: ORG, customer_id: 'c-none', category: null },
    ],
    leads: [
      { id: 'l-res', org_id: ORG, category: 'residential' },
      { id: 'l-none', org_id: ORG, category: null },
    ],
    opportunities: [
      { id: 'o-res', org_id: ORG, customer_id: 'c-res', lead_id: null },
      { id: 'o-com', org_id: ORG, customer_id: 'c-com', lead_id: null },
      { id: 'o-lead', org_id: ORG, customer_id: null, lead_id: 'l-res' },
    ],
    proposals: [
      { id: 'p-res', org_id: ORG, opportunity_id: 'o-res' },
      { id: 'p-com', org_id: ORG, opportunity_id: 'o-com' },
    ],
    users: [
      { id: 'u-admin', org_id: ORG, role: 'admin', active: true, custom_role_id: null, category_limit: null },
      { id: 'u-mgr', org_id: ORG, role: 'sales_manager', active: true, custom_role_id: null, category_limit: ['residential'] },
      { id: 'u-rep', org_id: ORG, role: 'sales_rep', active: true, custom_role_id: null, category_limit: null },
    ],
  })

describe('the rules', () => {
  it('NULL / undefined limit = no limit; owners, admins and super admins are never limited whatever is stored', () => {
    expect(categoryScopeOf({ role: 'sales_rep', category_limit: null }).limited).toBe(false)
    expect(categoryScopeOf({ role: 'sales_rep' }).limited).toBe(false)
    expect(categoryScopeOf(null).limited).toBe(false)
    for (const p of [{ role: 'admin' }, { role: 'owner' }, { role: 'sales_rep', is_super_admin: true }]) {
      expect(isNeverLimited({ ...p, category_limit: ['commercial'] })).toBe(true)
      expect(categoryScopeOf({ ...p, category_limit: ['commercial'] }).limited).toBe(false)
    }
  })

  it('a limit allows only its slugs; __none means "Not set"; blank is Not set', () => {
    const s = limited('residential')
    expect(categoryAllowed(s, 'residential')).toBe(true)
    expect(categoryAllowed(s, 'commercial')).toBe(false)
    expect(categoryAllowed(s, null)).toBe(false)
    expect(categoryAllowed(s, '')).toBe(false)
    const none = limited(NO_CATEGORY)
    expect(categoryAllowed(none, null)).toBe(true)
    expect(categoryAllowed(none, undefined)).toBe(true)
    expect(categoryAllowed(none, 'residential')).toBe(false)
    expect(categoryAllowed(UNLIMITED_SCOPE, 'anything')).toBe(true)
  })

  it('an empty or malformed limit allows nothing (never everything)', () => {
    expect(categoryScopeOf({ role: 'sales_rep', category_limit: [] }).limited).toBe(true)
    const bad = categoryScopeOf({ role: 'sales_rep', category_limit: 'residential' as unknown as string[] })
    expect(bad.limited).toBe(true)
    expect(categoryAllowed(bad, 'residential')).toBe(false)
  })

  it('a job follows its own category, else its customer', () => {
    const s = limited('residential')
    expect(jobAllowed(s, null, 'residential')).toBe(true)
    expect(jobAllowed(s, 'commercial', 'residential')).toBe(false) // override wins
    expect(jobAllowed(s, 'residential', 'commercial')).toBe(true)
    expect(jobAllowed(s, null, null)).toBe(false)
    expect(jobAllowed(limited(NO_CATEGORY), null, null)).toBe(true)
  })

  it('the query filter keeps the allowed slugs (+ blank when Not set is allowed); unlimited adds nothing', () => {
    expect(categoryOrFilter(UNLIMITED_SCOPE)).toBeNull()
    expect(categoryOrFilter(limited('residential', 'commercial'))).toBe('category.in.(residential,commercial)')
    expect(categoryOrFilter(limited('residential', NO_CATEGORY))).toBe('category.in.(residential),category.is.null')
    expect(categoryOrFilter(limited(NO_CATEGORY))).toBe('category.is.null')
  })

  it('what an owner / admin sends is checked against THIS company list', () => {
    const list = [{ slug: 'residential' }, { slug: 'commercial' }]
    expect(resolveCategoryLimitInput(list, null)).toEqual({ ok: true, value: null })
    expect(resolveCategoryLimitInput(list, ['residential', NO_CATEGORY, 'residential'])).toEqual({ ok: true, value: ['residential', NO_CATEGORY] })
    expect(resolveCategoryLimitInput(list, []).ok).toBe(false)
    expect(resolveCategoryLimitInput(list, ['other_company_slug']).ok).toBe(false)
    expect(resolveCategoryLimitInput(list, 'residential').ok).toBe(false)
  })
})

describe('a NULL limit changes nothing', () => {
  it('returns the same rows and reads nothing', async () => {
    const selects: string[] = []
    const d = createFakeDb({ customers: [{ id: 'c1', org_id: ORG, category: 'commercial' }] }, { onSelect: (t) => selects.push(t) })
    const rows = [{ id: 'j1', customer_id: 'c1' }, { id: 'j2', customer_id: null }]
    expect(await filterJobsToScope(d.client as never, ORG, UNLIMITED_SCOPE, rows)).toBe(rows)
    expect(await filterByCustomerScope(d.client as never, ORG, UNLIMITED_SCOPE, rows, (r) => r.customer_id)).toBe(rows)
    expect(await filterByLeadScope(d.client as never, ORG, UNLIMITED_SCOPE, rows, (r) => r.id)).toBe(rows)
    expect(await filterJobOrCustomerRows(d.client as never, ORG, UNLIMITED_SCOPE, rows, (r) => ({ jobId: r.id, customerId: r.customer_id }))).toBe(rows)
    expect(await customerInScope(d.client as never, ORG, UNLIMITED_SCOPE, 'c1')).toBe(true)
    expect(await jobHiddenFrom(d.client as never, { id: 'u', org_id: ORG, role: 'sales_rep', category_limit: null }, 'j1')).toBe(false)
    expect(await scopeSearchHits(d.client as never, ORG, UNLIMITED_SCOPE, [{ kind: 'job', id: 'j1', title: '', subtitle: '', score: 1 }])).toHaveLength(1)
    const queues: Queue[] = [{ id: 'q', title: 'q', count: 1, empty: '', items: [{ id: '1', title: '', detail: '', href: `/ops/jobs/${U('1')}`, ref: '', note: '' }] }]
    expect(await scopeQueues(d.client as never, ORG, UNLIMITED_SCOPE, queues)).toBe(queues)
    expect(selects).toEqual([])
  })

  it('a missing column reads as no limit; a failed read for a person is a limit that allows nothing', async () => {
    resetCategoryLimitColumnCache()
    const missing = { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { code: '42703', message: 'column users.category_limit does not exist' } }) }) }) }) }) }
    expect((await loadCategoryScope(missing as never, ORG, { id: 'u' })).limited).toBe(false)
    resetCategoryLimitColumnCache()
    const down = { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { code: 'XX000', message: 'down' } }) }) }) }) }) }
    const s = await loadCategoryScope(down as never, ORG, { id: 'u' })
    expect(s.limited).toBe(true)
    expect(categoryAllowed(s, 'residential')).toBe(false)
    resetCategoryLimitColumnCache()
  })
})

describe('gates and filters on records', () => {
  const s = limited('residential')
  it('customers: in scope only for their category; another company is never in scope', async () => {
    const d = seed()
    const c = d.client as never
    expect(await customerInScope(c, ORG, s, 'c-res')).toBe(true)
    expect(await customerInScope(c, ORG, s, 'c-com')).toBe(false)
    expect(await customerInScope(c, ORG, s, 'c-none')).toBe(false)
    expect(await customerInScope(c, ORG, limited(NO_CATEGORY), 'c-none')).toBe(true)
    expect(await customerInScope(c, ORG, s, 'c-far')).toBe(false) // org-b row, never read
    expect(await customerInScope(c, ORG, s, 'missing')).toBe(false)
  })

  it('a slug from another company list never opens a record of this one', async () => {
    const d = seed()
    expect(await customerInScope(d.client as never, ORG, limited('some_other_company_slug'), 'c-res')).toBe(false)
  })

  it('deals follow the customer, else the lead, else Not set', async () => {
    const c = seed().client as never
    expect(await dealInScope(c, ORG, s, { customer_id: 'c-res' })).toBe(true)
    expect(await dealInScope(c, ORG, s, { customer_id: 'c-com' })).toBe(false)
    expect(await dealInScope(c, ORG, s, { customer_id: null, lead_id: 'l-res' })).toBe(true)
    expect(await dealInScope(c, ORG, s, { customer_id: null, lead_id: 'l-none' })).toBe(false)
    expect(await dealInScope(c, ORG, s, {})).toBe(false)
    expect(await dealInScope(c, ORG, limited(NO_CATEGORY), {})).toBe(true)
    expect(await leadInScope(c, ORG, s, 'l-res')).toBe(true)
  })

  it('jobs: the override beats the customer; the job gate answers "hidden" for out of scope and for a missing job', async () => {
    const c = seed().client as never
    const rows = [
      { id: 'j-res', customer_id: 'c-res' },
      { id: 'j-over', customer_id: 'c-res' },
      { id: 'j-com', customer_id: 'c-com' },
      { id: 'j-none', customer_id: 'c-none' },
    ]
    expect(Array.from(await inScopeJobIds(c, ORG, s, rows))).toEqual(['j-res'])
    expect((await filterJobsToScope(c, ORG, limited('commercial'), rows)).map((r) => r.id)).toEqual(['j-over', 'j-com'])
    const prof = (lim: string[] | null) => ({ id: 'u', org_id: ORG, role: 'sales_manager', category_limit: lim })
    expect(await jobHiddenFrom(c, prof(['residential']), 'j-res')).toBe(false)
    expect(await jobHiddenFrom(c, prof(['residential']), 'j-over')).toBe(true)
    expect(await jobHiddenFrom(c, prof(['residential']), 'j-com')).toBe(true)
    expect(await jobHiddenFrom(c, prof(['residential']), 'nope')).toBe(true)
    expect(await jobHiddenFrom(c, { ...prof(['commercial']), role: 'admin' }, 'j-res')).toBe(false) // admin never limited
  })

  it('a failed read hides the job (fail closed)', async () => {
    const boom = { from: () => { throw new Error('down') } }
    expect(await jobHiddenFrom(boom as never, { id: 'u', org_id: ORG, role: 'sales_manager', category_limit: ['residential'] }, 'j-res')).toBe(true)
  })

  it('visits / plans / invoices / appointments: by customer, by lead, and job-or-customer', async () => {
    const c = seed().client as never
    const visits = [{ id: 'v1', cid: 'c-res' }, { id: 'v2', cid: 'c-com' }, { id: 'v3', cid: null }, { id: 'v4', cid: 'c-far' }]
    expect((await filterByCustomerScope(c, ORG, s, visits, (v) => v.cid)).map((v) => v.id)).toEqual(['v1'])
    const appts = [{ id: 'a1', lead: 'l-res' }, { id: 'a2', lead: 'l-none' }, { id: 'a3', lead: null }]
    expect((await filterByLeadScope(c, ORG, s, appts, (a) => a.lead)).map((a) => a.id)).toEqual(['a1'])
    const inv = [
      { id: 'i1', jobId: 'j-res', customerId: 'c-res' },
      { id: 'i2', jobId: 'j-over', customerId: 'c-res' }, // job override is commercial
      { id: 'i3', jobId: null, customerId: 'c-res' },
      { id: 'i4', jobId: null, customerId: 'c-com' },
    ]
    expect((await filterJobOrCustomerRows(c, ORG, s, inv, (r) => ({ jobId: r.jobId, customerId: r.customerId }))).map((r) => r.id)).toEqual(['i1', 'i3'])
  })
})

describe('Cmd-K post-filter', () => {
  it('drops hits outside the categories: customers, jobs, opportunities, proposals', async () => {
    const c = seed().client as never
    const hit = (kind: 'customer' | 'job' | 'proposal' | 'opportunity', id: string) => ({ kind, id, title: id, subtitle: '', score: 1 })
    const all = [
      hit('customer', 'c-res'), hit('customer', 'c-com'),
      hit('job', 'j-res'), hit('job', 'j-over'),
      hit('opportunity', 'o-res'), hit('opportunity', 'o-com'), hit('opportunity', 'o-lead'),
      hit('proposal', 'p-res'), hit('proposal', 'p-com'),
    ]
    const out = await scopeSearchHits(c, ORG, limited('residential'), all)
    expect(out.map((h) => `${h.kind}:${h.id}`).sort()).toEqual(['customer:c-res', 'job:j-res', 'opportunity:o-lead', 'opportunity:o-res', 'proposal:p-res'])
  })

  it('a failed read returns nothing rather than everything', async () => {
    const boom = { from: () => { throw new Error('down') } }
    expect(await scopeSearchHits(boom as never, ORG, limited('residential'), [{ kind: 'job', id: 'j-res', title: '', subtitle: '', score: 1 }])).toEqual([])
  })
})

describe('Today', () => {
  it('drops rows about records outside the categories, keeps rows about nothing, lowers the count', async () => {
    const d = createFakeDb({
      customers: [{ id: U('1'), org_id: ORG, category: 'residential' }, { id: U('2'), org_id: ORG, category: 'commercial' }],
      production_jobs: [{ id: U('3'), org_id: ORG, customer_id: U('1'), category: null }, { id: U('4'), org_id: ORG, customer_id: U('1'), category: 'commercial' }],
      opportunities: [{ id: U('5'), org_id: ORG, customer_id: U('2'), lead_id: null }],
    })
    const it = (id: string, href: string) => ({ id, title: id, detail: '', href, ref: '', note: '' })
    const queues: Queue[] = [{
      id: 'q', title: 'q', count: 5, empty: '',
      items: [it('a', `/ops/jobs/${U('3')}`), it('b', `/ops/jobs/${U('4')}`), it('c', `/opportunities/${U('5')}`), it('d', `/customers/${U('1')}`), it('e', '/ops/schedule?view=visits')],
    }]
    const [q] = await scopeQueues(d.client as never, ORG, limited('residential'), queues)
    expect(q.items.map((i) => i.id)).toEqual(['a', 'd', 'e'])
    expect(q.count).toBe(3)
  })
})

describe('writing a limit (PUT /api/admin/users)', () => {
  const as = (id: string, role: string, org = ORG) => ({ authUser: { id, email: null }, profile: { id, org_id: org, role, category_limit: null } })
  const put = (body: unknown) =>
    PUT(new NextRequest('https://crm.example/api/admin/users', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))
  const lim = (id: string) => (db.tables.users.find((u) => u.id === id) as { category_limit: unknown }).category_limit
  beforeEach(() => { db = seed() })

  it('a manager cannot set it (on anyone, or themselves); nothing changes', async () => {
    authResult = as('u-mgr', 'sales_manager')
    expect((await put({ id: 'u-rep', category_limit: ['residential'] })).status).toBe(403)
    expect((await put({ id: 'u-mgr', category_limit: null })).status).toBe(403)
    expect(lim('u-rep')).toBeNull()
    expect(lim('u-mgr')).toEqual(['residential'])
  })

  it('an admin can set and clear it for someone else, but never their own', async () => {
    authResult = as('u-admin', 'admin')
    expect((await put({ id: 'u-rep', category_limit: ['residential', NO_CATEGORY] })).status).toBe(200)
    expect(lim('u-rep')).toEqual(['residential', NO_CATEGORY])
    expect((await put({ id: 'u-rep', category_limit: null })).status).toBe(200)
    expect(lim('u-rep')).toBeNull()
    expect((await put({ id: 'u-admin', category_limit: ['residential'] })).status).toBe(403)
  })

  it('refuses an empty list and a slug that is not on this company list', async () => {
    authResult = as('u-admin', 'admin')
    expect((await put({ id: 'u-rep', category_limit: [] })).status).toBe(400)
    expect((await put({ id: 'u-rep', category_limit: ['not_a_category'] })).status).toBe(400)
    expect(lim('u-rep')).toBeNull()
  })

  it('leaving it out of a save leaves it alone', async () => {
    authResult = as('u-admin', 'admin')
    expect((await put({ id: 'u-mgr', phone: '555' })).status).toBe(200)
    expect(lim('u-mgr')).toEqual(['residential'])
  })
})

describe('the existing gates answer "not found" for an out-of-scope record', () => {
  it('a deal (loadDeal) and a customer (loadCustomerForCaller)', async () => {
    const { loadDeal } = await import('@/lib/threads/get-thread')
    const c = seed().client as never
    expect((await loadDeal(c, ORG, 'o-res', limited('residential')))?.id).toBe('o-res')
    expect(await loadDeal(c, ORG, 'o-com', limited('residential'))).toBeNull()
    expect(await loadDeal(c, ORG, 'o-lead', limited('commercial'))).toBeNull()
    expect((await loadDeal(c, ORG, 'o-com'))?.id).toBe('o-com') // no scope passed = as before
    expect((await loadDeal(c, ORG, 'o-com', UNLIMITED_SCOPE))?.id).toBe('o-com')
  })

  it('visits are paged AFTER the category cut, so total and hasMore count what the person can see', async () => {
    jest.doMock('@/lib/cron-orgs', () => ({ loadOrgTimeZone: async () => 'America/New_York' }))
    const { loadVisitsPage } = await import('@/lib/service-plans-db')
    const wo = (n: number, cid: string | null) => ({ id: `w${n}`, org_id: ORG, work_order_type: 'service_visit', scheduled_date: `2026-11-${String(10 + n).padStart(2, '0')}`, customer_id: cid, status: 'scheduled', service_plan_id: null, visit_step: 'service' })
    const d = createFakeDb({
      work_orders: [wo(1, 'c-res'), wo(2, 'c-com'), wo(3, 'c-res'), wo(4, 'c-none'), wo(5, 'c-res')],
      customers: [{ id: 'c-res', org_id: ORG, category: 'residential', name: 'R' }, { id: 'c-com', org_id: ORG, category: 'commercial', name: 'C' }, { id: 'c-none', org_id: ORG, category: null, name: 'N' }],
    })
    const base = { from: '2026-11-01', to: '2026-11-30', accessNotes: false }
    const all = await loadVisitsPage(d.client as never, ORG, base)
    expect(all.total).toBe(5)
    const p1 = await loadVisitsPage(d.client as never, ORG, { ...base, scope: limited('residential'), limit: 2 })
    expect(p1.visits.map((v) => v.id)).toEqual(['w1', 'w3'])
    expect(p1.total).toBe(3)
    expect(p1.hasMore).toBe(true)
    const p2 = await loadVisitsPage(d.client as never, ORG, { ...base, scope: limited('residential'), limit: 2, offset: 2 })
    expect(p2.visits.map((v) => v.id)).toEqual(['w5'])
    expect(p2.hasMore).toBe(false)
    const notSet = await loadVisitsPage(d.client as never, ORG, { ...base, scope: limited(NO_CATEGORY) })
    expect(notSet.visits.map((v) => v.id)).toEqual(['w4'])
  })
})
