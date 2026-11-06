/**
 * Job catch-up loader: thread visibility goes through the thread's own rule, the board costs a fixed number of
 * queries whatever the job count, and when the org has it OFF the board gets nothing new (one settings read).
 */
import type { ThreadViewer } from '@/lib/threads/visibility'

const viewerFor: { current: ThreadViewer } = { current: null as never }
jest.mock('@/lib/threads/viewer', () => ({ resolveThreadViewer: jest.fn(async () => viewerFor.current) }))

import { attachBoardCatchUps, loadJobCatchUps } from '@/lib/job-catch-up-db'
import { createFakeDb } from '@/lib/test-helpers/fake-db'

const ORG = 'org-1'
const NOW = new Date('2026-11-06T15:00:00Z')

const OPS: ThreadViewer = { userId: 'ops1', orgId: ORG, ownerLike: false, jobBoard: true, jobEdit: true, jobFinancials: false, managerLike: true, closerLike: false, setterLike: false, pricingBarred: false }
const SETTER: ThreadViewer = { userId: 'set1', orgId: ORG, ownerLike: false, jobBoard: false, jobEdit: false, jobFinancials: false, managerLike: false, closerLike: false, setterLike: true, pricingBarred: true }
const opsProfile = { id: 'ops1', org_id: ORG, role: 'operations' }

function seed(jobCount: number, opts: { enabled?: boolean } = {}) {
  const t: Record<string, Array<Record<string, unknown>>> = {
    orgs: [{ id: ORG, settings: { job_catch_up_enabled: opts.enabled ?? true, job_catch_up_stuck_days: 7 } }],
    production_jobs: [], projects: [], opportunities: [], work_orders: [], activities: [], job_payments: [], supplier_orders: [],
  }
  for (let i = 0; i < jobCount; i++) {
    const n = String(i).padStart(3, '0')
    t.production_jobs.push({
      id: `j${n}`, org_id: ORG, job_number: `26-${n}`, status: 'scheduled', project_id: `p${n}`, customer_id: `c${n}`, sale_amount: 16325,
      scheduled_date: '2026-11-12', materials_status: 'ordered', permit_required: true, permit_status: 'pending',
      created_at: '2026-10-20T12:00:00Z', updated_at: '2026-10-20T12:00:00Z', commission_comp_base: 16325, salesperson_id: 'closer1',
    })
    t.projects.push({ id: `p${n}`, org_id: ORG, opportunity_id: `o${n}` })
    t.opportunities.push({ id: `o${n}`, org_id: ORG, owner_user_id: 'closer1', setter_user_id: 'set1', is_self_generated: false })
    t.work_orders.push({ id: `w${n}`, org_id: ORG, job_id: `j${n}`, trade: 'roofing', status: 'scheduled', scheduled_date: '2026-11-12', install_days: 1, created_at: '2026-10-21T12:00:00Z', updated_at: '2026-10-22T12:00:00Z', completed_at: null, assigned_sub: { company_name: 'Ridgeline Roofing LLC' } })
    t.job_payments.push({ id: `pay${n}`, job_id: `j${n}`, amount_cents: 500000, funding_status: 'cleared', created_at: '2026-10-25T12:00:00Z' })
    t.activities.push(
      { id: `a${n}-prod`, org_id: ORG, opportunity_id: `o${n}`, user_id: 'steve', type: 'note', origin: 'human', body: 'Permit office says Monday.', created_at: '2026-11-04T14:00:00Z', audience: 'production', restricted_pricing: false, deleted_at: null, users: { full_name: 'Steve Potts' } },
      { id: `a${n}-sales`, org_id: ORG, opportunity_id: `o${n}`, user_id: 'closer1', type: 'note', origin: 'human', body: 'Sales chatter', created_at: '2026-11-05T14:00:00Z', audience: 'sales', restricted_pricing: false, deleted_at: null, users: { full_name: 'Nathan Hall' } },
      { id: `a${n}-del`, org_id: ORG, opportunity_id: `o${n}`, user_id: 'steve', type: 'note', origin: 'human', body: 'removed', created_at: '2026-11-06T13:00:00Z', audience: 'team', restricted_pricing: false, deleted_at: '2026-11-06T13:05:00Z', users: { full_name: 'Steve Potts' } },
      { id: `a${n}-price`, org_id: ORG, opportunity_id: `o${n}`, user_id: 'andrew', type: 'note', origin: 'human', body: 'Deposit of $4,000 came in', created_at: '2026-11-03T14:00:00Z', audience: 'team', restricted_pricing: false, deleted_at: null, users: { full_name: 'Andrew Waltz' } },
      { id: `a${n}-call`, org_id: ORG, opportunity_id: `o${n}`, user_id: 'andrew', type: 'call', origin: null, body: 'Customer asked about start time', created_at: '2026-11-02T14:00:00Z', audience: null, restricted_pricing: false, deleted_at: null, users: { full_name: 'Andrew Waltz' } },
    )
  }
  return t
}

function counted(tables: Record<string, Array<Record<string, unknown>>>) {
  const db = createFakeDb(tables)
  const calls: string[] = []
  const client = db.client as unknown as { from: (t: string) => unknown; rpc: unknown }
  const wrapped = { ...client, from: (t: string) => { calls.push(t); return client.from(t) } }
  return { client: wrapped as never, calls }
}

beforeEach(() => { viewerFor.current = OPS })

describe('loadJobCatchUps', () => {
  it('ops viewer: line + box from visible notes only; sales talk, removed and pricing text never shown', async () => {
    const { client } = counted(seed(1))
    const c = (await loadJobCatchUps(client, ORG, opsProfile, ['j000'], { stuckDays: 7, showPayment: true, now: NOW })).get('j000')!
    expect(c.line).toBe('Steve · Waiting on permit · 2d')
    expect(c.stuck).toBe(false)
    expect(c.lastContact).toMatchObject({ who: 'Andrew Waltz', what: 'Call: Customer asked about start time' })
    expect(c.recent.map((u) => u.what)).toEqual(['Permit office says Monday.', 'mentions pricing — open the thread', 'Call: Customer asked about start time'])
    const text = JSON.stringify(c)
    expect(text).not.toMatch(/Sales chatter|removed|\$|4,000|16325|16,325/)
    expect(c.threadHref).toBe('/c/c000/d/o000/notes')
  })

  it('a field-role viewer (should never get here) still cannot see Production notes through catch-up', async () => {
    viewerFor.current = SETTER
    const { client } = counted(seed(1))
    const c = (await loadJobCatchUps(client, ORG, { id: 'set1', org_id: ORG, role: 'setter' }, ['j000'], { stuckDays: 7, showPayment: false, now: NOW })).get('j000')!
    expect(JSON.stringify(c)).not.toMatch(/Permit office/)
  })

  it('payment words only when the caller says the viewer sees them', async () => {
    const tables = seed(1)
    tables.production_jobs[0].status = 'complete'
    const shown = (await loadJobCatchUps(counted(tables).client, ORG, opsProfile, ['j000'], { stuckDays: 7, showPayment: true, now: NOW })).get('j000')!
    expect(shown.nextStep).toBe('Waiting on payment')
    const hidden = (await loadJobCatchUps(counted(tables).client, ORG, opsProfile, ['j000'], { stuckDays: 7, showPayment: false, now: NOW })).get('j000')!
    expect(hidden.nextStep).toBe('Close out the job')
  })

  it('stuck: Needs-you ops rule (permit pending with the crew starting soon) and idle days', async () => {
    const tables = seed(1)
    tables.production_jobs[0].scheduled_date = '2026-11-08'
    tables.work_orders[0].scheduled_date = '2026-11-08'
    tables.activities = []
    const c = (await loadJobCatchUps(counted(tables).client, ORG, opsProfile, ['j000'], { stuckDays: 7, showPayment: true, now: NOW })).get('j000')!
    expect(c.stuck).toBe(true)
    expect(c.reasons).toEqual(["Crew starts 2026-11-08 and the permit isn't approved yet.", 'Nothing has moved in 12 days.'])
    expect(c.owner).toBe('Office')
  })

  it('board cost is a fixed number of queries: 3 jobs and 30 jobs read the same tables the same number of times', async () => {
    const small = counted(seed(3))
    await loadJobCatchUps(small.client, ORG, opsProfile, ['j000', 'j001', 'j002'], { stuckDays: 7, showPayment: true, now: NOW })
    const big = counted(seed(30))
    await loadJobCatchUps(big.client, ORG, opsProfile, Array.from({ length: 30 }, (_, i) => `j${String(i).padStart(3, '0')}`), { stuckDays: 7, showPayment: true, now: NOW })
    expect(big.calls.length).toBe(small.calls.length)
    expect(big.calls.sort()).toEqual(small.calls.sort())
    // Record the number so a regression to per-job queries is obvious in review.
    // 16 here (thread viewer resolution is mocked; live adds its permission reads + proposals/photos when present).
    expect(big.calls.length).toBe(16)
  })
})

describe('attachBoardCatchUps', () => {
  it('OFF: one settings read, no catch_up on any job — the board renders exactly as before', async () => {
    const { client, calls } = counted(seed(3, { enabled: false }))
    const jobs = [{ id: 'j000', status: 'scheduled' }, { id: 'j001', status: 'sold' }]
    const before = JSON.stringify(jobs)
    const r = await attachBoardCatchUps(client, ORG, opsProfile, jobs, NOW)
    expect(r).toEqual({ enabled: false, stuckDays: 7, failed: false })
    expect(calls).toEqual(['orgs'])
    expect(JSON.stringify(jobs)).toBe(before)
  })

  it('ON: open jobs get a line; collected and cancelled jobs do not', async () => {
    const tables = seed(3)
    tables.production_jobs[2].status = 'collected'
    const jobs = [{ id: 'j000', status: 'scheduled' }, { id: 'j001', status: 'cancelled' }, { id: 'j002', status: 'collected' }] as Array<{ id: string; status: string; catch_up?: { line: string } }>
    const r = await attachBoardCatchUps(counted(tables).client, ORG, opsProfile, jobs, NOW)
    expect(r.enabled).toBe(true)
    expect(jobs[0].catch_up?.line).toBe('Steve · Waiting on permit · 2d')
    expect(jobs[1].catch_up).toBeUndefined()
    expect(jobs[2].catch_up).toBeUndefined()
  })

  it('a failed load never takes the board down', async () => {
    const { client } = counted(seed(1))
    const broken = { ...(client as object), from: (t: string) => (t === 'orgs' ? (client as unknown as { from: (x: string) => unknown }).from(t) : (() => { throw new Error('boom') })()) }
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const jobs = [{ id: 'j000', status: 'scheduled' }]
    expect(await attachBoardCatchUps(broken as never, ORG, opsProfile, jobs, NOW)).toEqual({ enabled: true, stuckDays: 7, failed: true })
    expect(jobs[0]).toEqual({ id: 'j000', status: 'scheduled' })
    spy.mockRestore()
  })
})
