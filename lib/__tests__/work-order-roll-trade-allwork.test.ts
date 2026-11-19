/** @jest-environment node */
/**
 * The one-tap roll on a TRADE work order goes through the one install writer (assign): same job re-sync, same calendar invite,
 * plus the move log; and the All work loader merges the sources and gates sales appointments.
 */
import { createFakeDb } from '@/lib/test-helpers/fake-db'

jest.mock('@/lib/supplier-orders', () => ({ refreshMaterialsOrderedFromSuppliers: jest.fn(async () => undefined) }))
const events: Array<{ summary: string }> = []
jest.mock('@/lib/calendar/connection', () => {
  const actual = jest.requireActual('@/lib/calendar/connection')
  return {
    ...actual,
    getCalendarClient: jest.fn(async () => ({
      provider: 'google',
      accessToken: 'tok',
      createEvent: async (ev: { summary: string }) => (events.push(ev), { id: `ev-${events.length}` }),
      updateEvent: async (_id: string, ev: { summary: string }) => (events.push(ev), {}),
      deleteEvent: async () => undefined,
    })),
  }
})
jest.mock('@/lib/cron-orgs', () => ({ loadOrgTimeZone: async () => 'America/New_York' }))

const ORG = 'org-1'
const NOW = new Date('2026-11-10T15:00:00Z') // Tuesday

function seed() {
  events.length = 0
  return createFakeDb(
    {
      orgs: [{ id: ORG, phone: null, install_scheduling_user_id: null, install_scheduling_calendar_id: null, settings: {}, timezone: 'America/New_York' }],
      org_trades: [{ org_id: ORG, slug: 'grading', label: 'Grading', sort: 1, active: true, match_keywords: [] }, { org_id: ORG, slug: 'lawn', label: 'Lawn care', sort: 2, active: true, match_keywords: [] }],
      production_jobs: [{ id: 'j1', org_id: ORG, job_number: '26-0201', customer_id: 'c1', job_type: 'grading', status: 'scheduled', address_text: '9 Lot Ln', scheduled_date: '2026-11-13', install_days: 1, assigned_sub_id: 's1', cancelled_at: null }],
      work_orders: [{ id: 'w1', org_id: ORG, job_id: 'j1', trade: 'grading', trade_source: 'manual', work_order_type: 'install', status: 'scheduled', assigned_sub_id: 's1', scheduled_date: '2026-11-13', scheduled_time_start: null, install_days: 1, crew_link_token: 'tok' }],
      sub_contractors: [{ id: 's1', org_id: ORG, company_name: 'Grade Crew', scheduling_email: 'g@example.test', active: true }],
      customers: [{ id: 'c1', name: 'Builder Co' }],
      job_stages: [{ id: 'st1', org_id: ORG, job_id: 'j1', stage_key: 'seed', name: 'Seeding', trade: 'lawn', work_order_id: null, start_date: '2026-11-17', workdays: 2, done_at: null }],
      scheduled_appointments: [{ id: 'a1', org_id: ORG, scheduled_for: '2026-11-12T14:00:00Z', status: 'scheduled', appointment_type: 'inspection', closer_user_id: 'u9' }],
      users: [{ id: 'u9', org_id: ORG, full_name: 'Closer' }],
      photos: [],
      work_order_moves: [],
    },
    {
      rpc: {
        record_work_order_moves: (args, t) => {
          for (const m of args.p_moves as Array<Record<string, unknown>>) {
            ;(t.work_order_moves ??= []).push({ org_id: args.p_org_id, ...m })
          }
          return 1
        },
      },
    }
  )
}

describe('rollWorkOrder — a trade work order', () => {
  it('moves to the next working day through the assign writer: job re-synced, invite updated, move logged', async () => {
    const db = seed()
    const { rollWorkOrder } = await import('@/lib/work-order-roll')
    const res = await rollWorkOrder(db.client, ORG, 'w1', { reason: 'builder_asked', by: { userId: 'u1', subId: null }, schedulingUserId: 'u1', expectFrom: '2026-11-13', now: NOW })
    expect(res).toEqual({ ok: true, from: '2026-11-13', to: '2026-11-16', rolls: 1 })
    expect(db.tables.work_orders[0]).toMatchObject({ scheduled_date: '2026-11-16', status: 'scheduled', assigned_sub_id: 's1', crew_link_token: 'tok' })
    expect(db.tables.production_jobs[0]).toMatchObject({ scheduled_date: '2026-11-16' })
    expect(events.at(-1)?.summary).toContain('Grading')
    expect(db.tables.work_order_moves).toEqual([expect.objectContaining({ work_order_id: 'w1', reason: 'builder_asked', kind: 'roll', from_date: '2026-11-13', to_date: '2026-11-16' })])
  })

  it('a second tap is "Already moved": one move row, the day unchanged by the second call', async () => {
    const db = seed()
    const { rollWorkOrder } = await import('@/lib/work-order-roll')
    const args = { reason: null, by: { userId: 'u1', subId: null }, schedulingUserId: 'u1', expectFrom: '2026-11-13', now: NOW } as const
    expect(await rollWorkOrder(db.client, ORG, 'w1', args)).toMatchObject({ ok: true })
    expect(await rollWorkOrder(db.client, ORG, 'w1', args)).toEqual({ ok: false, status: 409, error: 'Already moved' })
    expect(db.tables.work_order_moves).toHaveLength(1)
    expect(db.tables.work_orders[0].scheduled_date).toBe('2026-11-16')
  })

  it('the compare-and-set loses when the day changed between read and write (nothing logged)', async () => {
    const db = seed()
    const { assignInstallTrade } = await import('@/lib/install-schedule-assign')
    const out = await assignInstallTrade(db.client, { orgId: ORG, schedulingUserId: 'u1' }, { workOrderId: 'w1', subId: 's1', scheduledDate: '2026-11-16', kind: 'roll', expect: { scheduledDate: '2026-11-12' } })
    expect(out).toMatchObject({ status: 409, body: { error: 'Already moved' } })
    expect(db.tables.work_orders[0].scheduled_date).toBe('2026-11-13')
    expect(db.tables.work_order_moves).toHaveLength(0)
  })

  it('a crew roll with no calendar account leaves a job note instead of using someone else\'s calendar', async () => {
    const db = seed()
    db.tables.work_orders[0].install_google_event_id = 'ev-old'
    const cal = await import('@/lib/calendar/connection')
    ;(cal.getCalendarClient as jest.Mock).mockResolvedValueOnce(null)
    const { rollWorkOrder } = await import('@/lib/work-order-roll')
    const res = await rollWorkOrder(db.client, ORG, 'w1', { reason: null, by: { userId: null, subId: 's1' }, schedulingUserId: '', onlySubId: 's1', expectFrom: '2026-11-13', now: NOW })
    expect(res).toMatchObject({ ok: true })
    const notes = [...(db.tables.activities ?? []), ...(db.tables.production_job_notes ?? [])].map((n) => String(n.body ?? n.note))
    expect(notes).toContain('Calendar invite still shows the old day')
  })

  it('refuses another crew, an unscheduled order, and a two-day crew already on its second day', async () => {
    const db = seed()
    const { rollWorkOrder } = await import('@/lib/work-order-roll')
    const by = { userId: null, subId: 's2' }
    expect(await rollWorkOrder(db.client, ORG, 'w1', { reason: null, by, schedulingUserId: '', onlySubId: 's2', expectFrom: '2026-11-13', now: NOW })).toMatchObject({ ok: false, status: 404 })
    db.tables.work_orders[0].install_days = 2
    db.tables.work_orders[0].scheduled_date = '2026-11-09'
    expect(await rollWorkOrder(db.client, ORG, 'w1', { reason: null, by: { userId: 'u1', subId: null }, schedulingUserId: 'u1', expectFrom: '2026-11-09', now: NOW })).toMatchObject({ ok: false, status: 409 })
    db.tables.work_orders[0].status = 'pending'
    expect(await rollWorkOrder(db.client, ORG, 'w1', { reason: null, by: { userId: 'u1', subId: null }, schedulingUserId: 'u1', expectFrom: '2026-11-09', now: NOW })).toMatchObject({ ok: false, status: 409 })
  })

  it('the manual assign route also logs a date change for an already-scheduled order (history, not a roll)', async () => {
    const db = seed()
    const { assignInstallTrade } = await import('@/lib/install-schedule-assign')
    const out = await assignInstallTrade(db.client, { orgId: ORG, schedulingUserId: 'u1', by: { userId: 'u1', subId: null } }, { workOrderId: 'w1', subId: 's1', scheduledDate: '2026-11-18' })
    expect(out.status).toBe(200)
    expect(db.tables.work_order_moves).toEqual([expect.objectContaining({ kind: 'move', from_date: '2026-11-13', to_date: '2026-11-18', reason: null })])
    // Re-posting the same day is not a move.
    await assignInstallTrade(db.client, { orgId: ORG, schedulingUserId: 'u1' }, { workOrderId: 'w1', subId: 's1', scheduledDate: '2026-11-18' })
    expect(db.tables.work_order_moves).toHaveLength(1)
  })
})

describe('loadAllWork', () => {
  it('merges crews, planned stages and appointments; appointments only for a viewer who may see them', async () => {
    const db = seed()
    const { loadAllWork } = await import('@/lib/all-work-db')
    const withAppts = await loadAllWork(db.client, ORG, '2026-11-01', '2026-11-30', { visits: false, appointments: true, timeZone: 'America/New_York' })
    expect(withAppts.items.map((i) => [i.kind, i.type, i.date, i.trade])).toEqual([
      ['appointment', 'appointment', '2026-11-12', null],
      ['install', 'job', '2026-11-13', 'grading'],
      ['stage', 'job', '2026-11-17', 'lawn'],
    ])
    expect(withAppts.items.find((i) => i.kind === 'stage')).toMatchObject({ endDate: '2026-11-18' })
    const without = await loadAllWork(db.client, ORG, '2026-11-01', '2026-11-30', { visits: false, appointments: false, timeZone: 'America/New_York' })
    expect(without.items.map((i) => i.kind)).toEqual(['install', 'stage'])
    expect(without.trades.map((t) => t.slug)).toEqual(['grading', 'lawn'])
  })

  it('a stage already booked to a scheduled crew order is not shown twice, and other companies never leak in', async () => {
    const db = seed()
    db.tables.job_stages[0].work_order_id = 'w1'
    db.tables.work_orders.push({ id: 'wx', org_id: 'org-2', job_id: 'jx', trade: 'grading', work_order_type: 'install', status: 'scheduled', scheduled_date: '2026-11-13', install_days: 1 })
    const { loadAllWork } = await import('@/lib/all-work-db')
    const r = await loadAllWork(db.client, ORG, '2026-11-01', '2026-11-30', { visits: false, appointments: false, timeZone: 'America/New_York' })
    expect(r.items.map((i) => i.key)).toEqual(['wo:w1'])
  })

  it('says so when a source hits its cap (never a silent cut)', async () => {
    const db = seed()
    for (let i = 0; i < 2001; i++) db.tables.job_stages.push({ id: `x${i}`, org_id: ORG, job_id: 'j1', stage_key: 'k', name: 'S', trade: 'lawn', work_order_id: null, start_date: '2026-11-17', workdays: 1, done_at: null })
    const { loadAllWork } = await import('@/lib/all-work-db')
    const r = await loadAllWork(db.client, ORG, '2026-11-01', '2026-11-30', { visits: false, appointments: false, timeZone: 'America/New_York' })
    expect(r.capped).toEqual(['stages'])
    expect(r.cap).toBe(2000)
    const small = await loadAllWork(seed().client, ORG, '2026-11-01', '2026-11-30', { visits: false, appointments: false, timeZone: 'America/New_York' })
    expect(small.capped).toEqual([])
  })

  it('refuses a window longer than nine weeks', async () => {
    const { loadAllWork } = await import('@/lib/all-work-db')
    await expect(loadAllWork(seed().client, ORG, '2026-01-01', '2026-06-01', { visits: false, appointments: false, timeZone: 'America/New_York' })).rejects.toThrow('Pick up to 9 weeks')
  })
})
