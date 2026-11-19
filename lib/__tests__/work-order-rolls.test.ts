/** @jest-environment node */
import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { fakeServicePlanRpc } from '@/lib/test-helpers/fake-service-plan-rpc'
import { applyVisitAction, bulkShiftVisits, createServicePlan, loadVisits } from '@/lib/service-plans-db'
import { loadRollCounts, loadWorkOrderRollCounts, recordWorkOrderMoves } from '@/lib/work-order-moves-db'
import { rollWorkOrder } from '@/lib/work-order-roll'
import { parseRollReason, rolledLabel, rollTargetDay } from '@/lib/work-order-rolls'
import { DEFAULT_TIMEZONE } from '@/lib/timezone'

jest.mock('@/lib/cron-orgs', () => ({ loadOrgTimeZone: async () => 'America/New_York' }))

describe('rollTargetDay (date-only: daylight saving cannot shift it)', () => {
  it.each([
    ['a Tuesday rolls to Wednesday', '2026-11-10', '2026-11-10', '2026-11-11'],
    ['a Friday rolls to Monday', '2026-11-13', '2026-11-10', '2026-11-16'],
    ['a Saturday rolls to Monday', '2026-11-14', '2026-11-10', '2026-11-16'],
    ['a Sunday rolls to Monday', '2026-11-15', '2026-11-10', '2026-11-16'],
    ['work left on a passed day rolls from today, never into the past', '2026-11-04', '2026-11-10', '2026-11-11'],
    // Spring forward: Sunday 2026-03-08.
    ['March: Friday before spring-forward → Monday after', '2026-03-06', '2026-03-06', '2026-03-09'],
    ['March: Saturday → Monday across the change', '2026-03-07', '2026-03-07', '2026-03-09'],
    ['March: Monday after the change → Tuesday', '2026-03-09', '2026-03-09', '2026-03-10'],
    // Fall back: Sunday 2026-11-01.
    ['November: Friday before fall-back → Monday after', '2026-10-30', '2026-10-30', '2026-11-02'],
    ['November: Saturday → Monday across the change', '2026-10-31', '2026-10-31', '2026-11-02'],
    ['November: Sunday of the change → Monday', '2026-11-01', '2026-11-01', '2026-11-02'],
  ])('%s', (_n, scheduled, today, want) => {
    expect(rollTargetDay(scheduled, today)).toBe(want)
  })
})

describe('reasons and labels', () => {
  it('parses a known reason, none, and refuses anything else', () => {
    expect(parseRollReason('weather')).toBe('weather')
    expect(parseRollReason(undefined)).toBeNull()
    expect(parseRollReason('')).toBeNull()
    expect(parseRollReason('lunch')).toEqual({ error: 'Pick one of the reasons' })
  })
  it('rolledLabel shows nothing until it has rolled', () => {
    expect(rolledLabel(0)).toBeNull()
    expect(rolledLabel(null)).toBeNull()
    expect(rolledLabel(3)).toBe('Rolled 3×')
  })
})

const ORG = 'org-a'
const NOW = new Date('2026-11-10T15:00:00Z') // Tuesday 10:00 in New York

/** Test-only stand-in for record_work_order_moves (202611300170): logs and bumps for a later-day move. */
const calls: Array<Record<string, unknown>> = []
const recordRpc = (args: Record<string, unknown>, t: Record<string, Array<Record<string, unknown>>>) => {
  calls.push(args)
  const wo = t.work_orders
  const log = (t.work_order_moves ??= [])
  for (const m of args.p_moves as Array<Record<string, unknown>>) {
    const w = wo.find((x) => x.id === m.work_order_id && x.org_id === args.p_org_id)
    if (!w) continue
    log.push({ org_id: args.p_org_id, ...m })
    if (m.from_date && String(m.to_date) > String(m.from_date)) w.roll_count = ((w.roll_count as number) ?? 0) + 1
  }
  return log.length
}

function seed() {
  calls.length = 0
  return createFakeDb(
    {
      orgs: [{ id: ORG, timezone: DEFAULT_TIMEZONE, settings: {} }],
      customers: [{ id: 'c1', org_id: ORG, name: 'Pat' }],
      properties: [{ id: 'p1', org_id: ORG, customer_id: 'c1', address_text: '1 Oak St', address_line1: '1 Oak St', city: 'X', state: 'FL', zip: '1', active: true }],
      org_trades: [{ org_id: ORG, slug: 'lawn', label: 'Lawn care', sort: 1, active: true, match_keywords: [] }],
      sub_contractors: [{ id: 's1', org_id: ORG, company_name: 'Crew One', active: true }, { id: 's2', org_id: ORG, company_name: 'Crew Two', active: true }],
      users: [{ id: 'u1', org_id: ORG, full_name: 'Office', active: true }],
      service_plans: [],
      work_orders: [],
      photos: [],
      service_plan_changes: [],
      service_visit_charges: [],
      crew_day_links: [],
      service_plan_templates: [],
      work_order_moves: [],
    },
    { rpc: { ...fakeServicePlanRpc, record_work_order_moves: recordRpc } }
  )
}

const weekly = { property_id: 'p1', trade: 'lawn', name: 'Weekly mowing', price: 45, billing_basis: 'per_visit', start_date: '2026-11-03', preferred_weekday: 2, default_sub_id: 's1', seasons: [{ from: '01-01', to: '12-31', frequency: 'weekly' }] }

async function withVisit() {
  const db = seed()
  await createServicePlan(db.client, ORG, 'u1', 'c1', weekly as never, NOW)
  const v = db.tables.work_orders.filter((w) => w.work_order_type === 'service_visit').sort((a, b) => String(a.scheduled_date).localeCompare(String(b.scheduled_date)))[0]
  return { db, v }
}

describe('the move writers log and count', () => {
  it('recordWorkOrderMoves skips a no-change move and never throws', async () => {
    const db = seed()
    await recordWorkOrderMoves(db.client, ORG, [{ workOrderId: 'w1', from: '2026-11-10', to: '2026-11-10', kind: 'move' }])
    expect(calls).toHaveLength(0)
    const broken = { rpc: async () => { throw new Error('down') } } as never
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    await expect(recordWorkOrderMoves(broken, ORG, [{ workOrderId: 'w1', from: '2026-11-10', to: '2026-11-11', kind: 'move' }])).resolves.toBeUndefined()
    spy.mockRestore()
  })

  it('applyVisitAction move logs the move with its reason and counts a later-day roll', async () => {
    const { db, v } = await withVisit()
    const res = await applyVisitAction(db.client, ORG, String(v.id), { action: 'move', date: '2026-11-12', reason: 'weather' }, { userId: 'u1', subId: null }, { now: NOW })
    expect(res.ok).toBe(true)
    expect(db.tables.work_order_moves).toEqual([expect.objectContaining({ work_order_id: v.id, from_date: '2026-11-10', to_date: '2026-11-12', reason: 'weather', kind: 'move', moved_by: 'u1' })])
    expect(v.roll_count).toBe(1)
    // Pulling it EARLIER is logged but not a roll.
    await applyVisitAction(db.client, ORG, String(v.id), { action: 'move', date: '2026-11-11' }, { userId: 'u1', subId: null }, { now: NOW })
    expect(db.tables.work_order_moves).toHaveLength(2)
    expect(v.roll_count).toBe(1)
  })

  it('bulkShiftVisits logs every visit it moves as a weather shift', async () => {
    const { db, v } = await withVisit()
    const day = String(v.scheduled_date)
    const res = await bulkShiftVisits(db.client, ORG, { from: day, to: day, days: 1, subId: 'all' }, { now: NOW, userId: 'u1' })
    expect(res).toEqual({ moved: 1 })
    expect(db.tables.work_order_moves).toEqual([expect.objectContaining({ work_order_id: v.id, kind: 'shift', reason: 'weather', moved_by: 'u1' })])
    expect(v.roll_count).toBe(1)
  })
})

describe('rollWorkOrder — a service visit', () => {
  it('moves to the next working day through the visit writer, with the reason, and says how many rolls', async () => {
    const { db, v } = await withVisit()
    db.tables.work_orders.forEach((w) => w === v || (w.scheduled_date = '2027-01-01'))
    v.scheduled_date = '2026-11-13' // a Friday
    const res = await rollWorkOrder(db.client, ORG, String(v.id), { reason: 'site_not_ready', by: { userId: 'u1', subId: null }, schedulingUserId: 'u1', now: NOW })
    expect(res).toEqual({ ok: true, from: '2026-11-13', to: '2026-11-16', rolls: 1 })
    expect(v.scheduled_date).toBe('2026-11-16')
    expect(db.tables.work_order_moves).toEqual([expect.objectContaining({ reason: 'site_not_ready', kind: 'roll', from_date: '2026-11-13', to_date: '2026-11-16' })])
  })

  it('a crew can roll only its own visits, and only scheduled ones', async () => {
    const { db, v } = await withVisit()
    const other = await rollWorkOrder(db.client, ORG, String(v.id), { reason: null, by: { userId: null, subId: 's2' }, schedulingUserId: '', onlySubId: 's2', now: NOW })
    expect(other).toMatchObject({ ok: false, status: 404 })
    v.status = 'completed'
    expect(await rollWorkOrder(db.client, ORG, String(v.id), { reason: null, by: { userId: 'u1', subId: null }, schedulingUserId: 'u1', now: NOW })).toMatchObject({ ok: false, status: 409 })
    expect(await rollWorkOrder(db.client, 'org-b', String(v.id), { reason: null, by: { userId: 'u1', subId: null }, schedulingUserId: 'u1', now: NOW })).toMatchObject({ ok: false, status: 404 })
  })

  it('loaders: roll counts per work order and per job (for invoicing)', async () => {
    const db = seed()
    db.tables.work_orders.push(
      { id: 'a', org_id: ORG, job_id: 'j1', roll_count: 2 },
      { id: 'b', org_id: ORG, job_id: 'j1', roll_count: 1 },
      { id: 'c', org_id: ORG, job_id: 'j2', roll_count: 0 },
      { id: 'd', org_id: 'org-b', job_id: 'j1', roll_count: 9 }
    )
    expect(Array.from(await loadWorkOrderRollCounts(db.client, ORG, ['a', 'b', 'c', 'd']))).toEqual([['a', 2], ['b', 1]])
    expect(Array.from(await loadRollCounts(db.client, ORG, ['j1', 'j2']))).toEqual([['j1', { rolls: 3, workOrders: 2 }]])
  })
})

describe('visits carry their roll count', () => {
  it('loadVisits shows rolls on each visit', async () => {
    const { db, v } = await withVisit()
    v.roll_count = 3
    const day = String(v.scheduled_date)
    const [first] = await loadVisits(db.client, ORG, { from: day, to: day, accessNotes: false })
    expect(first.rolls).toBe(3)
  })
})
