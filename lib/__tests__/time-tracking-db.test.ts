/**
 * The time clock writer end to end on the in-memory database: crew taps (in / move / lunch / out for travel / out),
 * resends from the offline queue, who may tap for whom, forgot-to-clock-out + the next-morning answer, office edits with
 * a reason and the approved-week lock, and the two feeds (payroll hours, one labor line per job per week).
 */
import { DEFAULT_TIMEZONE } from '@/lib/timezone'
import { createFakeDb } from '@/lib/test-helpers/fake-db'

const saveHoursEntries = jest.fn(async (_c: unknown, _i: unknown) => ({ ok: true, saved: [] }))
jest.mock('@/lib/payroll-hours', () => ({
  saveHoursEntries: (c: unknown, i: unknown) => saveHoursEntries(c, i),
  loadPlanForWeek: async (_c: unknown, userId: string) => (userId === 'aaaaaaaa-0000-4000-8000-000000000003' ? null : { hourly_rate_override: 20, comp_plans: null }),
}))

import {
  addTimeEntry,
  applyClockTap,
  autoCloseForgotten,
  editTimeEntry,
  loadClockState,
  loadOpenShiftsQueue,
  loadTimeWeek,
  removeTimeEntry,
  saveCrewSetup,
  type ClockActor,
} from '@/lib/time-tracking-db'
import { localTimeToInstant, parseClockTap, type ClockTap } from '@/lib/time-tracking'
import { LEGACY_PAY_WEEK, weekCutoffContaining } from '@/lib/payroll-week-schedule'

/** The company in these tests has no saved pay week: the legacy Thursday–Wednesday week in its own zone. */
const payWeekCutoffFor = (at: Date) => weekCutoffContaining(at, { ...LEGACY_PAY_WEEK, timeZone: DEFAULT_TIMEZONE })

const TZ = DEFAULT_TIMEZONE
const U1 = 'aaaaaaaa-0000-4000-8000-000000000001'
const U2 = 'aaaaaaaa-0000-4000-8000-000000000002'
const U3 = 'aaaaaaaa-0000-4000-8000-000000000003'
const X1 = 'aaaaaaaa-0000-4000-8000-0000000000ff'
const T = (hm: string, ymd = '2026-06-10') => localTimeToInstant(ymd, hm, TZ)!
const WO1 = '11111111-1111-4111-8111-000000000001'
const WO2 = '11111111-1111-4111-8111-000000000002'
const JOB1 = '22222222-2222-4222-8222-000000000001'
const ITEM = '33333333-3333-4333-8333-000000000001'

function seed() {
  return createFakeDb({
    orgs: [{ id: 'org1', timezone: TZ }],
    users: [
      { id: U1, org_id: 'org1', full_name: 'Lead Larry', active: true },
      { id: U2, org_id: 'org1', full_name: 'Crew Carla', active: true },
      { id: U3, org_id: 'org1', full_name: 'No Rate Ned', active: true },
      { id: X1, org_id: 'org2', full_name: 'Other Company', active: true },
    ],
    sub_contractors: [
      { id: 's1', org_id: 'org1', company_name: 'Green Team', tracks_time: true, active: true },
      { id: 's2', org_id: 'org1', company_name: 'Sub Steve LLC', tracks_time: false, active: true },
    ],
    crew_members: [
      { id: 'cm1', org_id: 'org1', sub_id: 's1', user_id: U1, is_lead: true },
      { id: 'cm2', org_id: 'org1', sub_id: 's1', user_id: U2, is_lead: false },
    ],
    work_orders: [
      { id: WO1, org_id: 'org1', assigned_sub_id: 's1', job_id: null, status: 'scheduled', title: 'Mow — 12 Oak St' },
      { id: WO2, org_id: 'org1', assigned_sub_id: 's1', job_id: JOB1, status: 'scheduled', title: 'Grading' },
    ],
    production_jobs: [{ id: JOB1, org_id: 'org1', job_number: '26-0141', status: 'scheduled' }],
    pricebook_items: [{ id: ITEM, org_id: 'org1', name: 'Tractor', unit: 'hour', active: true }],
    time_entries: [],
    time_entry_changes: [],
    job_cost_lines: [],
    payroll_periods: [],
    payroll_rep_hours: [],
  })
}

let k = 0
function tap(action: ClockTap['action'], at: Date, extra: Record<string, unknown> = {}): ClockTap {
  // People actions always name who (the phone sends the ticked crew); default here = the two crew members.
  const people = ['clock_in', 'clock_out', 'break_start', 'break_end'].includes(action) && !('userIds' in extra) ? { userIds: [U1, U2] } : {}
  const p = parseClockTap({ tapId: `tap-${String(++k).padStart(8, '0')}`, action, at: at.toISOString(), deviceNow: at.toISOString(), ...people, ...extra })
  if ('error' in p) throw new Error(p.error)
  return p.tap
}
const crew: ClockActor = { via: 'crew_link', orgId: 'org1', subId: 's1' }
const open = (db: ReturnType<typeof seed>, kind = 'work') => db.tables.time_entries.filter((e) => e.kind === kind && !e.ended_at && !e.removed_at)

beforeEach(() => saveHoursEntries.mockClear())

describe('crew taps', () => {
  it('clock in → move → lunch → out for the next stop → in → out: one open clock per person, travel paid', async () => {
    const db = seed()
    expect(await applyClockTap(db.client, crew, tap('clock_in', T('07:00'), { workOrderId: WO1 }), T('07:00'))).toEqual({ ok: true, done: 2 })
    expect(open(db).map((e) => e.user_id).sort()).toEqual([U1, U2])
    expect(open(db)[0]).toMatchObject({ source: 'lead_tap', tapped_via: 'crew_link', sub_id: 's1', start_lat: null })

    // "Move crew to this stop?" = clock in at the next stop: closes the first, opens the second, job filled from the WO.
    await applyClockTap(db.client, crew, tap('clock_in', T('09:00'), { workOrderId: WO2, tappedBy: U1 }), T('09:00'))
    expect(open(db).every((e) => e.work_order_id === WO2 && e.production_job_id === JOB1 && e.tapped_by_user_id === U1)).toBe(true)
    expect(db.tables.time_entries.filter((e) => e.work_order_id === WO1).every((e) => e.ended_at === T('09:00').toISOString())).toBe(true)

    await applyClockTap(db.client, crew, tap('break_start', T('12:00')), T('12:00'))
    expect(open(db, 'break')).toHaveLength(2)
    await applyClockTap(db.client, crew, tap('break_end', T('12:30')), T('12:30'))
    expect(open(db, 'break')).toHaveLength(0)

    await applyClockTap(db.client, crew, tap('clock_out', T('14:00'), { forTravel: true }), T('14:00'))
    expect(open(db)).toHaveLength(0)
    const state = await loadClockState(db.client, crew, T('14:10'))
    expect(state.people.map((p) => p.travelling)).toEqual([true, true])

    await applyClockTap(db.client, crew, tap('clock_in', T('14:20'), { workOrderId: WO1 }), T('14:20'))
    await applyClockTap(db.client, crew, tap('clock_out', T('16:00')), T('16:00'))

    // Payroll got (7:00–16:00) − 30 min lunch = 8.5 h each (the 20-minute drive is paid).
    const last = saveHoursEntries.mock.calls.at(-1)![1] as { entries: Array<{ user_id: string; regular_hours: number; overtime_hours: number; reason: string }> }
    expect(last.entries[0]).toMatchObject({ regular_hours: 8.5, overtime_hours: 0, reason: 'Time clock' })
    // One labor line for the job this week: 5 h on job (09:00–14:00) − 0.5 h lunch = 4.5 h × 2 people × $20.
    expect(db.tables.job_cost_lines).toHaveLength(1)
    expect(db.tables.job_cost_lines[0]).toMatchObject({ job_id: JOB1, amount: 180, cost_type: 'labor', source: 'time_entries', approved: false, deduct_from_commission_base: false, org_id: 'org1' })
  })

  it('a tap resent by the offline queue changes nothing the second time', async () => {
    const db = seed()
    const t = tap('clock_in', T('07:00'), { workOrderId: WO1 })
    await applyClockTap(db.client, crew, t, T('07:01'))
    expect(await applyClockTap(db.client, crew, t, T('07:05'))).toEqual({ ok: true, done: 0 })
    expect(db.tables.time_entries).toHaveLength(2)
  })

  it('unticked people stay off; a sub crew gets no clock; someone else’s stop is refused', async () => {
    const db = seed()
    await applyClockTap(db.client, crew, tap('clock_in', T('07:00'), { workOrderId: WO1, userIds: [U1] }), T('07:00'))
    expect(open(db).map((e) => e.user_id)).toEqual([U1])
    const sub = await applyClockTap(db.client, { via: 'crew_link', orgId: 'org1', subId: 's2' }, tap('clock_in', T('07:00'), { workOrderId: WO1 }), T('07:00'))
    expect(sub).toMatchObject({ ok: false, status: 403 })
    db.tables.work_orders[0].assigned_sub_id = 's2'
    expect(await applyClockTap(db.client, crew, tap('clock_in', T('08:00'), { workOrderId: WO1 }), T('08:00'))).toMatchObject({ ok: false, status: 404 })
    // A person from another company can't be named as the tapper.
    expect(await applyClockTap(db.client, crew, tap('clock_out', T('09:00'), { tappedBy: '99999999-9999-4999-8999-999999999999' }), T('09:00'))).toMatchObject({ ok: false, status: 400 })
  })

  it('signed in: a non-lead clocks only themselves (self_tap) on a job', async () => {
    const db = seed()
    const me: ClockActor = { via: 'signed_in', orgId: 'org1', userId: U2 }
    await applyClockTap(db.client, me, tap('clock_in', T('07:00'), { jobId: JOB1, userIds: [U2, U1] }), T('07:00'))
    expect(open(db).map((e) => [e.user_id, e.source, e.tapped_via])).toEqual([[U2, 'lead_tap', 'signed_in']])
    const db2 = seed()
    await applyClockTap(db2.client, me, tap('clock_in', T('07:00'), { jobId: JOB1, userIds: [U2] }), T('07:00'))
    expect(open(db2)[0]).toMatchObject({ source: 'self_tap', sub_id: 's1', production_job_id: JOB1 }) // filed under their crew
  })

  it('equipment runs on the crew’s stop and stops when the crew leaves', async () => {
    const db = seed()
    await applyClockTap(db.client, crew, tap('clock_in', T('07:00'), { workOrderId: WO2 }), T('07:00'))
    await applyClockTap(db.client, crew, tap('equipment_start', T('07:30'), { pricebookItemId: ITEM }), T('07:30'))
    expect(open(db, 'equipment')).toHaveLength(1)
    expect(open(db, 'equipment')[0]).toMatchObject({ user_id: null, work_order_id: WO2, pricebook_item_id: ITEM })
    await applyClockTap(db.client, crew, tap('clock_out', T('11:00')), T('11:00'))
    expect(open(db, 'equipment')).toHaveLength(0)
  })

  it('a tap for an approved week is kept, flagged, never changes that week, and is paid on the next open week', async () => {
    const db = seed()
    const cutoff = payWeekCutoffFor(T('07:00'))
    db.tables.payroll_periods.push({ id: 'p1', org_id: 'org1', cutoff_at: cutoff.toISOString(), status: 'locked', locked_at: cutoff.toISOString() })
    await applyClockTap(db.client, crew, tap('clock_in', T('07:00'), { workOrderId: WO1 }), T('07:00'))
    await applyClockTap(db.client, crew, tap('clock_out', T('09:00')), T('09:00'))
    expect(db.tables.time_entries.every((e) => e.needs_review === true)).toBe(true)
    const calls = saveHoursEntries.mock.calls.map((c) => c[1] as { periodId: string; source: string; entries: Array<{ regular_hours: number; reason: string }> })
    expect(calls.some((c) => c.periodId === 'p1')).toBe(false)
    const last = calls.at(-1)!
    expect(last).toMatchObject({ source: 'clock' })
    expect(last.entries[0].regular_hours).toBe(2)
    expect(last.entries[0].reason).toMatch(/from the approved week before/)
  })

  it('a shift open across the cutoff while that week is approved: the approved part lands on the next week', async () => {
    const db = seed()
    // Wednesday cutoff week: clock in Wed 9pm, out Thu 1am (2 h before the cutoff, 1 h after).
    const wed = T('21:00', '2026-06-10')
    const cutoff = payWeekCutoffFor(wed)
    db.tables.payroll_periods.push({ id: 'p1', org_id: 'org1', cutoff_at: cutoff.toISOString(), status: 'open', locked_at: null })
    await applyClockTap(db.client, crew, tap('clock_in', wed, { workOrderId: WO1, userIds: [U1] }), wed)
    // The week is approved while the shift is still open.
    Object.assign(db.tables.payroll_periods[0], { status: 'locked', locked_at: new Date(Date.now() - 60_000).toISOString() })
    const thu = T('01:00', '2026-06-11')
    await applyClockTap(db.client, crew, tap('clock_out', thu, { userIds: [U1] }), thu)
    const last = saveHoursEntries.mock.calls.at(-1)![1] as { periodId: string; entries: Array<{ regular_hours: number }> }
    expect(last.periodId).not.toBe('p1')
    expect(last.entries[0].regular_hours).toBeCloseTo(4, 6) // 1 h this week + the ~3 h carried from the approved week
  })

  it('an empty "who" list never means everyone', async () => {
    expect(parseClockTap({ tapId: 'tap-99999999', action: 'clock_out', at: T('09:00').toISOString(), deviceNow: T('09:00').toISOString() })).toEqual({ error: 'Pick who' })
    const db = seed()
    await applyClockTap(db.client, crew, tap('clock_in', T('07:00'), { workOrderId: WO1 }), T('07:00'))
    // Only someone not on this crew named: refused, nobody clocked out.
    expect(await applyClockTap(db.client, crew, tap('clock_out', T('09:00'), { userIds: [X1] }), T('09:00'))).toMatchObject({ ok: false, status: 400 })
    expect(open(db)).toHaveLength(2)
  })

  it('captures location only when the company turned it on', async () => {
    const db = seed()
    await applyClockTap(db.client, crew, tap('clock_in', T('07:00'), { workOrderId: WO1, lat: 30.1, lng: -84.3 }), T('07:00'))
    expect(open(db)[0].start_lat).toBeNull()
    const db2 = seed()
    db2.tables.orgs[0].tt = { captureLocation: true }
    await applyClockTap(db2.client, crew, tap('clock_in', T('07:00'), { workOrderId: WO1, lat: 30.1, lng: -84.3 }), T('07:00'))
    expect(open(db2)[0]).toMatchObject({ start_lat: 30.1, start_lng: -84.3 })
  })
})

describe('forgot to clock out', () => {
  it('a queued Tuesday tap never closes Monday’s forgotten clock at Tuesday: Monday stops at its last tap, flagged', async () => {
    const db = seed()
    await applyClockTap(db.client, crew, tap('clock_in', T('07:00', '2026-06-08'), { workOrderId: WO1, userIds: [U1] }), T('07:00', '2026-06-08'))
    // Monday's 4pm clock-out sat in the phone queue; it arrives Tuesday morning together with Tuesday's clock-in.
    const tue = T('07:05', '2026-06-09')
    // The queue stamps deviceNow when it SENDS (Tuesday), so the phone clock is right and Monday's time is kept.
    await applyClockTap(db.client, crew, tap('clock_out', T('16:00', '2026-06-08'), { userIds: [U1], deviceNow: tue.toISOString() }), tue)
    const mon = db.tables.time_entries.find((e) => e.started_at === T('07:00', '2026-06-08').toISOString())!
    expect(mon).toMatchObject({ ended_at: T('16:00', '2026-06-08').toISOString(), end_source: 'lead_tap' }) // inside the limit: closed normally

    // Now a forgotten one: Tuesday in, never out; Wednesday's clock-in arrives.
    await applyClockTap(db.client, crew, tap('clock_in', tue, { workOrderId: WO1, userIds: [U1] }), tue)
    const wed = T('07:00', '2026-06-10')
    await applyClockTap(db.client, crew, tap('clock_in', wed, { workOrderId: WO2, userIds: [U1] }), wed)
    const tueEntry = db.tables.time_entries.find((e) => e.started_at === tue.toISOString())!
    expect(tueEntry).toMatchObject({ ended_at: tue.toISOString(), end_source: 'auto_closed', needs_review: true })
    expect(String(tueEntry.review_note)).toMatch(/pays 0 h until a finish time/)
    expect(open(db).map((e) => e.work_order_id)).toEqual([WO2])
  })

  it('stops at the last tap after the limit, flags it, and takes the lead’s answer next morning', async () => {
    const db = seed()
    await applyClockTap(db.client, crew, tap('clock_in', T('07:00'), { workOrderId: WO1, userIds: [U1] }), T('07:00'))
    await applyClockTap(db.client, crew, tap('break_start', T('12:00')), T('12:00'))
    await applyClockTap(db.client, crew, tap('break_end', T('12:30')), T('12:30'))
    // Nobody taps out. Next morning (past 12 h):
    const morning = T('06:30', '2026-06-11')
    expect(await autoCloseForgotten(db.client, 'org1', { now: morning })).toBe(1)
    const e = db.tables.time_entries.find((x) => x.kind === 'work')!
    expect(e).toMatchObject({ ended_at: T('12:30').toISOString(), end_source: 'auto_closed', needs_review: true })
    expect(db.tables.time_entry_changes.map((c) => c.action)).toEqual(['auto_closed'])

    e.id = 'bbbbbbbb-0000-4000-8000-000000000001' // the fake database's ids aren't uuids; the real ones are
    for (const c of db.tables.time_entry_changes) c.time_entry_id = e.id
    const state = await loadClockState(db.client, crew, morning)
    expect(state.finishQuestions).toHaveLength(1)
    const q = state.finishQuestions[0]
    expect(await applyClockTap(db.client, crew, tap('finish_answer', morning, { entryId: q.entryId, finishTime: '16:15', tappedBy: U1 }), morning)).toEqual({ ok: true, done: 1 })
    expect(e).toMatchObject({ ended_at: T('16:15').toISOString(), end_source: 'typed', needs_review: false, ended_by_user_id: U1 })
    expect(db.tables.time_entry_changes.map((c) => c.action)).toEqual(['auto_closed', 'finish_answered'])
  })
})

describe('authorization (signed in)', () => {
  it('only crew members (or a role the owner allowed) clock themselves; field roles never; nobody by job id alone', async () => {
    const db = seed()
    db.tables.users.push({ id: 'aaaaaaaa-0000-4000-8000-000000000010', org_id: 'org1', full_name: 'Office Olga', role: 'operations', active: true })
    db.tables.users.push({ id: 'aaaaaaaa-0000-4000-8000-000000000011', org_id: 'org1', full_name: 'Setter Sam', role: 'setter', active: true })
    const office: ClockActor = { via: 'signed_in', orgId: 'org1', userId: 'aaaaaaaa-0000-4000-8000-000000000010' }
    const setter: ClockActor = { via: 'signed_in', orgId: 'org1', userId: 'aaaaaaaa-0000-4000-8000-000000000011' }
    expect(await applyClockTap(db.client, office, tap('clock_in', T('07:00'), { jobId: JOB1, userIds: [office.userId] }), T('07:00'))).toMatchObject({ ok: false, status: 403 })
    // The owner allows the operations role (and, by mistake, setters — still refused).
    db.tables.orgs[0].tt = { selfClockRoles: ['operations', 'setter'] }
    expect(await applyClockTap(db.client, office, tap('clock_in', T('07:00'), { jobId: JOB1, userIds: [office.userId] }), T('07:00'))).toMatchObject({ ok: true, done: 1 })
    expect(await applyClockTap(db.client, setter, tap('clock_in', T('07:00'), { jobId: JOB1, userIds: [setter.userId] }), T('07:00'))).toMatchObject({ ok: false, status: 403 })
    expect(open(db).map((e) => [e.user_id, e.source])).toEqual([[office.userId, 'self_tap']])
  })
})

describe('office', () => {
  it('adds, edits and removes with a reason; history kept; an approved week refuses', async () => {
    const db = seed()
    const add = await addTimeEntry(db.client, 'org1', U1, { userId: U2, kind: 'work', startedAt: T('07:00').toISOString(), endedAt: T('15:00').toISOString(), jobId: JOB1 }, 'Phone was dead')
    expect(add).toMatchObject({ ok: true })
    const id = (add as { id: string }).id
    expect(db.tables.time_entries[0]).toMatchObject({ source: 'typed', tapped_via: 'office', production_job_id: JOB1 })
    expect(db.tables.job_cost_lines[0]).toMatchObject({ amount: 160 })

    expect(await editTimeEntry(db.client, 'org1', U1, id, { endedAt: T('16:00').toISOString() }, 'Stayed late')).toEqual({ ok: true })
    expect(db.tables.job_cost_lines).toHaveLength(1)
    expect(db.tables.job_cost_lines[0]).toMatchObject({ amount: 180 })
    const log = db.tables.time_entry_changes.find((c) => c.action === 'updated')!
    expect(log).toMatchObject({ reason: 'Stayed late', changed_by: U1 })
    expect((log.changes as Array<{ field: string }>).map((c) => c.field)).toEqual(['ended_at'])

    expect(await removeTimeEntry(db.client, 'org1', U1, id, 'Duplicate')).toEqual({ ok: true })
    expect(db.tables.job_cost_lines[0].deleted_at).toBeTruthy()
    expect(db.tables.time_entries[0].removed_at).toBeTruthy() // kept, never deleted

    // Approve the week: nothing in it can change.
    const db2 = seed()
    const add2 = await addTimeEntry(db2.client, 'org1', U1, { userId: U2, kind: 'work', startedAt: T('07:00').toISOString(), endedAt: T('15:00').toISOString(), jobId: JOB1 }, 'Phone was dead')
    const period = db2.tables.payroll_periods[0]
    period.status = 'locked'
    expect(await editTimeEntry(db2.client, 'org1', U1, (add2 as { id: string }).id, { endedAt: T('16:00').toISOString() }, 'Stayed late')).toMatchObject({ ok: false, status: 409 })
    // Overlapping the same person's other work is refused.
    const db3 = seed()
    await addTimeEntry(db3.client, 'org1', U1, { userId: U2, kind: 'work', startedAt: T('07:00').toISOString(), endedAt: T('15:00').toISOString(), jobId: JOB1 }, 'Phone was dead')
    expect(await addTimeEntry(db3.client, 'org1', U1, { userId: U2, kind: 'work', startedAt: T('14:00').toISOString(), endedAt: T('16:00').toISOString(), jobId: JOB1 }, 'Second stop')).toMatchObject({ ok: false, status: 409 })
    // Another company's person can't be given time.
    expect(await addTimeEntry(db2.client, 'org1', U1, { userId: X1, kind: 'work', startedAt: T('07:00', '2026-06-20').toISOString(), endedAt: T('08:00', '2026-06-20').toISOString(), jobId: JOB1 }, 'Test it')).toMatchObject({ ok: false, status: 404 })
  })

  it('the week list: paid totals, warnings, what payroll has; a person with no pay rate is named on the job line', async () => {
    const db = seed()
    db.tables.crew_members.push({ id: 'cm3', org_id: 'org1', sub_id: 's1', user_id: U3, is_lead: false })
    await applyClockTap(db.client, crew, tap('clock_in', T('06:00'), { workOrderId: WO2, userIds: [U1, U2, U3] }), T('06:00'))
    await applyClockTap(db.client, crew, tap('clock_out', T('14:00'), { userIds: [U1, U2, U3] }), T('14:00'))
    const week = await loadTimeWeek(db.client, 'org1', T('06:00'), T('18:00'))
    expect(week.people.map((p) => [p.name, p.paidSeconds / 3600])).toEqual([
      ['Crew Carla', 8],
      ['Lead Larry', 8],
      ['No Rate Ned', 8],
    ])
    expect(week.people[0].warnings.map((w) => w.code)).toEqual(['no_break'])
    expect(week.people[0].entries[0].where).toBe('Grading')
    expect(db.tables.job_cost_lines[0].description).toMatch(/8 h not counted: no pay rate/)
    expect(db.tables.job_cost_lines[0].amount).toBe(320)
  })
})

describe('crew setup', () => {
  it('only active people of this company, and a lead is required', async () => {
    const db = seed()
    expect(await saveCrewSetup(db.client, 'org1', 's2', U1, { tracksTime: true, members: [{ userId: X1, isLead: true }] })).toMatchObject({ ok: false, status: 400 })
    expect(await saveCrewSetup(db.client, 'org1', 's2', U1, { tracksTime: true, members: [{ userId: U3, isLead: true }] })).toEqual({ ok: true })
    expect(db.tables.sub_contractors[1].tracks_time).toBe(true)
    expect(db.tables.crew_members.filter((m) => m.sub_id === 's2')).toEqual([expect.objectContaining({ user_id: U3, is_lead: true, org_id: 'org1' })])
    expect(await saveCrewSetup(db.client, 'org1', 'nope', U1, { tracksTime: true, members: [] })).toMatchObject({ ok: false, status: 404 })
  })
})

describe('open shifts on Today / morning email + the feed lock', () => {
  it('lists shifts the system stopped with no finish time, loudly when they pay 0 h', async () => {
    const db = seed()
    const mon = T('07:00', '2026-06-08')
    await applyClockTap(db.client, crew, tap('clock_in', mon, { workOrderId: WO1, userIds: [U1] }), mon)
    await autoCloseForgotten(db.client, 'org1', { now: T('08:00', '2026-06-09') })
    const q = await loadOpenShiftsQueue(db.client, 'org1', T('08:00', '2026-06-09'))
    expect(q).toMatchObject({ id: 'open-shifts', title: '1 shift needs a finish time', count: 1, items: [{ title: 'Lead Larry', href: '/admin/time' }] })
    expect(q!.items[0].note).toMatch(/paying 0 h until fixed/)
  })

  it('each payroll recompute takes the person’s lease and gives it back', async () => {
    const calls: string[] = []
    const db = createFakeDb(
      { orgs: [{ id: 'org1', timezone: TZ }], users: [{ id: U1, org_id: 'org1', full_name: 'L', active: true }], sub_contractors: [{ id: 's1', org_id: 'org1', company_name: 'G', tracks_time: true, active: true }], crew_members: [{ id: 'c', org_id: 'org1', sub_id: 's1', user_id: U1, is_lead: true }], work_orders: [{ id: WO1, org_id: 'org1', assigned_sub_id: 's1', job_id: null, status: 'scheduled' }], time_entries: [], payroll_periods: [] },
      { rpc: { time_feed_try_lock: () => { calls.push('lock'); return true }, time_feed_unlock: () => { calls.push('unlock'); return null } } }
    )
    await applyClockTap(db.client, crew, tap('clock_in', T('07:00'), { workOrderId: WO1, userIds: [U1] }), T('07:00'))
    await applyClockTap(db.client, crew, tap('clock_out', T('09:00'), { userIds: [U1] }), T('09:00'))
    expect(calls.length).toBeGreaterThan(0)
    expect(calls.filter((c) => c === 'lock').length).toBe(calls.filter((c) => c === 'unlock').length)
  })
})

describe('pay week = the company schedule, and weeks already stored win (payroll-solid merge)', () => {
  // The owner moved the pay week from Thursday–Wednesday to Monday–Sunday; the old week ending Wed Nov 4 is approved.
  const MON_SUN = { weekStartDay: 1, cutoffTime: '23:59', paydayWeekday: 5, lateFunding: null }
  const oldCutoff = localTimeToInstant('2026-11-04', '23:59', TZ)!
  function withSchedule(lockedAt: string) {
    const db = seed()
    Object.assign(db.tables.orgs[0], { settings: { payWeek: MON_SUN, timeTracking: {} } })
    db.tables.payroll_periods.push({ id: 'p-old', org_id: 'org1', cutoff_at: new Date(oldCutoff.getTime() + 59_999).toISOString(), status: 'locked', locked_at: lockedAt, created_at: '2026-10-29T00:00:00Z' })
    return db
  }
  const weekEnding = (db: ReturnType<typeof seed>, periodId: string) => db.tables.payroll_periods.find((p) => p.id === periodId)?.cutoff_at as string

  it('time in the old approved week, tapped after approval, is paid once on the first new-schedule week (ends Sun Nov 8)', async () => {
    const db = withSchedule(new Date(Date.now() - 60_000).toISOString())
    const tue = T('09:00', '2026-11-03')
    await applyClockTap(db.client, crew, tap('clock_in', tue, { workOrderId: WO1, userIds: [U1] }), tue)
    await applyClockTap(db.client, crew, tap('clock_out', T('11:00', '2026-11-03'), { userIds: [U1] }), T('11:00', '2026-11-03'))
    const calls = saveHoursEntries.mock.calls.map((c) => c[1] as { periodId: string; clock?: { timeZone?: string }; entries: Array<{ regular_hours: number; reason: string }> })
    expect(calls.some((c) => c.periodId === 'p-old')).toBe(false)
    const last = calls.at(-1)!
    expect(new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(weekEnding(db, last.periodId)))).toBe('2026-11-08')
    expect(last.entries[0].regular_hours).toBe(2)
    expect(last.entries[0].reason).toMatch(/from the approved week before/)
    expect(last.clock?.timeZone).toBe(TZ)
    // No new week was made for the old week's own days (a Sunday Nov 1 week would overlap the approved one).
    expect(db.tables.payroll_periods.map((p) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(p.cutoff_at as string))).sort()).toEqual(['2026-11-04', '2026-11-08'])
  })

  it('time already paid in the approved week is not paid again: the new week starts right after the old cutoff', async () => {
    const db = withSchedule(new Date(Date.now() + 3_600_000).toISOString()) // approval "after" every tap below
    await applyClockTap(db.client, crew, tap('clock_in', T('09:00', '2026-11-03'), { workOrderId: WO1, userIds: [U1] }), T('09:00', '2026-11-03'))
    await applyClockTap(db.client, crew, tap('clock_out', T('11:00', '2026-11-03'), { userIds: [U1] }), T('11:00', '2026-11-03'))
    saveHoursEntries.mockClear()
    // Thursday Nov 5 is in the new Sunday week (Nov 5–8): only its own hour is paid there.
    await applyClockTap(db.client, crew, tap('clock_in', T('09:00', '2026-11-05'), { workOrderId: WO1, userIds: [U1] }), T('09:00', '2026-11-05'))
    await applyClockTap(db.client, crew, tap('clock_out', T('10:00', '2026-11-05'), { userIds: [U1] }), T('10:00', '2026-11-05'))
    const last = saveHoursEntries.mock.calls.at(-1)![1] as { periodId: string; entries: Array<{ regular_hours: number }> }
    expect(new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(weekEnding(db, last.periodId)))).toBe('2026-11-08')
    expect(last.entries[0].regular_hours).toBe(1)
  })

  it('the office week list for a day in the new schedule runs from the old cutoff to Sunday', async () => {
    const db = withSchedule(new Date(Date.now() - 60_000).toISOString())
    const week = await loadTimeWeek(db.client, 'org1', '2026-11-06', T('12:00', '2026-11-06'))
    expect([week.weekStart, week.weekEnd]).toEqual(['2026-11-05', '2026-11-08'])
    const old = await loadTimeWeek(db.client, 'org1', '2026-11-02', T('12:00', '2026-11-06'))
    expect([old.weekEnd, old.editable]).toEqual(['2026-11-04', false])
  })
})
