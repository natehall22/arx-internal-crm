/** @jest-environment node */
import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { autoRollTargetDay } from '@/lib/work-order-rolls'
import { DEFAULT_NIGHTLY_SETTINGS, inRunWindow, parseNightlyPatch, readNightlySettings } from '@/lib/schedule-nightly'

jest.mock('@/lib/supplier-orders', () => ({ refreshMaterialsOrderedFromSuppliers: jest.fn(async () => undefined) }))
jest.mock('@/lib/calendar/connection', () => {
  const actual = jest.requireActual('@/lib/calendar/connection')
  return { ...actual, getCalendarClient: jest.fn(async () => ({ provider: 'google', accessToken: 't', createEvent: async () => ({ id: 'e1' }), updateEvent: async () => ({}), deleteEvent: async () => undefined })) }
})
jest.mock('@/lib/cron-orgs', () => ({ loadOrgTimeZone: async () => 'America/New_York' }))
jest.mock('@/lib/push-apns', () => ({ sendPushToUserBackground: jest.fn() }))
const failNextRoll = { on: false }
jest.mock('@/lib/work-order-roll', () => {
  const actual = jest.requireActual('@/lib/work-order-roll')
  return { ...actual, rollWorkOrder: (...a: unknown[]) => { if (failNextRoll.on) { failNextRoll.on = false; throw new Error('boom') } return actual.rollWorkOrder(...a) } }
})
const mockVisits = jest.fn()
jest.mock('@/lib/service-plans-db', () => ({ ...jest.requireActual('@/lib/service-plans-db'), loadVisits: (...a: unknown[]) => mockVisits(...a) }))

const ORG = 'org-1'
const TZ = 'America/New_York'
const on = { scheduling: { autoRoll: { enabled: true, hour: 1 }, endOfDay: { enabled: true, hour: 18 } } }
const org = (settings: Record<string, unknown> | null = on) => ({ id: ORG, settings, timezone: TZ })

const visit = (id: string, over: Record<string, unknown> = {}) => ({ id, org_id: ORG, work_order_type: 'service_visit', visit_step: 'service', service_plan_id: 'p1', service_planned_date: '2026-11-13', status: 'scheduled', scheduled_date: '2026-11-13', updated_at: '2026-11-01T00:00:00Z', assigned_sub_id: 's1', trade: null, job_id: null, ...over })

function seed(over: Record<string, unknown> = {}) {
  return createFakeDb(
    {
      orgs: [{ id: ORG, phone: null, install_scheduling_user_id: null, install_scheduling_calendar_id: null, settings: {}, timezone: TZ }],
      org_trades: [{ org_id: ORG, slug: 'grading', label: 'Grading', sort: 1, active: true, match_keywords: [] }],
      production_jobs: [{ id: 'j1', org_id: ORG, job_number: '26-0201', customer_id: 'c1', job_type: 'grading', status: 'scheduled', address_text: '9 Lot Ln', scheduled_date: '2026-11-13', install_days: 1, assigned_sub_id: 's1', cancelled_at: null }],
      work_orders: [visit('w1')],
      service_plans: [{ id: 'p1', org_id: ORG, status: 'active', start_date: null, end_date: null, one_off: false }],
      sub_contractors: [{ id: 's1', org_id: ORG, company_name: 'Grade Crew', scheduling_email: 'g@example.test', active: true }],
      customers: [{ id: 'c1', name: 'Builder Co' }],
      time_entries: [],
      work_order_moves: [],
      notifications: [],
      crew_members: [],
      users: [],
      ...over,
    },
    {
      rpc: {
        record_work_order_moves: (args, t) => {
          for (const m of args.p_moves as Array<Record<string, unknown>>) (t.work_order_moves ??= []).push({ org_id: args.p_org_id, ...m })
          return 1
        },
      },
    }
  )
}

describe('pure rules', () => {
  it.each([
    ['a Friday morning stays Friday (it is a workday)', '2026-11-13', '2026-11-13'],
    ['Saturday → Monday (Fri work lands Monday)', '2026-11-14', '2026-11-16'],
    ['Sunday → Monday', '2026-11-15', '2026-11-16'],
    ['March: Monday after spring-forward', '2026-03-09', '2026-03-09'],
    ['March: Sunday of the change → Monday', '2026-03-08', '2026-03-09'],
    ['November: Sunday of fall-back → Monday', '2026-11-01', '2026-11-02'],
  ])('%s', (_n, today, want) => expect(autoRollTargetDay(today)).toBe(want))

  it('settings default OFF; a bad hour is refused; the window is the hour plus two', () => {
    expect(readNightlySettings(undefined)).toEqual(DEFAULT_NIGHTLY_SETTINGS)
    expect(readNightlySettings({ autoRoll: { enabled: true, hour: 99 } }).autoRoll).toEqual({ enabled: true, hour: 1 })
    expect(parseNightlyPatch({ scheduling: { autoRoll: { enabled: true, hour: 24 } } })).toEqual({ error: 'Pick an hour from 0 to 23' })
    expect(parseNightlyPatch({ scheduling: { endOfDay: { enabled: true, hour: 17 } } })).toEqual({ set: { endOfDay: { enabled: true, hour: 17 } } })
    expect([0, 1, 3, 4].map((h) => inRunWindow(h, 1))).toEqual([false, true, true, false])
  })

  it('the company midnight is DST-correct (March and November)', async () => {
    const { dayStartInstant } = await import('@/lib/schedule-nightly-db')
    expect(dayStartInstant('2026-03-08', TZ).toISOString()).toBe('2026-03-08T05:00:00.000Z')
    expect(dayStartInstant('2026-03-09', TZ).toISOString()).toBe('2026-03-09T04:00:00.000Z')
    expect(dayStartInstant('2026-11-01', TZ).toISOString()).toBe('2026-11-01T04:00:00.000Z')
    expect(dayStartInstant('2026-11-02', TZ).toISOString()).toBe('2026-11-02T05:00:00.000Z')
  })
})

describe('auto-roll', () => {
  const SAT_1AM = new Date('2026-11-14T06:00:00Z') // 01:00 EST, Saturday

  it('is off with nothing saved (any company that never turned it on): nothing moves', async () => {
    const db = seed()
    const { runAutoRollForOrg } = await import('@/lib/schedule-nightly-db')
    expect(await runAutoRollForOrg(db.client, org(null), SAT_1AM)).toEqual({ skipped: 'off' })
    expect(await runAutoRollForOrg(db.client, org({ scheduling: { autoRoll: { enabled: false, hour: 1 } } }), SAT_1AM)).toEqual({ skipped: 'off' })
    expect(db.tables.work_orders[0].scheduled_date).toBe('2026-11-13')
    expect(db.tables.work_order_moves).toHaveLength(0)
  })

  it('only runs inside the company-local hour window (00:30 local is too early; DST day included)', async () => {
    const db = seed()
    const { runAutoRollForOrg } = await import('@/lib/schedule-nightly-db')
    expect(await runAutoRollForOrg(db.client, org(), new Date('2026-11-14T05:30:00Z'))).toEqual({ skipped: 'not_time' }) // 00:30 EST
    expect(await runAutoRollForOrg(db.client, org(), new Date('2026-11-14T10:00:00Z'))).toEqual({ skipped: 'not_time' }) // 05:00 EST
  })

  it('Friday work rolls to Monday over the weekend; logged as auto_roll and NOT counted as a "Not ready" roll; a second run is a no-op', async () => {
    const db = seed()
    const { runAutoRollForOrg } = await import('@/lib/schedule-nightly-db')
    const { loadWorkOrderRollCounts } = await import('@/lib/work-order-moves-db')
    expect(await runAutoRollForOrg(db.client, org(), SAT_1AM)).toEqual({ candidates: 1, rolled: 1, left: 0, failed: 0 })
    expect(db.tables.work_orders[0].scheduled_date).toBe('2026-11-16')
    expect(db.tables.work_order_moves).toEqual([expect.objectContaining({ work_order_id: 'w1', kind: 'auto_roll', reason: null, from_date: '2026-11-13', to_date: '2026-11-16', moved_by: null, moved_by_sub_id: null })])
    expect(await runAutoRollForOrg(db.client, org(), SAT_1AM)).toEqual({ candidates: 0, rolled: 0, left: 0, failed: 0 })
    expect(db.tables.work_order_moves).toHaveLength(1)
    // The counter reads kind 'roll' only: the same fake table, queried the way the job page does.
    db.tables.work_order_moves.push({ org_id: ORG, work_order_id: 'w1', kind: 'roll', reason: 'builder_asked', id: 'm-roll' })
    expect((await loadWorkOrderRollCounts(db.client, ORG, ['w1'])).get('w1')).toBe(1)
  })

  it('a Monday-morning run lands Friday work on TODAY (Monday), in March and November across the clock change', async () => {
    const { runAutoRollForOrg } = await import('@/lib/schedule-nightly-db')
    for (const [now, from, to] of [
      ['2026-03-09T05:30:00Z', '2026-03-06', '2026-03-09'], // 01:30 EDT, the morning after spring-forward
      ['2026-11-02T06:30:00Z', '2026-10-30', '2026-11-02'], // 01:30 EST, the morning after fall-back
    ] as const) {
      const db = seed({ work_orders: [visit('w1', { scheduled_date: from })] })
      expect(await runAutoRollForOrg(db.client, org(), new Date(now))).toMatchObject({ rolled: 1 })
      expect(db.tables.work_orders[0].scheduled_date).toBe(to)
    }
  })

  it('leaves started work (clock time), work a person moved today, and work dated today or later', async () => {
    const db = seed({
      time_entries: [{ id: 't1', org_id: ORG, work_order_id: 'w1', removed_at: null }],
      work_orders: [
        visit('w1', { scheduled_date: '2026-11-12' }), // clocked
        visit('w2', { scheduled_date: '2026-11-12' }), // moved by a person today
        visit('w4', { scheduled_date: '2026-11-14' }), // today
        visit('w5', { scheduled_date: '2026-11-12', status: 'completed' }),
        visit('w6', { scheduled_date: '2026-11-12', status: 'cancelled' }),
      ],
      work_order_moves: [{ id: 'm1', org_id: ORG, work_order_id: 'w2', kind: 'move', moved_at: '2026-11-14T05:30:00Z' }],
    })
    const { runAutoRollForOrg } = await import('@/lib/schedule-nightly-db')
    const res = await runAutoRollForOrg(db.client, org(), SAT_1AM)
    expect(res).toMatchObject({ candidates: 2, rolled: 0, left: 2, failed: 0 })
    expect(db.tables.work_orders.map((w) => w.scheduled_date)).toEqual(['2026-11-12', '2026-11-12', '2026-11-14', '2026-11-12', '2026-11-12'])
  })

  it('never auto-rolls a trade / install work order (subs do not clock, so no clock time proves nothing)', async () => {
    const db = seed({ work_orders: [{ id: 'w1', org_id: ORG, job_id: 'j1', trade: 'grading', trade_source: 'manual', work_order_type: 'install', status: 'scheduled', assigned_sub_id: 's1', scheduled_date: '2026-11-12', install_days: 1 }] })
    const { runAutoRollForOrg } = await import('@/lib/schedule-nightly-db')
    expect(await runAutoRollForOrg(db.client, org(), SAT_1AM)).toEqual({ candidates: 0, rolled: 0, left: 0, failed: 0 })
    expect(db.tables.work_orders[0].scheduled_date).toBe('2026-11-12')
  })

  it('fails closed: a clock-time or move-log lookup error (not "table missing") skips the company', async () => {
    for (const bad of ['time_entries', 'work_order_moves']) {
      const db = seed()
      const base = db.client as unknown as { from: (t: string) => Record<string, unknown> }
      const client = {
        ...base,
        from: (t: string) => {
          if (t !== bad) return base.from(t)
          const chain: Record<string, unknown> = {}
          for (const m of ['select', 'in', 'is', 'neq', 'gte', 'eq']) chain[m] = () => chain
          chain.then = (res: (v: unknown) => unknown) => res({ data: null, error: { code: '57014', message: 'timeout' } })
          return chain
        },
      } as unknown as typeof db.client
      const { runAutoRollForOrg } = await import('@/lib/schedule-nightly-db')
      expect(await runAutoRollForOrg(client, org(), SAT_1AM)).toMatchObject({ error: true, rolled: 0 })
      expect(db.tables.work_orders[0].scheduled_date).toBe('2026-11-13')
    }
  })

  it('old skipped rows cannot starve newer ones: the run pages past them until the cap of ROLLED rows', async () => {
    const old = Array.from({ length: 205 }, (_, i) => visit(`a${String(i).padStart(3, '0')}`, { scheduled_date: '2026-11-01' }))
    const db = seed({
      work_orders: [...old, visit('z1', { scheduled_date: '2026-11-12' })],
      time_entries: old.map((o, i) => ({ id: `t${i}`, org_id: ORG, work_order_id: o.id, removed_at: null })),
    })
    const { runAutoRollForOrg } = await import('@/lib/schedule-nightly-db')
    expect(await runAutoRollForOrg(db.client, org(), SAT_1AM)).toMatchObject({ rolled: 1, left: 205 })
    expect(db.tables.work_orders.find((w) => w.id === 'z1')?.scheduled_date).toBe('2026-11-16')
  })

  it('one bad row never stops the rest, and the cap bounds a run', async () => {
    const db = seed()
    failNextRoll.on = true
    db.tables.work_orders.push(visit('w9', { scheduled_date: '2026-11-12' }))
    const { runAutoRollForOrg } = await import('@/lib/schedule-nightly-db')
    expect(await runAutoRollForOrg(db.client, org(), SAT_1AM, 5)).toMatchObject({ candidates: 2, rolled: 1, failed: 1 })
    expect(await runAutoRollForOrg(db.client, org(), SAT_1AM, 1)).toMatchObject({ rolled: 1 })
  })
})

describe('end-of-day nudge', () => {
  const SIX_PM = new Date('2026-11-10T23:30:00Z') // 18:30 EST, Tuesday
  const visits = [
    { id: 'v1', status: 'scheduled', workOrderNumber: 'WO-00012', subId: 's1' },
    { id: 'v2', status: 'scheduled', workOrderNumber: 'WO-00013', subId: 's2' },
    { id: 'v3', status: 'completed', workOrderNumber: 'WO-00014', subId: 's1' },
  ]
  function seedPeople() {
    return seed({
      users: [
        { id: 'owner', org_id: ORG, role: 'owner', is_super_admin: true, active: true },
        { id: 'lead1', org_id: ORG, role: 'field_tech', is_super_admin: false, active: true },
        { id: 'lead2', org_id: ORG, role: 'field_tech', is_super_admin: false, active: true },
        { id: 'rep', org_id: ORG, role: 'sales_rep', is_super_admin: false, active: true },
      ],
      crew_members: [
        { org_id: ORG, sub_id: 's1', user_id: 'lead1', is_lead: true },
        { org_id: ORG, sub_id: 's2', user_id: 'lead2', is_lead: true },
        { org_id: ORG, sub_id: 's2', user_id: 'rep', is_lead: false },
      ],
      time_entries: [{ id: 't1', org_id: ORG, user_id: 'rep', kind: 'work', ended_at: null, removed_at: null }],
    })
  }

  beforeEach(() => mockVisits.mockResolvedValue(visits))

  it('off by default, and outside its hour window: no bell', async () => {
    const db = seedPeople()
    const { runEndOfDayNudgeForOrg } = await import('@/lib/schedule-nightly-db')
    expect(await runEndOfDayNudgeForOrg(db.client, org(null), SIX_PM, { timeTracking: true })).toEqual({ skipped: 'off' })
    expect(await runEndOfDayNudgeForOrg(db.client, org(), new Date('2026-11-10T15:00:00Z'), { timeTracking: true })).toEqual({ skipped: 'not_time' })
    expect(db.tables.notifications).toHaveLength(0)
  })

  it('rings the office with everything and each crew lead with their own crew; work order numbers and counts only', async () => {
    const db = seedPeople()
    const { runEndOfDayNudgeForOrg } = await import('@/lib/schedule-nightly-db')
    expect(await runEndOfDayNudgeForOrg(db.client, org(), SIX_PM, { timeTracking: true })).toEqual({ rung: 3 })
    const by = Object.fromEntries(db.tables.notifications.map((n) => [n.recipient_user_id, n]))
    expect(Object.keys(by).sort()).toEqual(['lead1', 'lead2', 'owner'])
    expect(by.owner).toMatchObject({ type: 'eod_open_work', data: { day: '2026-11-10' }, body: '2 visits still open (WO-00012, WO-00013) · 1 still clocked in' })
    expect(by.lead1.body).toBe('1 visit still open (WO-00012)')
    expect(by.lead2.body).toBe('1 visit still open (WO-00013) · 1 still clocked in')
    expect(JSON.stringify(db.tables.notifications)).not.toMatch(/Lot Ln|Builder|@/)
  })

  it('one bell per person per day: a second run does not ring again (the unique index answers 23505)', async () => {
    const db = seedPeople()
    const seen = new Set<string>()
    const base = db.client as unknown as { from: (t: string) => unknown }
    const client = {
      ...base,
      from: (t: string) => {
        if (t !== 'notifications') return base.from(t)
        return {
          select: () => {
            const chain: Record<string, unknown> = { eq: () => chain, in: () => chain, then: (res: (v: unknown) => unknown) => res({ data: Array.from(seen).map((k) => ({ recipient_user_id: k.split('|')[0], data: { day: k.split('|')[1] } })), error: null }) }
            return chain
          },
          insert: async (row: { recipient_user_id: string; data: { day: string } }) => {
            const key = `${row.recipient_user_id}|${row.data.day}`
            if (seen.has(key)) return { error: { code: '23505', message: 'dup' } }
            seen.add(key)
            ;(db.tables.notifications ??= []).push(row)
            return { error: null }
          },
        }
      },
    } as unknown as typeof db.client
    const { runEndOfDayNudgeForOrg } = await import('@/lib/schedule-nightly-db')
    expect(await runEndOfDayNudgeForOrg(client, org(), SIX_PM, { timeTracking: true })).toEqual({ rung: 3 })
    expect(await runEndOfDayNudgeForOrg(client, org(), new Date('2026-11-11T00:20:00Z'), { timeTracking: true })).toEqual({ rung: 0 })
    expect(db.tables.notifications).toHaveLength(3)
  })

  it('nothing open and nobody clocked in: no bell', async () => {
    mockVisits.mockResolvedValue([visits[2]])
    const db = seed({ users: [{ id: 'owner', org_id: ORG, role: 'owner', is_super_admin: true, active: true }] })
    const { runEndOfDayNudgeForOrg } = await import('@/lib/schedule-nightly-db')
    expect(await runEndOfDayNudgeForOrg(db.client, org(), SIX_PM, { timeTracking: true })).toEqual({ skipped: 'nothing_open' })
  })
})
