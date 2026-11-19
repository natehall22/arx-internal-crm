/** @jest-environment node */
import { readFileSync } from 'fs'

import { createFakeDb } from '@/lib/test-helpers/fake-db'

jest.mock('@/lib/cron-orgs', () => ({ loadOrgTimeZone: async () => 'UTC' }))
jest.mock('@/lib/org-features-server', () => ({ isOrgFeatureOn: async () => true }))
jest.mock('@/lib/org-trades', () => {
  const actual = jest.requireActual('@/lib/org-trades')
  return {
    ...actual,
    loadOrgTrades: async () => [
      { slug: 'grading', label: 'Grading', sort: 10, active: true, matchKeywords: null },
      { slug: 'sod', label: 'Sod', sort: 20, active: true, matchKeywords: null },
    ],
  }
})

import { loadBeforeYou } from '@/lib/before-you-db'
import { loadDevelopmentBoard } from '@/lib/development-board-db'
import { loadLotJobsToSchedule, lotSummaryText } from '@/lib/lot-jobs-queue'
import { derivePayrollEligibility } from '@/lib/payroll-period-materialization'
import { loadOpsQueues } from '@/lib/today'

const O = 'o1'
const prop = (id: string, customer: string, community: string, lot: string, over = {}) => ({ id, org_id: O, customer_id: customer, community, lot, address_text: `Lot ${lot}, ${community}`, active: true, created_at: `2026-11-0${lot}`, ...over })

describe('Development board: builder and development are database filters', () => {
  const seed = () => ({
    properties: [prop('p1', 'c1', 'Oak Ridge', '1'), prop('p2', 'c1', 'Pine Hollow', '2'), prop('p3', 'c2', 'Oak Ridge', '3'), { ...prop('px', 'c1', 'Oak Ridge', '4'), org_id: 'other' }],
    customers: [{ id: 'c1', org_id: O, name: 'Acme' }, { id: 'c2', org_id: O, name: 'Beta' }],
    work_orders: [], production_jobs: [],
  })
  it('filters in the query (case/space-insensitive development), never another company, and reports the total over the cap', async () => {
    const db = createFakeDb(seed())
    const all = await loadDevelopmentBoard(db.client as never, O)
    expect(all.lots.map((l) => l.propertyId).sort()).toEqual(['p1', 'p2', 'p3'])
    expect(all.options.builders.map((b) => b.name)).toEqual(['Acme', 'Beta'])
    expect(all.options.developments).toEqual(['Oak Ridge', 'Pine Hollow'])
    const dev = await loadDevelopmentBoard(db.client as never, O, { development: 'oak  ridge ' })
    expect(dev.lots.map((l) => l.propertyId).sort()).toEqual(['p1', 'p3'])
    const both = await loadDevelopmentBoard(db.client as never, O, { customerId: 'c1', development: 'OAK RIDGE' })
    expect(both.lots.map((l) => l.propertyId)).toEqual(['p1'])
    expect(both.options.developments).toEqual(['Oak Ridge', 'Pine Hollow']) // the builder's own developments
    expect(both.total).toBe(1)
    expect(both.truncated).toBe(false)
  })
})

describe('Before you: only current jobs at the property', () => {
  const wo = (id: string, job: string, trade: string, status: string, over = {}) => ({ id, org_id: O, job_id: job, property_id: 'p1', trade, work_order_type: 'install', status, scheduled_date: null, completed_at: status === 'completed' ? '2026-11-02T12:00:00Z' : null, ...over })
  const seed = () => ({
    work_orders: [
      wo('me', 'jNow', 'sod', 'pending'),
      wo('a', 'jNow', 'grading', 'completed'),
      wo('old', 'jOld', 'grading', 'completed'),
      wo('dead', 'jDead', 'grading', 'pending'),
    ],
    production_jobs: [
      { id: 'jNow', org_id: O, status: 'scheduled', cancelled_at: null },
      { id: 'jOld', org_id: O, status: 'collected', cancelled_at: null },
      { id: 'jDead', org_id: O, status: 'sold', cancelled_at: '2026-11-03T00:00:00Z' },
    ],
    job_stages: [],
  })
  it('ignores crews on cancelled jobs and on closed-out older jobs', async () => {
    const db = createFakeDb(seed())
    const out = await loadBeforeYou(db.client as never, O, [{ id: 'me', job_id: 'jNow', property_id: 'p1', trade: 'sod' }])
    expect(out.get('me')).toEqual([{ trade: 'grading', label: 'Grading', done: true, date: '2026-11-02' }])
    const t = seed()
    t.work_orders = t.work_orders.filter((w) => w.id !== 'a')
    const only = await loadBeforeYou(createFakeDb(t).client as never, O, [{ id: 'me', job_id: 'jNow', property_id: 'p1', trade: 'sod' }])
    expect(only.get('me')).toBeUndefined() // the old closed job's grading and the cancelled job's grading say nothing
  })
})

describe('Jobs to schedule: lot jobs are summarized per development', () => {
  const job = (id: string, property: string | null, over = {}) => ({ id, org_id: O, job_number: `26-${id}`, address_text: 'x', status: 'sold', scheduled_date: null, cancelled_at: null, sale_date: null, property_id: property, ...over })
  const seed = () => ({
    properties: [prop('p1', 'c1', 'Oak Ridge', '1'), prop('p2', 'c1', 'oak ridge', '2'), prop('p3', 'c1', 'Pine Hollow', '3'), { id: 'p9', org_id: O, customer_id: 'c1', community: null, lot: null, address_text: 'Home', active: true }],
    production_jobs: [job('j1', 'p1'), job('j2', 'p2'), job('j3', 'p3'), job('j4', 'p9'), job('j5', null), job('j6', 'p1', { status: 'cancelled' }), job('j7', 'p1', { scheduled_date: '2026-12-01' })],
    work_orders: [],
  })
  it('counts only open lot jobs without a date, grouped by development', async () => {
    const lots = await loadLotJobsToSchedule(createFakeDb(seed()).client as never, O)
    expect(lots.byDevelopment).toEqual([{ name: 'Oak Ridge', count: 2 }, { name: 'Pine Hollow', count: 1 }])
    expect(lots.jobIds.size).toBe(3)
    expect(lotSummaryText('Oak Ridge', 40)).toBe('Oak Ridge: 40 lots to schedule')
    expect(lotSummaryText('Oak Ridge', 1)).toBe('Oak Ridge: 1 lot to schedule')
  })
  it('the queue shows "Oak Ridge: 2 lots to schedule" and the other jobs as before, not a row per lot', async () => {
    const [q] = await loadOpsQueues(createFakeDb(seed()).client as never, O, { only: 'jobs-to-schedule' })
    expect(q.items.map((i) => i.ref)).toEqual(['Oak Ridge: 2 lots to schedule', 'Pine Hollow: 1 lot to schedule', 'Job 26-j4', 'Job 26-j5'])
  })
})

describe('Lot jobs are not sales', () => {
  it('payroll: a lot job (no sale date, no amount, no salesperson) is never eligible, and the planner only reads jobs with a sale date', () => {
    const lotJob = { id: 'j', job_number: '26-1', status: 'complete', sale_date: null, sale_amount: null, commission_comp_base: null, commission_pre_tax_subtotal: null, dealer_fee_amount: null, salesperson_id: null, project_id: 'p', completed_at: '2026-11-10T12:00:00Z', allow_close_with_balance: null, close_balance_by: null, close_balance_at: null }
    const e = derivePayrollEligibility({ job: lotJob as never, payments: [], costs: [] })
    expect(e.eligibleAt).toBeNull()
    const src = readFileSync('lib/payroll-period-materialization.ts', 'utf8')
    expect(src).toMatch(/\.not\('sale_date', 'is', null\)/)
  })
  it('the creator sets none of the sale fields', () => {
    const src = readFileSync('lib/lots-db.ts', 'utf8')
    const insert = src.slice(src.indexOf('const jobRow ='), src.indexOf('let job:'))
    for (const k of ['sale_date', 'sale_amount', 'salesperson_id', 'commission', 'accepted_proposal_id', 'job_source']) expect(insert).not.toContain(k)
  })
})
