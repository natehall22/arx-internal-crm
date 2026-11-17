/**
 * The day clock (kind 'shift'): the pay rule (shift ∪ work ∪ travel − breaks, never underpaying), clock changes and
 * midnight, the taps (crew lead starts the crew, per-person end, no double start, offline replay), job costing of the
 * time no stop covers (measured vs allocated), the payroll feed through the SAME pay-week path, safeguards
 * (forgotten shift, finish question, office edit) and who may use it.
 */
import { DEFAULT_TIMEZONE } from '@/lib/timezone'
import { createFakeDb } from '@/lib/test-helpers/fake-db'

const saveHoursEntries = jest.fn(async (_c: unknown, _i: unknown) => ({ ok: true, saved: [] }))
jest.mock('@/lib/payroll-hours', () => ({
  saveHoursEntries: (c: unknown, i: unknown) => saveHoursEntries(c, i),
  loadPlanForWeek: async () => ({ hourly_rate_override: 20, comp_plans: null }),
}))

import { addTimeEntry, applyClockTap, autoCloseForgotten, editTimeEntry, loadClockState, loadOpenShiftsQueue, loadWorkSecondsByStop, removeTimeEntry, syncTimeFeeds, type ClockActor } from '@/lib/time-tracking-db'
import {
  allocateShiftTime,
  localTimeToInstant,
  paidTime,
  parseClockTap,
  parseEntryEdit,
  shiftReminderAfterHours,
  splitOvertime,
  totalSeconds,
  weekWarnings,
  DEFAULT_TIME_TRACKING_SETTINGS,
  type ClockTap,
  type TimeEntry,
} from '@/lib/time-tracking'
import { LEGACY_PAY_WEEK, nextWeekCutoff, weekCutoffContaining } from '@/lib/payroll-week-schedule'

const TZ = DEFAULT_TIMEZONE
const U1 = 'aaaaaaaa-0000-4000-8000-000000000001'
const U2 = 'aaaaaaaa-0000-4000-8000-000000000002'
const U9 = 'aaaaaaaa-0000-4000-8000-000000000009'
const WO1 = '11111111-1111-4111-8111-000000000001'
const WO2 = '11111111-1111-4111-8111-000000000002'
const JOB1 = '22222222-2222-4222-8222-000000000001'
const JOB2 = '22222222-2222-4222-8222-000000000002'
const T = (hm: string, ymd = '2026-06-10') => localTimeToInstant(ymd, hm, TZ)!
const H = 3_600_000

// ---------------------------------------------------------------------------------------------------------------------
// Pure rules
// ---------------------------------------------------------------------------------------------------------------------

let n = 0
const entry = (kind: TimeEntry['kind'], from: Date, to: Date | null, extra: Partial<TimeEntry> = {}): TimeEntry => ({
  id: `e${++n}`, userId: U1, subId: 's1', workOrderId: null, jobId: null, kind, startedAt: from.toISOString(), endedAt: to ? to.toISOString() : null,
  source: 'lead_tap', endSource: to ? 'lead_tap' : null, closedForTravel: false, needsReview: false, reviewNote: null, pricebookItemId: null, tappedBy: null, endedBy: null, ...extra,
})
const stop = (wo: string, job: string | null, from: Date, to: Date, extra: Partial<TimeEntry> = {}) => entry('work', from, to, { workOrderId: wo, jobId: job, ...extra })
const paidH = (list: TimeEntry[]) => totalSeconds(paidTime(list, { timeZone: TZ }).paid) / 3600

describe('paid time = shift ∪ work ∪ travel − breaks', () => {
  it('the day clock alone pays the whole day minus the break (no stop needed)', () => {
    expect(paidH([entry('shift', T('06:00'), T('16:00')), entry('break', T('12:00'), T('12:30'))])).toBe(9.5)
  })

  it('stop taps inside the shift add nothing (no double counting); a break taken at a stop comes off once', () => {
    const list = [entry('shift', T('06:00'), T('16:00')), stop(WO1, null, T('07:00'), T('10:00')), stop(WO2, JOB1, T('10:30'), T('15:00')), entry('break', T('12:00'), T('12:30'), { workOrderId: WO2, jobId: JOB1 })]
    expect(paidH(list)).toBe(9.5)
  })

  it('never underpays: a stop tapped before the day clock was started, or after it was ended, is still paid', () => {
    expect(paidH([entry('shift', T('08:00'), T('12:00')), stop(WO1, null, T('07:00'), T('09:00')), stop(WO2, null, T('11:00'), T('13:30'))])).toBe(6.5)
  })

  it('forgot the day clock: stops and tapped travel pay exactly as before', () => {
    const list = [stop(WO1, null, T('07:00'), T('09:00'), { closedForTravel: true }), stop(WO2, null, T('09:20'), T('12:00'))]
    expect(paidH(list)).toBe(5)
  })

  it('travel inside a shift is not counted twice; a break over the drive comes off once', () => {
    const list = [entry('shift', T('07:00'), T('12:00')), stop(WO1, null, T('07:00'), T('09:00'), { closedForTravel: true }), stop(WO2, null, T('09:30'), T('12:00')), entry('break', T('09:10'), T('09:20'))]
    expect(paidH(list)).toBe(4 + 5 / 6)
  })

  it('an open shift counts only when "now" is given (payroll takes closed time only)', () => {
    const list = [entry('shift', T('06:00'), null)]
    expect(paidH(list)).toBe(0)
    expect(totalSeconds(paidTime(list, { timeZone: TZ, now: T('08:00').getTime() }).paid)).toBe(2 * 3600)
  })

  it('clock changes: a night shift is 7 h across the spring-forward and 9 h across the fall-back (exact instants)', () => {
    expect(paidH([entry('shift', T('22:00', '2026-03-07'), T('06:00', '2026-03-08'))])).toBe(7)
    expect(paidH([entry('shift', T('22:00', '2026-10-31'), T('06:00', '2026-11-01'))])).toBe(9)
    expect(paidH([entry('shift', T('22:00', '2026-03-06'), T('06:00', '2026-03-07'))])).toBe(8)
    // a daytime shift on the change day itself is unaffected after 2 am
    expect(paidH([entry('shift', T('06:00', '2026-03-08'), T('16:00', '2026-03-08'))])).toBe(10)
  })

  it('a shift across midnight is one stretch; the pay week clips it at the cutoff, nothing lost or doubled', () => {
    const s = entry('shift', T('22:00'), T('06:00', '2026-06-11'))
    expect(paidH([s])).toBe(8)
    const cutoff = T('00:00', '2026-06-11').getTime()
    const t = paidTime([s], { timeZone: TZ })
    const before = totalSeconds(t.paid.map((i) => ({ start: i.start, end: Math.min(i.end, cutoff) })))
    const after = totalSeconds(t.paid.map((i) => ({ start: Math.max(i.start, cutoff), end: i.end })))
    expect([before / 3600, after / 3600]).toEqual([2, 6])
  })

  it('overtime counts shift hours; an open day is a warning; no-break and long-day look at the day clock too', () => {
    const week = [0, 1, 2, 3, 4].map((d) => entry('shift', T('06:00', `2026-06-0${d + 1}`), T('15:00', `2026-06-0${d + 1}`), { id: `w${d}` }))
    const settings = { ...DEFAULT_TIME_TRACKING_SETTINGS, overtimeAfterHours: 40 }
    const weekFrom = T('00:00', '2026-06-01').getTime()
    const weekTo = T('23:59', '2026-06-07').getTime()
    const w = weekWarnings([...week, entry('shift', T('06:00', '2026-06-06'), T('17:00', '2026-06-06'))], { timeZone: TZ, settings, weekFrom, weekTo, now: weekTo })
    expect(w.some((x) => x.code === 'overtime')).toBe(true) // 45 + 11 = 56 h
    expect(w.some((x) => x.code === 'no_break')).toBe(true)
    expect(splitOvertime(56 * 3600, 40)).toEqual({ regularHours: 40, overtimeHours: 16 })
    const open = weekWarnings([entry('shift', T('06:00', '2026-06-03'), null)], { timeZone: TZ, settings, weekFrom, weekTo, now: weekTo })
    expect(open.some((x) => x.code === 'open_clock')).toBe(true)
  })
})

describe('job costing: shift time no stop covers is allocated to that day’s stops', () => {
  const day = [entry('shift', T('06:00'), T('16:00')), entry('break', T('12:00'), T('12:30')), stop(WO1, JOB1, T('07:00'), T('09:00')), stop(WO2, JOB2, T('13:00'), T('15:00'))]

  it('evenly when stops have no expected duration; breaks and measured stop time come out first', () => {
    const r = allocateShiftTime(day, {})
    // 9.5 h paid − 4 h on stops = 5.5 h shared between 2 stops.
    expect(r.stops.map((s) => [s.jobId, s.allocatedSeconds / 3600])).toEqual([[JOB1, 2.75], [JOB2, 2.75]])
    expect(r.unallocatedSeconds).toBe(0)
  })

  it('by expected hours when every stop has one', () => {
    const r = allocateShiftTime(day, { expectedHours: (s) => (s.jobId === JOB1 ? 1 : 3) })
    expect(r.stops.map((s) => [s.jobId, s.allocatedSeconds / 3600])).toEqual([[JOB1, 1.375], [JOB2, 4.125]])
  })

  it('one stop missing an expected duration → even split (never a made-up weight)', () => {
    const r = allocateShiftTime(day, { expectedHours: (s) => (s.jobId === JOB1 ? 1 : null) })
    expect(r.stops.map((s) => s.allocatedSeconds / 3600)).toEqual([2.75, 2.75])
  })

  it('a shift with no stop gives nothing to any job; no shift = no allocation; the total is exact', () => {
    expect(allocateShiftTime([entry('shift', T('06:00'), T('14:00'))], {})).toEqual({ stops: [], unallocatedSeconds: 8 * 3600 })
    expect(allocateShiftTime([stop(WO1, JOB1, T('07:00'), T('09:00'))], {}).stops).toEqual([])
    const odd = allocateShiftTime([entry('shift', T('06:00'), T('06:00:01'.slice(0, 5)) && new Date(T('06:00').getTime() + 10 * 1000)), stop(WO1, JOB1, T('05:00'), T('05:01')), stop(WO2, JOB2, T('05:01'), T('05:02'))], {})
    expect(odd.stops.reduce((a, s) => a + s.allocatedSeconds, 0) + odd.unallocatedSeconds).toBe(10)
  })

  it('a midnight shift allocates over the stops inside it; the pay-week clip only limits the seconds', () => {
    const night = [entry('shift', T('20:00'), T('04:00', '2026-06-11')), stop(WO1, JOB1, T('21:00'), T('23:00'))]
    expect(allocateShiftTime(night, {}).stops[0].allocatedSeconds / 3600).toBe(6)
    const cutoff = T('00:00', '2026-06-11').getTime()
    expect(allocateShiftTime(night, { to: cutoff }).stops[0].allocatedSeconds / 3600).toBe(2) // 20–21 and 23–24
  })
})

describe('taps (parse)', () => {
  const base = { tapId: 'tap-00000001', at: T('06:00').toISOString(), deviceNow: T('06:00').toISOString() }
  it('start / end day name who and never a stop; an empty list never means everyone', () => {
    expect(parseClockTap({ ...base, action: 'day_start', userIds: [U1] })).toMatchObject({ tap: { action: 'day_start', workOrderId: null, jobId: null } })
    expect(parseClockTap({ ...base, action: 'day_start' })).toEqual({ error: 'Pick who' })
    expect(parseClockTap({ ...base, action: 'day_end', userIds: [] })).toEqual({ error: 'Pick who' })
  })
  it('the reminder comes 2 h before the system stops a forgotten clock', () => {
    expect(shiftReminderAfterHours({ autoCloseHours: 12 })).toBe(10)
    expect(shiftReminderAfterHours({ autoCloseHours: 2 })).toBe(1)
  })
  it('the office can type a whole-day entry without a place, but stop time still needs one', () => {
    expect(parseEntryEdit({ userId: U1, kind: 'shift', startedAt: T('06:00').toISOString(), endedAt: T('15:00').toISOString(), reason: 'Forgot' }, { adding: true })).toMatchObject({ edit: { kind: 'shift' } })
    expect(parseEntryEdit({ userId: U1, kind: 'work', startedAt: T('06:00').toISOString(), endedAt: T('15:00').toISOString(), reason: 'Forgot' }, { adding: true })).toEqual({ error: 'Which job or visit?' })
  })
})

// ---------------------------------------------------------------------------------------------------------------------
// The writer on the in-memory database
// ---------------------------------------------------------------------------------------------------------------------

function seed(extra: Record<string, unknown[]> = {}) {
  return createFakeDb(
    {
      orgs: [{ id: 'org1', timezone: TZ }],
      users: [
        { id: U1, org_id: 'org1', full_name: 'Lead Larry', active: true },
        { id: U2, org_id: 'org1', full_name: 'Crew Carla', active: true },
        { id: U9, org_id: 'org1', full_name: 'Setter Sam', role: 'setter', active: true },
      ],
      sub_contractors: [{ id: 's1', org_id: 'org1', company_name: 'Green Team', tracks_time: true, active: true }],
      crew_members: [
        { id: 'cm1', org_id: 'org1', sub_id: 's1', user_id: U1, is_lead: true },
        { id: 'cm2', org_id: 'org1', sub_id: 's1', user_id: U2, is_lead: false },
      ],
      work_orders: [
        { id: WO1, org_id: 'org1', assigned_sub_id: 's1', job_id: JOB1, status: 'scheduled', title: 'Mow' },
        { id: WO2, org_id: 'org1', assigned_sub_id: 's1', job_id: JOB2, status: 'scheduled', title: 'Mulch' },
      ],
      production_jobs: [
        { id: JOB1, org_id: 'org1', job_number: '26-0141', status: 'scheduled', estimated_duration_hours: null },
        { id: JOB2, org_id: 'org1', job_number: '26-0142', status: 'scheduled', estimated_duration_hours: null },
      ],
      time_entries: [],
      time_entry_changes: [],
      job_cost_lines: [],
      payroll_periods: [],
      payroll_rep_hours: [],
      ...extra,
    },
    { unique: { time_entries: [['org_id', 'client_tap_id', 'kind', 'user_id']] } }
  )
}
type Db = ReturnType<typeof seed>

let k = 0
function tap(action: ClockTap['action'], at: Date, extra: Record<string, unknown> = {}): ClockTap {
  const people = ['clock_in', 'clock_out', 'break_start', 'break_end', 'day_start', 'day_end'].includes(action) && !('userIds' in extra) ? { userIds: [U1, U2] } : {}
  const p = parseClockTap({ tapId: `tap-${String(++k).padStart(8, '0')}`, action, at: at.toISOString(), deviceNow: at.toISOString(), ...people, ...extra })
  if ('error' in p) throw new Error(p.error)
  return p.tap
}
const crew: ClockActor = { via: 'crew_link', orgId: 'org1', subId: 's1' }
const open = (db: Db, kind: string) => db.tables.time_entries.filter((e) => e.kind === kind && !e.ended_at && !e.removed_at)
type Saved = { periodId: string; source: string; entries: Array<{ user_id: string; regular_hours: number; overtime_hours: number; reason: string }> }
const last = () => saveHoursEntries.mock.calls.at(-1)![1] as Saved
/** The latest payroll hours write for one person. */
const lastFor = (userId: string) => (saveHoursEntries.mock.calls.map((c) => c[1] as Saved).filter((c) => c.entries[0].user_id === userId).at(-1) as Saved).entries[0]

beforeEach(() => saveHoursEntries.mockClear())

describe('start / end the day', () => {
  it('the crew lead starts the day for the ticked crew with no stop; end day ends it for all', async () => {
    const db = seed()
    expect(await applyClockTap(db.client, crew, tap('day_start', T('06:00'), { tappedBy: U1 }), T('06:00'))).toEqual({ ok: true, done: 2 })
    expect(open(db, 'shift').map((e) => e.user_id).sort()).toEqual([U1, U2])
    expect(open(db, 'shift')[0].work_order_id ?? null).toBeNull()
    expect(open(db, 'shift')[0].production_job_id ?? null).toBeNull()
    expect(open(db, 'shift')[0]).toMatchObject({ sub_id: 's1', source: 'lead_tap', tapped_by_user_id: U1, tapped_via: 'crew_link' })
    expect(await applyClockTap(db.client, crew, tap('day_end', T('16:00'), { tappedBy: U1 }), T('16:00'))).toEqual({ ok: true, done: 2 })
    expect(open(db, 'shift')).toHaveLength(0)
    expect(db.tables.time_entries.every((e) => e.ended_at === T('16:00').toISOString() && e.end_source === 'lead_tap')).toBe(true)
  })

  it('untick who is not working; end day for one person leaves the rest on the clock', async () => {
    const db = seed()
    await applyClockTap(db.client, crew, tap('day_start', T('06:00'), { userIds: [U1] }), T('06:00'))
    expect(open(db, 'shift').map((e) => e.user_id)).toEqual([U1])
    await applyClockTap(db.client, crew, tap('day_start', T('07:00'), { userIds: [U1, U2] }), T('07:00')) // U2 arrives late; U1 not doubled
    expect(open(db, 'shift')).toHaveLength(2)
    expect(db.tables.time_entries.filter((e) => e.user_id === U1 && e.kind === 'shift')).toHaveLength(1)
    await applyClockTap(db.client, crew, tap('day_end', T('14:00'), { userIds: [U2] }), T('14:00'))
    expect(open(db, 'shift').map((e) => e.user_id)).toEqual([U1])
  })

  it('no double clock-in: a second Start day, from another phone or the same tap resent, changes nothing', async () => {
    const db = seed()
    const t = tap('day_start', T('06:00'))
    await applyClockTap(db.client, crew, t, T('06:00'))
    expect(await applyClockTap(db.client, crew, tap('day_start', T('06:01')), T('06:01'))).toEqual({ ok: true, done: 0 })
    expect(await applyClockTap(db.client, crew, t, T('06:02'))).toEqual({ ok: true, done: 0 })
    expect(db.tables.time_entries).toHaveLength(2)
  })

  it('offline queue replay: start, break and end tapped without signal arrive late and in order with device times; a full replay is a no-op', async () => {
    const db = seed()
    const queue = [tap('day_start', T('06:00')), tap('break_start', T('12:00')), tap('break_end', T('12:30')), tap('day_end', T('16:00'))]
    const sentAt = T('18:00') // everything reaches the server hours later
    const send = (list: ClockTap[]) => list.reduce(async (p, t) => { await p; await applyClockTap(db.client, crew, { ...t, deviceNow: sentAt.toISOString() }, sentAt) }, Promise.resolve())
    await send(queue)
    expect(db.tables.time_entries.map((e) => [e.kind, e.started_at, e.ended_at])).toEqual([
      ['shift', T('06:00').toISOString(), T('16:00').toISOString()], ['shift', T('06:00').toISOString(), T('16:00').toISOString()],
      ['break', T('12:00').toISOString(), T('12:30').toISOString()], ['break', T('12:00').toISOString(), T('12:30').toISOString()],
    ])
    const before = JSON.stringify(db.tables.time_entries)
    await send(queue) // the phone resends everything (lost responses)
    expect(JSON.stringify(db.tables.time_entries)).toBe(before)
    // Paid: 6:00–16:00 minus the 30 min break = 9.5 h each.
    expect(last().entries[0]).toMatchObject({ regular_hours: 9.5, reason: 'Time clock' })
  })

  it('a break is taken from the day clock (no stop open) and ends with the day', async () => {
    const db = seed()
    await applyClockTap(db.client, crew, tap('break_start', T('07:00')), T('07:00')) // nothing to take a break from
    expect(db.tables.time_entries).toHaveLength(0)
    await applyClockTap(db.client, crew, tap('day_start', T('06:00')), T('06:00'))
    await applyClockTap(db.client, crew, tap('break_start', T('12:00')), T('12:00'))
    expect(open(db, 'break')).toHaveLength(2)
    expect(open(db, 'break')[0]).toMatchObject({ work_order_id: null, production_job_id: null })
    await applyClockTap(db.client, crew, tap('day_end', T('12:20')), T('12:20')) // ends the break too
    expect(open(db, 'break')).toHaveLength(0)
    expect(open(db, 'shift')).toHaveLength(0)
  })

  it('end day also stops a stop clock and the machines; stop taps and the day clock together pay once', async () => {
    const db = seed()
    await applyClockTap(db.client, crew, tap('day_start', T('06:00')), T('06:00'))
    await applyClockTap(db.client, crew, tap('clock_in', T('07:00'), { workOrderId: WO1 }), T('07:00'))
    await applyClockTap(db.client, crew, tap('day_end', T('15:00')), T('15:00'))
    expect(db.tables.time_entries.filter((e) => !e.ended_at)).toHaveLength(0)
    expect(lastFor(U1)).toMatchObject({ regular_hours: 9 }) // 06:00–15:00, the stop is inside it
  })

  it('a start before the database update is applied says so instead of failing', async () => {
    const db = seed()
    const real = (db.client as unknown as { from: (t: string) => unknown }).from.bind(db.client)
    ;(db.client as unknown as { from: unknown }).from = (t: string) => {
      const q = real(t) as { insert: (r: Record<string, unknown>) => unknown }
      if (t !== 'time_entries') return q
      return new Proxy(q, { get: (o, p) => (p === 'insert' ? (row: Record<string, unknown>) => (row.kind === 'shift' ? Promise.resolve({ data: null, error: { code: '23514', message: 'new row for relation "time_entries" violates check constraint "time_entries_where"' } }) : o.insert(row)) : (o as never)[p]) })
    }
    expect(await applyClockTap(db.client, crew, tap('day_start', T('06:00')), T('06:00'))).toMatchObject({ ok: false, status: 503, error: expect.stringMatching(/day clock turns on once/) })
  })
})

describe('payroll + job cost feeds', () => {
  it('the day clock flows through the same payroll hours feed: regular up to the overtime line, the rest overtime', async () => {
    const db = seed()
    // Four 11 h days inside one Thu–Wed pay week (under the 12 h forgotten-clock limit).
    const days = ['2026-06-05', '2026-06-08', '2026-06-09', '2026-06-10']
    await applyClockTap(db.client, crew, tap('day_start', T('06:00', days[0]), { userIds: [U1] }), T('06:00', days[0]))
    await applyClockTap(db.client, crew, tap('day_end', T('17:00', days[0]), { userIds: [U1] }), T('17:00', days[0]))
    expect(last()).toMatchObject({ source: 'clock', entries: [{ user_id: U1, regular_hours: 11, overtime_hours: 0, reason: 'Time clock' }] })
    for (const d of days.slice(1)) {
      await applyClockTap(db.client, crew, tap('day_start', T('06:00', d), { userIds: [U1] }), T('06:00', d))
      await applyClockTap(db.client, crew, tap('day_end', T('17:00', d), { userIds: [U1] }), T('17:00', d))
    }
    expect(last().entries[0]).toMatchObject({ regular_hours: 40, overtime_hours: 4 })
  })

  it('a locked (approved) week is never changed: the day’s time is kept, flagged, and paid on the next open week', async () => {
    const db = seed()
    const cutoff = weekCutoffContaining(T('06:00'), { ...LEGACY_PAY_WEEK, timeZone: TZ })
    db.tables.payroll_periods.push({ id: 'p1', org_id: 'org1', cutoff_at: cutoff.toISOString(), status: 'locked', locked_at: cutoff.toISOString() })
    await applyClockTap(db.client, crew, tap('day_start', T('06:00'), { userIds: [U1] }), T('06:00'))
    await applyClockTap(db.client, crew, tap('day_end', T('14:00'), { userIds: [U1] }), T('14:00'))
    expect(saveHoursEntries.mock.calls.some((c) => (c[1] as { periodId: string }).periodId === 'p1')).toBe(false)
    expect(last().entries[0].regular_hours).toBe(8)
    expect(db.tables.time_entries.every((e) => e.needs_review === true)).toBe(true)
  })

  it('job labor: stop taps are measured, the rest of the day is allocated and labelled as such; pay is unchanged', async () => {
    const db = seed()
    await applyClockTap(db.client, crew, tap('day_start', T('06:00'), { userIds: [U1] }), T('06:00'))
    await applyClockTap(db.client, crew, tap('clock_in', T('07:00'), { workOrderId: WO1, userIds: [U1] }), T('07:00'))
    await applyClockTap(db.client, crew, tap('clock_out', T('09:00'), { userIds: [U1] }), T('09:00'))
    await applyClockTap(db.client, crew, tap('clock_in', T('13:00'), { workOrderId: WO2, userIds: [U1] }), T('13:00'))
    await applyClockTap(db.client, crew, tap('clock_out', T('15:00'), { userIds: [U1] }), T('15:00'))
    await applyClockTap(db.client, crew, tap('day_end', T('16:00'), { userIds: [U1] }), T('16:00'))
    // 10 h day, 4 h on stops → 6 h shared: 3 h each. Each job = 2 h measured + 3 h allocated = 5 h × $20.
    const lines = db.tables.job_cost_lines
    expect(lines.map((l) => [l.job_id, l.amount]).sort()).toEqual([[JOB1, 100], [JOB2, 100]])
    expect(String(lines[0].description)).toMatch(/5 h: 2 h measured \+ 3 h allocated from the day clock/)
    // Payroll pays the whole day once: 10 h (never 10 + 4).
    expect(last().entries[0].regular_hours).toBe(10)
  })

  it('ending the day alone (no stop tapped just now) still refreshes the jobs of that day’s stops', async () => {
    const db = seed()
    await applyClockTap(db.client, crew, tap('clock_in', T('07:00'), { workOrderId: WO1, userIds: [U1] }), T('07:00'))
    await applyClockTap(db.client, crew, tap('clock_out', T('09:00'), { userIds: [U1] }), T('09:00'))
    expect(db.tables.job_cost_lines[0].amount).toBe(40)
    await addTimeEntry(db.client, 'org1', U2, { userId: U1, kind: 'shift', startedAt: T('06:00').toISOString(), endedAt: T('10:00').toISOString() }, 'Forgot the day clock')
    expect(db.tables.job_cost_lines).toHaveLength(1)
    expect(db.tables.job_cost_lines[0].amount).toBe(80) // 2 h measured + 2 h allocated
  })

  it('the dashboard hours read ignores the day clock and writes nothing', async () => {
    const db = seed()
    await applyClockTap(db.client, crew, tap('day_start', T('06:00'), { userIds: [U1] }), T('06:00'))
    await applyClockTap(db.client, crew, tap('day_end', T('14:00'), { userIds: [U1] }), T('14:00'))
    const snapshot = JSON.stringify(db.tables)
    const secs = await loadWorkSecondsByStop(db.client, 'org1', { fromIso: T('00:00').toISOString(), toIso: T('23:59').toISOString(), workOrderIds: [WO1, WO2] })
    expect(secs?.size).toBe(0)
    expect(JSON.stringify(db.tables)).toBe(snapshot)
  })
})

describe('forgotten day clock', () => {
  it('is stopped like any forgotten clock (included in the rule), flagged, asked once next morning, and the stop clocks inside it are answered by the same finish time', async () => {
    const db = seed()
    await applyClockTap(db.client, crew, tap('day_start', T('06:00'), { userIds: [U1] }), T('06:00'))
    await applyClockTap(db.client, crew, tap('clock_in', T('07:00'), { workOrderId: WO1, userIds: [U1] }), T('07:00'))
    await applyClockTap(db.client, crew, tap('clock_out', T('11:00'), { userIds: [U1], forTravel: true }), T('11:00'))
    await applyClockTap(db.client, crew, tap('clock_in', T('11:30'), { workOrderId: WO2, userIds: [U1] }), T('11:30'))
    const morning = T('06:30', '2026-06-11')
    expect(await autoCloseForgotten(db.client, 'org1', { now: morning })).toBe(2)
    const sh = db.tables.time_entries.find((e) => e.kind === 'shift')!
    expect(sh).toMatchObject({ end_source: 'auto_closed', needs_review: true, ended_at: T('11:30').toISOString() })
    // the owner's "needs a finish time" list sees it
    expect((await loadOpenShiftsQueue(db.client, 'org1', morning))?.count).toBe(2)
    const ids = db.tables.time_entries.map((e, i) => (e.id = `bbbbbbbb-0000-4000-8000-0000000000${String(i + 10)}`))
    for (const c of db.tables.time_entry_changes) c.time_entry_id = ids[0]
    const state = await loadClockState(db.client, crew, morning)
    expect(state.finishQuestions.map((q) => q.entryId)).toEqual([sh.id]) // one question, not two
    expect(await applyClockTap(db.client, crew, tap('finish_answer', morning, { entryId: sh.id, finishTime: '16:00', tappedBy: U1 }), morning)).toEqual({ ok: true, done: 1 })
    expect(sh).toMatchObject({ ended_at: T('16:00').toISOString(), end_source: 'typed', needs_review: false })
    expect(db.tables.time_entries.filter((e) => e.kind === 'work').every((e) => !e.needs_review)).toBe(true)
  })

  it('the phone is told to ask "still working?" shortly before the system stops the day', async () => {
    const db = seed()
    await applyClockTap(db.client, crew, tap('day_start', T('06:00'), { userIds: [U1] }), T('06:00'))
    expect((await loadClockState(db.client, crew, T('12:00'))).people.find((p) => p.userId === U1)).toMatchObject({ shift: { startedAt: T('06:00').toISOString() }, shiftLate: false })
    expect((await loadClockState(db.client, crew, T('16:30'))).people.find((p) => p.userId === U1)).toMatchObject({ shiftLate: true })
  })
})

describe('office edits and who may use it', () => {
  it('the office adds / edits a whole-day entry with a reason; changing it to stop time needs a stop; history is kept', async () => {
    const db = seed()
    const added = await addTimeEntry(db.client, 'org1', U2, { userId: U1, kind: 'shift', startedAt: T('06:00').toISOString(), endedAt: T('15:00').toISOString() }, 'Forgot the day clock')
    expect(added).toMatchObject({ ok: true })
    const id = (added as { id: string }).id
    expect(db.tables.time_entries[0]).toMatchObject({ kind: 'shift', work_order_id: null, tapped_via: 'office', source: 'typed' })
    expect(await editTimeEntry(db.client, 'org1', U2, id, { endedAt: T('16:00').toISOString() }, 'Left at 4')).toEqual({ ok: true })
    expect(await editTimeEntry(db.client, 'org1', U2, id, { kind: 'work' }, 'Make it stop time')).toMatchObject({ ok: false, status: 400, error: 'Which job or visit?' })
    expect(db.tables.time_entry_changes.map((c) => c.action)).toEqual(['added', 'updated'])
  })

  it('crew-link scope only: people named from another crew or a setter are refused, and the screen carries no pay', async () => {
    const db = seed()
    expect(await applyClockTap(db.client, crew, tap('day_start', T('06:00'), { userIds: [U9] }), T('06:00'))).toMatchObject({ ok: false, status: 400 })
    expect(db.tables.time_entries).toHaveLength(0)
    const state = await loadClockState(db.client, crew, T('06:30'))
    expect(JSON.stringify(state)).not.toMatch(/rate|wage|pay|amount|cost/i)
  })

  it('signed in: a crew member starts and ends only their own day; a lead starts the crew; a setter gets nothing', async () => {
    const db = seed()
    const carla: ClockActor = { via: 'signed_in', orgId: 'org1', userId: U2 }
    await applyClockTap(db.client, carla, tap('day_start', T('06:00'), { userIds: [U2, U1] }), T('06:00'))
    expect(open(db, 'shift').map((e) => [e.user_id, e.source])).toEqual([[U2, 'lead_tap']]) // asked for Larry too: not hers to start
    const db2 = seed()
    await applyClockTap(db2.client, carla, tap('day_start', T('06:00'), { userIds: [U2] }), T('06:00'))
    expect(open(db2, 'shift')[0]).toMatchObject({ source: 'self_tap', tapped_via: 'signed_in', sub_id: 's1' })
    await applyClockTap(db2.client, carla, tap('day_end', T('15:00'), { userIds: [U2] }), T('15:00'))
    expect(open(db2, 'shift')).toHaveLength(0)
    const larry: ClockActor = { via: 'signed_in', orgId: 'org1', userId: U1 }
    const db3 = seed()
    await applyClockTap(db3.client, larry, tap('day_start', T('06:00')), T('06:00'))
    expect(open(db3, 'shift').map((e) => e.user_id).sort()).toEqual([U1, U2])
    const setter: ClockActor = { via: 'signed_in', orgId: 'org1', userId: U9 }
    expect(await applyClockTap(db3.client, setter, tap('day_start', T('06:00'), { userIds: [U9] }), T('06:00'))).toMatchObject({ ok: false, status: 403 })
  })
})

// ---------------------------------------------------------------------------------------------------------------------
// Review fixes
// ---------------------------------------------------------------------------------------------------------------------

describe('approved-week carry-over pays only what the approved week did not', () => {
  // A day 7–17 with stops 8–16; the week is approved while the day clock is still open; End day is recorded the next Monday.
  async function run(dayYmd: string, endYmd: string, shiftFrom: string, shiftTo: string, stopFrom: string, stopTo: string, laterYmd: string) {
    const db = seed()
    const sh = T(shiftFrom, dayYmd)
    const cutoff = weekCutoffContaining(sh, { ...LEGACY_PAY_WEEK, timeZone: TZ })
    const approvedAt = new Date(cutoff.getTime() + 60_000).toISOString()
    db.tables.payroll_periods.push({ id: 'p1', org_id: 'org1', cutoff_at: cutoff.toISOString(), status: 'locked', locked_at: approvedAt, lock_claimed_at: approvedAt })
    const base = { org_id: 'org1', user_id: U1, sub_id: 's1', source: 'lead_tap', end_source: 'lead_tap', needs_review: false }
    db.tables.time_entries.push(
      { ...base, id: 'stop1', kind: 'work', work_order_id: WO1, production_job_id: JOB1, started_at: T(stopFrom, dayYmd).toISOString(), ended_at: T(stopTo, endYmd).toISOString(), ended_recorded_at: T(stopTo, endYmd).toISOString() },
      { ...base, id: 'day1', kind: 'shift', started_at: sh.toISOString(), ended_at: T(shiftTo, endYmd).toISOString(), ended_recorded_at: T('09:00', laterYmd).toISOString() }
    )
    await syncTimeFeeds(db.client, 'org1', { userIds: [U1], instants: [T('09:00', laterYmd).toISOString()], jobIds: [], actorUserId: U1 })
    return lastFor(U1)
  }
  it('day 7:00–17:00 with stops 8:00–16:00, End day after approval → carries 2 h, not 10 h', async () => {
    const r = await run('2026-06-09', '2026-06-09', '07:00', '17:00', '08:00', '16:00', '2026-06-15')
    expect(r.regular_hours + r.overtime_hours).toBe(2)
    expect(r.reason).toMatch(/2 h from the approved week/)
  })
  it('across the March clock change (a night day over spring-forward): 22:00–06:00 is 7 h, stop 23:00–05:00 is 5 h → carries 2 h', async () => {
    // Sat 2026-03-07 22:00 EST → Sun 2026-03-08 06:00 EDT
    const r = await run('2026-03-07', '2026-03-08', '22:00', '06:00', '23:00', '05:00', '2026-03-16')
    expect(r.regular_hours + r.overtime_hours).toBe(2)
  })
  it('across the November clock change (fall-back): 22:00–06:00 is 9 h, stop 23:00–05:00 is 7 h → carries 2 h', async () => {
    // Sat 2026-10-31 22:00 EDT → Sun 2026-11-01 06:00 EST
    const r = await run('2026-10-31', '2026-11-01', '22:00', '06:00', '23:00', '05:00', '2026-11-09')
    expect(r.regular_hours + r.overtime_hours).toBe(2)
  })
})

describe('removing or editing a day recosts every job on that person’s stops', () => {
  async function day(db: Db) {
    await applyClockTap(db.client, crew, tap('day_start', T('06:00'), { userIds: [U1] }), T('06:00'))
    await applyClockTap(db.client, crew, tap('clock_in', T('07:00'), { workOrderId: WO1, userIds: [U1] }), T('07:00'))
    await applyClockTap(db.client, crew, tap('clock_out', T('09:00'), { userIds: [U1] }), T('09:00'))
    await applyClockTap(db.client, crew, tap('clock_in', T('13:00'), { workOrderId: WO2, userIds: [U1] }), T('13:00'))
    await applyClockTap(db.client, crew, tap('clock_out', T('15:00'), { userIds: [U1] }), T('15:00'))
    await applyClockTap(db.client, crew, tap('day_end', T('16:00'), { userIds: [U1] }), T('16:00'))
  }
  it('remove the whole-day entry: both jobs fall back to their measured 2 h', async () => {
    const db = seed()
    await day(db)
    expect(db.tables.job_cost_lines.map((l) => l.amount).sort()).toEqual([100, 100])
    const shift = db.tables.time_entries.find((e) => e.kind === 'shift')!
    expect(await removeTimeEntry(db.client, 'org1', U2, String(shift.id), 'Entered by mistake')).toEqual({ ok: true })
    expect(db.tables.job_cost_lines.filter((l) => !l.deleted_at).map((l) => l.amount).sort()).toEqual([40, 40])
  })
  it('shorten it: both jobs follow', async () => {
    const db = seed()
    await day(db)
    const shift = db.tables.time_entries.find((e) => e.kind === 'shift')!
    // 06:00–16:00 → 06:00–15:00: 9 h day, 4 h on stops → 5 h shared = 2.5 each → 4.5 h × $20
    expect(await editTimeEntry(db.client, 'org1', U2, String(shift.id), { endedAt: T('15:00').toISOString() }, 'Left early')).toEqual({ ok: true })
    expect(db.tables.job_cost_lines.filter((l) => !l.deleted_at).map((l) => l.amount).sort()).toEqual([90, 90])
  })
})

describe('Field Tech on the day clock', () => {
  it('a Field Tech on no crew can’t clock; on a crew they start their own day', async () => {
    const F = 'aaaaaaaa-0000-4000-8000-0000000000f1'
    const db = seed({ users: [{ id: F, org_id: 'org1', full_name: 'Tech Tim', role: 'field_tech', active: true }, { id: U1, org_id: 'org1', full_name: 'Lead Larry', active: true }] })
    const tim: ClockActor = { via: 'signed_in', orgId: 'org1', userId: F }
    expect(await applyClockTap(db.client, tim, tap('day_start', T('06:00'), { userIds: [F] }), T('06:00'))).toMatchObject({ ok: false, status: 403 })
    db.tables.crew_members.push({ id: 'cm9', org_id: 'org1', sub_id: 's1', user_id: F, is_lead: false })
    expect(await applyClockTap(db.client, tim, tap('day_start', T('06:00'), { userIds: [F] }), T('06:00'))).toEqual({ ok: true, done: 1 })
    expect(open(db, 'shift')[0]).toMatchObject({ user_id: F, sub_id: 's1' })
  })
})

describe('Start day with yesterday’s day still open', () => {
  it('an open day from an earlier date is stopped first, flagged forgotten; today’s day then starts', async () => {
    const db = seed()
    await applyClockTap(db.client, crew, tap('day_start', T('20:00', '2026-06-09'), { userIds: [U1] }), T('20:00', '2026-06-09'))
    expect(await applyClockTap(db.client, crew, tap('day_start', T('06:00'), { userIds: [U1] }), T('06:00'))).toEqual({ ok: true, done: 1 })
    const shifts = db.tables.time_entries.filter((e) => e.kind === 'shift')
    expect(shifts).toHaveLength(2)
    expect(shifts[0]).toMatchObject({ end_source: 'auto_closed', needs_review: true })
    expect(shifts[1].ended_at ?? null).toBeNull()
  })
  it('the same date is not forgotten: a second Start day changes nothing', async () => {
    const db = seed()
    await applyClockTap(db.client, crew, tap('day_start', T('06:00'), { userIds: [U1] }), T('06:00'))
    expect(await applyClockTap(db.client, crew, tap('day_start', T('13:00'), { userIds: [U1] }), T('13:00'))).toEqual({ ok: true, done: 0 })
    expect(db.tables.time_entries.filter((e) => e.kind === 'shift')).toHaveLength(1)
  })
})

describe('a tech on two crews has one day, filed under one crew', () => {
  const twoCrews = () =>
    seed({
      sub_contractors: [
        { id: 's1', org_id: 'org1', company_name: 'Green Team', tracks_time: true, active: true },
        { id: 's2', org_id: 'org1', company_name: 'Mulch Team', tracks_time: true, active: true },
      ],
      crew_members: [
        { id: 'cm1', org_id: 'org1', sub_id: 's1', user_id: U1, is_lead: true },
        { id: 'cm2', org_id: 'org1', sub_id: 's1', user_id: U2, is_lead: false },
        { id: 'cm3', org_id: 'org1', sub_id: 's2', user_id: U2, is_lead: false },
      ],
    })
  const carla: ClockActor = { via: 'signed_in', orgId: 'org1', userId: U2 }
  it('filed under the crew of today’s first stop', async () => {
    const db = twoCrews()
    db.tables.time_entries.push({ id: 'st', org_id: 'org1', user_id: U2, sub_id: 's2', kind: 'work', work_order_id: WO2, production_job_id: JOB2, started_at: T('05:30').toISOString(), ended_at: T('05:50').toISOString(), source: 'self_tap', end_source: 'self_tap' })
    await applyClockTap(db.client, carla, tap('day_start', T('06:00'), { userIds: [U2] }), T('06:00'))
    expect(open(db, 'shift')[0].sub_id).toBe('s2')
  })
  it('no stop yet → their first crew', async () => {
    const db = twoCrews()
    await applyClockTap(db.client, carla, tap('day_start', T('06:00'), { userIds: [U2] }), T('06:00'))
    expect(open(db, 'shift')[0].sub_id).toBe('s1')
  })
})

describe('paid today shown with the day clock', () => {
  it('the clock state carries each person’s paid seconds today (day ∪ stops, breaks out)', async () => {
    const db = seed()
    await applyClockTap(db.client, crew, tap('day_start', T('06:00'), { userIds: [U1] }), T('06:00'))
    const p = (await loadClockState(db.client, crew, T('12:00'))).people.find((x) => x.userId === U1)!
    expect(p.paidTodaySeconds).toBe(6 * 3600)
  })
})

describe('a forgotten day is closed at its own day’s last tap, never at a tap made after it', () => {
  async function run(dayYmd: string, nextYmd: string, extraTapAt: string | null) {
    const db = seed()
    await applyClockTap(db.client, crew, tap('day_start', T('19:30', dayYmd), { userIds: [U1] }), T('19:30', dayYmd))
    if (extraTapAt) {
      await applyClockTap(db.client, crew, tap('clock_in', T(extraTapAt, dayYmd), { workOrderId: WO1, userIds: [U1] }), T(extraTapAt, dayYmd))
      await applyClockTap(db.client, crew, tap('clock_out', T('23:55', dayYmd), { userIds: [U1] }), T('23:55', dayYmd))
    }
    // The next morning: a stop tap at 06:50, then Start day.
    await applyClockTap(db.client, crew, tap('clock_in', T('06:50', nextYmd), { workOrderId: WO1, userIds: [U1] }), T('06:50', nextYmd))
    await applyClockTap(db.client, crew, tap('clock_out', T('06:55', nextYmd), { userIds: [U1] }), T('06:55', nextYmd))
    await applyClockTap(db.client, crew, tap('day_start', T('07:00', nextYmd), { userIds: [U1] }), T('07:00', nextYmd))
    const old = db.tables.time_entries.find((e) => e.kind === 'shift' && e.end_source === 'auto_closed')!
    return { old, dayYmd, nextYmd }
  }
  it('day started 19:30, no end, no other tap that day → ends at its start (pays 0), not at 06:50 today', async () => {
    const { old } = await run('2026-06-09', '2026-06-10', null)
    expect(new Date(String(old.ended_at)).toISOString()).toBe(T('19:30', '2026-06-09').toISOString())
    expect(old.review_note).toMatch(/pays 0/)
  })
  it('a stop tapped that evening is the last tap (23:55), still not today’s 06:55', async () => {
    const { old } = await run('2026-06-09', '2026-06-10', '21:00')
    expect(new Date(String(old.ended_at)).toISOString()).toBe(T('23:55', '2026-06-09').toISOString())
  })
  it('over the November clock change (25-hour day) and the March one (23-hour day)', async () => {
    const nov = await run('2026-11-01', '2026-11-02', null)
    expect(new Date(String(nov.old.ended_at)).toISOString()).toBe(T('19:30', '2026-11-01').toISOString())
    const novTap = await run('2026-11-01', '2026-11-02', '21:00')
    expect(new Date(String(novTap.old.ended_at)).toISOString()).toBe(T('23:55', '2026-11-01').toISOString())
    const mar = await run('2026-03-08', '2026-03-09', '21:00')
    expect(new Date(String(mar.old.ended_at)).toISOString()).toBe(T('23:55', '2026-03-08').toISOString())
  })
  it('a stop tapped after local midnight is not evidence for the night before: the day ends at its last tap that day', async () => {
    const db = seed()
    const startedAt = T('19:30', '2026-06-09')
    db.tables.time_entries.push({ id: 'old', org_id: 'org1', user_id: U1, sub_id: 's1', kind: 'shift', started_at: startedAt.toISOString(), ended_at: null, source: 'lead_tap' })
    db.tables.time_entries.push({ id: 'early', org_id: 'org1', user_id: U1, sub_id: 's1', kind: 'work', work_order_id: WO1, production_job_id: JOB1, started_at: T('21:00', '2026-06-09').toISOString(), ended_at: T('22:00', '2026-06-09').toISOString(), source: 'lead_tap', end_source: 'lead_tap' })
    db.tables.time_entries.push({ id: 'late', org_id: 'org1', user_id: U1, sub_id: 's1', kind: 'work', work_order_id: WO1, production_job_id: JOB1, started_at: T('01:00', '2026-06-10').toISOString(), ended_at: T('02:00', '2026-06-10').toISOString(), source: 'lead_tap', end_source: 'lead_tap' })
    expect(await autoCloseForgotten(db.client, 'org1', { now: T('09:00', '2026-06-10') })).toBe(1)
    expect(new Date(String(db.tables.time_entries[0].ended_at)).toISOString()).toBe(T('22:00', '2026-06-09').toISOString())
  })
})

const F1 = '33333333-3333-4333-8333-000000000001'
describe('approved weeks: late ends, late breaks, spanning the cutoff, several weeks in a row', () => {
  const pw = { ...LEGACY_PAY_WEEK, timeZone: TZ }
  const base = { org_id: 'org1', user_id: U1, sub_id: 's1', source: 'lead_tap', end_source: 'lead_tap', needs_review: false }
  const approve = (db: Db, id: string, cutoff: Date) => {
    const at = new Date(cutoff.getTime() + 60_000).toISOString()
    db.tables.payroll_periods.push({ id, org_id: 'org1', cutoff_at: cutoff.toISOString(), status: 'locked', locked_at: at, lock_claimed_at: null, approval_claimed_at: at })
  }
  const sync = (db: Db, at: Date) => syncTimeFeeds(db.client, 'org1', { userIds: [U1], instants: [at.toISOString()], jobIds: [], actorUserId: U1 })

  it('a forgotten day answered after its week was approved is recorded, and carried into the next open week', async () => {
    const db = seed()
    const cutoff = weekCutoffContaining(T('07:00', '2026-06-09'), pw)
    approve(db, 'p1', cutoff)
    db.tables.time_entries.push({ ...base, id: F1, kind: 'shift', started_at: T('07:00', '2026-06-09').toISOString(), ended_at: T('07:00', '2026-06-09').toISOString(), end_source: 'auto_closed', needs_review: true, ended_recorded_at: T('07:00', '2026-06-09').toISOString() })
    const r = await applyClockTap(db.client, crew, tap('finish_answer', T('09:00', '2026-06-15'), { entryId: F1, finishTime: '17:00', userIds: undefined }), T('09:00', '2026-06-15'))
    expect(r).toEqual({ ok: true, done: 1 })
    const e = db.tables.time_entries[0]
    expect(new Date(String(e.ended_at)).toISOString()).toBe(T('17:00', '2026-06-09').toISOString())
    expect(Date.parse(String(e.ended_recorded_at))).toBeGreaterThan(cutoff.getTime())
    const saved = lastFor(U1)
    expect(saved.regular_hours + saved.overtime_hours).toBe(10)
    expect(saved.reason).toMatch(/from the approved week/)
    // the office’s own edit of an entry in that week is still refused
    expect(await editTimeEntry(db.client, 'org1', U2, F1, { endedAt: T('16:00', '2026-06-09').toISOString() }, 'Fix')).toMatchObject({ ok: false, status: 409 })
  })

  it('a second sync after a carry writes the same total (nothing doubled, nothing lost)', async () => {
    const db = seed()
    const cutoff = weekCutoffContaining(T('07:00', '2026-06-09'), pw)
    approve(db, 'p1', cutoff)
    db.tables.time_entries.push(
      { ...base, id: 'stop', kind: 'work', work_order_id: WO1, production_job_id: JOB1, started_at: T('08:00', '2026-06-09').toISOString(), ended_at: T('16:00', '2026-06-09').toISOString(), ended_recorded_at: T('16:00', '2026-06-09').toISOString() },
      { ...base, id: 'day', kind: 'shift', started_at: T('07:00', '2026-06-09').toISOString(), ended_at: T('17:00', '2026-06-09').toISOString(), ended_recorded_at: T('09:00', '2026-06-15').toISOString() }
    )
    await sync(db, T('09:00', '2026-06-15'))
    const first = lastFor(U1)
    await sync(db, T('10:00', '2026-06-15'))
    expect(lastFor(U1)).toMatchObject({ regular_hours: first.regular_hours, overtime_hours: first.overtime_hours })
    expect(first.regular_hours + first.overtime_hours).toBe(2)
  })

  it('an entry spanning the cutoff: the part inside the approved week is carried, the rest is this week’s (5 h total)', async () => {
    const db = seed()
    const cutoff = weekCutoffContaining(T('07:00', '2026-06-09'), pw)
    approve(db, 'p1', cutoff)
    db.tables.time_entries.push({ ...base, id: 'span', kind: 'shift', started_at: new Date(cutoff.getTime() - 2 * H).toISOString(), ended_at: new Date(cutoff.getTime() + 3 * H).toISOString(), ended_recorded_at: new Date(cutoff.getTime() + 3 * H).toISOString() })
    await sync(db, new Date(cutoff.getTime() + 3 * H))
    const r = lastFor(U1)
    expect(r.regular_hours + r.overtime_hours).toBe(5)
    expect(r.reason).toMatch(/2 h from the approved week/)
  })

  it('a break recorded after approval never claws pay back: carries 0, never negative', async () => {
    const db = seed()
    const cutoff = weekCutoffContaining(T('07:00', '2026-06-09'), pw)
    approve(db, 'p1', cutoff)
    db.tables.time_entries.push(
      { ...base, id: 'day', kind: 'shift', started_at: T('07:00', '2026-06-09').toISOString(), ended_at: T('17:00', '2026-06-09').toISOString(), ended_recorded_at: T('17:00', '2026-06-09').toISOString() },
      { ...base, id: 'brk', kind: 'break', started_at: T('12:00', '2026-06-09').toISOString(), ended_at: T('12:30', '2026-06-09').toISOString(), ended_recorded_at: T('09:00', '2026-06-15').toISOString() }
    )
    await sync(db, T('09:00', '2026-06-15'))
    const r = lastFor(U1)
    expect(r.regular_hours + r.overtime_hours).toBe(0)
    expect(r.reason).toBe('Time clock')
  })

  it('two approved weeks in a row: the late time is carried into the first OPEN week after both', async () => {
    const db = seed()
    const c1 = weekCutoffContaining(T('07:00', '2026-06-02'), pw)
    const c2 = nextWeekCutoff(c1, pw)
    approve(db, 'p1', c1)
    approve(db, 'p2', c2)
    db.tables.time_entries.push({ ...base, id: 'day', kind: 'shift', started_at: T('07:00', '2026-06-02').toISOString(), ended_at: T('17:00', '2026-06-02').toISOString(), ended_recorded_at: T('09:00', '2026-06-20').toISOString() })
    await sync(db, T('17:00', '2026-06-02'))
    const r = lastFor(U1)
    expect(r.regular_hours + r.overtime_hours).toBe(10)
    const saved = saveHoursEntries.mock.calls.map((c) => c[1] as Saved & { cutoffAt: string })
    expect(new Date(saved.at(-1)!.cutoffAt).getTime()).toBe(nextWeekCutoff(c2, pw).getTime())
  })
})
