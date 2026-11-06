/**
 * Job catch-up loader: thread visibility goes through the thread's own rule, the board costs a fixed number of
 * queries whatever the job count, and when the org has it OFF the board gets nothing new (one settings read).
 */
import type { ThreadViewer } from '@/lib/threads/visibility'

const viewerFor: { current: ThreadViewer } = { current: null as never }
jest.mock('@/lib/threads/viewer', () => ({ resolveThreadViewer: jest.fn(async () => viewerFor.current) }))

import { attachBoardCatchUps, jobCatchUpDeps, loadJobCatchUps } from '@/lib/job-catch-up-db'
import { deriveMaterialsState, type MaterialsState } from '@/lib/job-materials-state'
import { createFakeDb } from '@/lib/test-helpers/fake-db'

// The Materials tab's own answer per job (lib/supplier-orders.ts) — stubbed; default = the stored status.
const materialsCalls: string[] = []
let materialsFor: (jobId: string, stored: string | null) => MaterialsState = (_id, stored) => deriveMaterialsState({ stored })
jobCatchUpDeps.materialsState = async (_admin, _org, jobId, stored) => {
  materialsCalls.push(jobId)
  return materialsFor(jobId, stored)
}

const ORG = 'org-1'
const NOW = new Date('2026-11-06T15:00:00Z')

const OPS: ThreadViewer = { userId: 'ops1', orgId: ORG, ownerLike: false, jobBoard: true, jobEdit: true, jobFinancials: false, managerLike: true, closerLike: false, setterLike: false, pricingBarred: false }
const SETTER: ThreadViewer = { userId: 'set1', orgId: ORG, ownerLike: false, jobBoard: false, jobEdit: false, jobFinancials: false, managerLike: false, closerLike: false, setterLike: true, pricingBarred: true }
const opsProfile = { id: 'ops1', org_id: ORG, role: 'operations' }

function seed(jobCount: number, opts: { enabled?: boolean } = {}) {
  const t: Record<string, Array<Record<string, unknown>>> = {
    orgs: [{ id: ORG, settings: { job_catch_up_enabled: opts.enabled ?? true, job_catch_up_stuck_days: 7 } }],
    production_jobs: [], projects: [], opportunities: [], work_orders: [], activities: [], job_payments: [], supplier_orders: [], users: [{ id: 'u-dana', org_id: ORG, full_name: 'Dana Example' }],
  }
  for (let i = 0; i < jobCount; i++) {
    const n = String(i).padStart(3, '0')
    t.production_jobs.push({
      id: `j${n}`, org_id: ORG, job_number: `26-${n}`, status: 'scheduled', project_id: `p${n}`, customer_id: `c${n}`, sale_amount: 16325,
      scheduled_date: '2026-11-12', materials_status: 'ordered', permit_required: true, permit_status: 'pending',
      created_at: '2026-10-20T12:00:00Z', updated_at: '2026-10-20T12:00:00Z', commission_comp_base: 16325, salesperson_id: 'closer1', owner_user_id: null,
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

/**
 * Counts table reads. `ownerColumnMissing` makes any production_jobs select naming owner_user_id fail the way PostgREST
 * does before the owner migration is applied.
 */
function counted(tables: Record<string, Array<Record<string, unknown>>>, opts: { ownerColumnMissing?: boolean } = {}) {
  const db = createFakeDb(tables)
  const calls: string[] = []
  const client = db.client as unknown as { from: (t: string) => { select: (c?: string) => unknown }; rpc: unknown }
  const wrapped = {
    ...client,
    from: (t: string) => {
      calls.push(t)
      const b = client.from(t)
      if (!opts.ownerColumnMissing || t !== 'production_jobs') return b
      const select = b.select.bind(b)
      return { ...b, select: (cols?: string) => {
        if (String(cols ?? '').includes('owner_user_id')) {
          const fail = { data: null, error: { code: '42703', message: 'column production_jobs.owner_user_id does not exist' } }
          const chain: Record<string, unknown> = { then: (res: (v: unknown) => unknown) => Promise.resolve(fail).then(res) }
          for (const m of ['eq', 'in', 'is', 'neq', 'order', 'range']) chain[m] = () => chain
          return chain
        }
        return select(cols)
      } }
    },
  }
  return { client: wrapped as never, calls }
}

beforeEach(() => {
  viewerFor.current = OPS
  materialsCalls.length = 0
  materialsFor = (_id, stored) => deriveMaterialsState({ stored })
})

describe('loadJobCatchUps', () => {
  it('ops viewer: line + box from visible notes only; sales talk, removed and pricing text never shown', async () => {
    const { client } = counted(seed(1))
    const c = (await loadJobCatchUps(client, ORG, opsProfile, ['j000'], { stuckDays: 7, showPayment: true, now: NOW })).get('j000')!
    expect(c.line).toBe('No owner · Waiting on permit · 2d')
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
    // Last movement: the payment on Sun Oct 25 (this viewer sees payments) → Fri Nov 6 = 10 working days.
    expect(c.reasons).toEqual(["Crew starts 2026-11-08 and the permit isn't approved yet.", 'Nothing has moved in 10 working days.'])
    expect(c.owner).toBe('No owner')
  })

  it('board cost is a fixed number of queries: 3 jobs and 30 jobs read the same tables the same number of times', async () => {
    const small = counted(seed(3))
    await loadJobCatchUps(small.client, ORG, opsProfile, ['j000', 'j001', 'j002'], { stuckDays: 7, showPayment: true, now: NOW })
    materialsCalls.length = 0
    const big = counted(seed(30))
    await loadJobCatchUps(big.client, ORG, opsProfile, Array.from({ length: 30 }, (_, i) => `j${String(i).padStart(3, '0')}`), { stuckDays: 7, showPayment: true, now: NOW })
    expect(big.calls.length).toBe(small.calls.length)
    expect(big.calls.sort()).toEqual(small.calls.sort())
    // Record the number so a regression to per-job queries is obvious in review.
    // 16 here (thread viewer resolution is mocked; live adds its permission reads + proposals when present).
    // Owner names: one more read only when some job has an owner.
    expect(big.calls.length).toBe(16)
    // The company's trade labels: read once, shared by data health and catch-up (cached per client).
    expect(big.calls.filter((t) => t === 'org_trades')).toHaveLength(1)
    // Crews and payments are read once (by data health) and reused — never a second time by catch-up.
    expect(big.calls.filter((t) => t === 'work_orders')).toHaveLength(1)
    expect(big.calls.filter((t) => t === 'job_payments')).toHaveLength(1)
    expect(big.calls.filter((t) => t === 'job_change_orders')).toHaveLength(1)
    // The Materials-tab answer is the one per-job read, and only for sold / materials / scheduled jobs.
    // The full Materials answer is capped at 25 jobs per board load; the rest use the recorded status.
    expect(materialsCalls).toHaveLength(25)
  })
})

describe('loadJobCatchUps — review fixes', () => {
  const load = (tables: ReturnType<typeof seed>, opts: { showPayment?: boolean; ownerColumnMissing?: boolean } = {}) =>
    loadJobCatchUps(counted(tables, { ownerColumnMissing: opts.ownerColumnMissing }).client, ORG, opsProfile, ['j000'], { stuckDays: 7, showPayment: opts.showPayment ?? true, now: NOW }).then((m) => m.get('j000')!)

  it('materials: 1 of 2 supplier orders sent → "Finish ordering materials (1 of 2 ordered)", same as the Materials tab', async () => {
    const tables = seed(1)
    tables.production_jobs[0].permit_status = 'approved'
    tables.production_jobs[0].status = 'materials'
    tables.production_jobs[0].materials_status = 'ordered' // the mirror after the first send
    materialsFor = () => deriveMaterialsState({ stored: 'ordered', suppliers: { rollup: { covered: 1, total: 2, allCovered: false }, sentOrders: [{ receivedAt: null }] } })
    const c = await load(tables)
    expect(c.nextStep).toBe('Finish ordering materials (1 of 2 ordered)')
  })

  it("crew wording uses the company's own trade name (org_trades), not a fixed list", async () => {
    const tables = seed(1)
    tables.production_jobs[0].permit_status = 'approved'
    materialsFor = () => deriveMaterialsState({ stored: 'ordered' })
    tables.org_trades = [{ org_id: ORG, slug: 'roofing', label: 'Roof replacement', sort: 10, active: true, match_keywords: null }]
    const c = await load(tables)
    expect(JSON.stringify(c)).toContain('Roof replacement crew')
    expect(JSON.stringify(c)).not.toContain('Roofing crew')
  })

  it('materials: a failed supplier-plan read falls back to the recorded status, never breaks the line', async () => {
    const tables = seed(1)
    tables.production_jobs[0].permit_status = 'approved'
    tables.production_jobs[0].materials_status = 'not_ordered'
    materialsFor = () => { throw new Error('run sheet failed') }
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    expect((await load(tables)).nextStep).toBe('Order materials')
    spy.mockRestore()
  })

  it('"Payment recorded" is an event only when the viewer sees payments', async () => {
    const tables = seed(1)
    tables.activities = []
    tables.work_orders[0].updated_at = '2026-10-20T12:00:00Z'
    tables.work_orders[0].created_at = '2026-10-20T12:00:00Z'
    const shown = await load(tables, { showPayment: true })
    expect(shown.lastUpdate?.what).toBe('Payment recorded')
    const hidden = await load(tables, { showPayment: false })
    expect(JSON.stringify(hidden)).not.toMatch(/Payment recorded/)
    expect(hidden.lastUpdate?.what).not.toBe('Payment recorded')
  })

  it('an automated write (schedule sync / materials mirror) bumping updated_at today does not reset the clock', async () => {
    const tables = seed(1)
    tables.activities = []
    tables.job_payments = []
    tables.production_jobs[0].updated_at = '2026-11-06T14:30:00Z'
    const c = await load(tables)
    expect(c.lastUpdate?.what).toMatch(/crew scheduled/)
    expect(c.stuck).toBe(true)
    expect(c.reasons).toContain('Nothing has moved in 11 working days.')
  })

  it('photos and signed change orders are movement', async () => {
    const tables = seed(1)
    tables.activities = []
    ;(tables as Record<string, Array<Record<string, unknown>>>).photos = [{ id: 'ph1', org_id: ORG, job_id: 'j000', created_at: '2026-11-05T15:00:00Z', deleted_at: null }]
    ;(tables as Record<string, Array<Record<string, unknown>>>).job_change_orders = [{ id: 'co1', org_id: ORG, job_id: 'j000', status: 'completed', co_number: 2, original_amount: 100, updated_total: 200, is_commissionable: true, customer_signed_at: '2026-11-06T13:00:00Z' }]
    const c = await load(tables)
    expect(c.recent.slice(0, 2).map((u) => u.what)).toEqual(['Change order 2 signed', 'Photo added'])
    expect(JSON.stringify(c)).not.toMatch(/\$|200/)
  })

  it('a customer inbound text is labeled "Customer" (not "Automated") and is not movement', async () => {
    const tables = seed(1)
    tables.activities.push({ id: 'in1', org_id: ORG, opportunity_id: 'o000', user_id: null, type: 'text', origin: null, body: 'When are you coming?', created_at: '2026-11-06T13:00:00Z', audience: 'team', restricted_pricing: false, deleted_at: null, users: null })
    const c = await load(tables)
    expect(c.recent[0]).toMatchObject({ who: 'Customer', kind: 'customer', what: 'Text: When are you coming?' })
    expect(c.lastUpdate?.what).toBe('Permit office says Monday.')
  })

  it('explicit owner: shown by name and used on the line', async () => {
    const tables = seed(1)
    tables.production_jobs[0].owner_user_id = 'u-dana'
    const c = await load(tables)
    expect(c).toMatchObject({ owner: 'Dana', ownerKind: 'assigned', ownerUserId: 'u-dana' })
    expect(c.line).toBe('Dana · Waiting on permit · 2d')
  })

  it('no owner set (column present) → "No owner"', async () => {
    expect(await load(seed(1))).toMatchObject({ owner: 'No owner', ownerKind: 'unassigned', ownerUserId: null })
  })

  it('before the owner migration: the column is missing → owner unknown (no "No owner" flag), no error', async () => {
    const c = await load(seed(1), { ownerColumnMissing: true })
    expect(c).toMatchObject({ owner: '', ownerKind: 'unknown', ownerUserId: null })
    expect(c.line).toBe('Waiting on permit · 2d')
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
    expect(jobs[0].catch_up?.line).toBe('No owner · Waiting on permit · 2d')
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
