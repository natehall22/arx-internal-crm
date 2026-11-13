/**
 * Crew incentives end to end on the in-memory database: lines go into the EXISTING bonus approval as pending lines,
 * once only; a locked / approved / being-approved week rolls to the next open week; marks; deductions; the scoreboard shows
 * only a person's own crews; and a roofing company (ARX) is never touched.
 */
import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { crewIncentivesAllowed } from '@/lib/crew-incentives-access'
import { loadCrewIncentivesState, loadScoreboard, runCrewIncentives, setVisitMark, toSourceUuid } from '@/lib/crew-incentives-db'
import { readPayWeekSchedule, weekCutoffContaining, nextWeekCutoff } from '@/lib/payroll-week-schedule'
import { DEFAULT_TIMEZONE } from '@/lib/timezone'

const ORG = 'org-lawn'
const ARX = 'org-roof'
const SUB = 'sub-1'
const A = 'aaaaaaaa-0000-4000-8000-000000000001'
const B = 'aaaaaaaa-0000-4000-8000-000000000002'
const OTHER_CREW_PERSON = 'aaaaaaaa-0000-4000-8000-000000000009'
const STAFF = 'aaaaaaaa-0000-4000-8000-0000000000f1' // office staff: not on any crew
const STAMP = '2026-01-01T00:00:00.000Z' // every rule was turned on long before the visits
const NOW = new Date('2026-11-13T15:00:00Z')
const sched = readPayWeekSchedule({}, DEFAULT_TIMEZONE)
const COMPLETED = '2026-11-09T15:00:00Z'
const wk1 = weekCutoffContaining(new Date(COMPLETED), sched)
const wk2 = nextWeekCutoff(wk1, sched)

const RULES = {
  enabled: true,
  enabledAt: STAMP,
  doneRight: { on: true, onSince: STAMP, amount: 10, split: 'even', holdDays: 3, minPhotos: 1 },
  review: { on: true, onSince: STAMP, amount: 20, split: 'full' },
  deduction: { on: true, onSince: STAMP, amount: 8, split: 'even' },
  weeklyTarget: { on: true, onSince: STAMP, basis: 'visits', target: 2, amount: 40, split: 'even' },
  beatTime: { on: true, onSince: STAMP, mode: 'flat', amount: 6, percent: 0, ratePerHour: 0, split: 'even' },
}
const only = (k: keyof Omit<typeof RULES, 'enabled' | 'enabledAt'>, over: Record<string, unknown> = {}) => ({
  enabled: true, enabledAt: STAMP,
  doneRight: { ...RULES.doneRight, on: false }, review: { ...RULES.review, on: false }, deduction: { ...RULES.deduction, on: false }, weeklyTarget: { ...RULES.weeklyTarget, on: false }, beatTime: { ...RULES.beatTime, on: false },
  [k]: { ...RULES[k], ...over },
})
const org = (id: string, profile: string, crewIncentives: unknown = RULES) => ({ id, timezone: DEFAULT_TIMEZONE, settings: { profile: { id: profile, version: 1 }, ...(crewIncentives ? { crewIncentives } : {}) } })
const period = (id: string, cutoff: Date, over: Record<string, unknown> = {}) => ({
  id, org_id: ORG, period_label: `Week ${id}`, cutoff_at: cutoff.toISOString(), lock_at: cutoff.toISOString(), scheduled_pay_date: '2026-11-20', status: 'open', locked_at: null, lock_claimed_at: null, created_at: '2026-11-01T00:00:00Z', ...over,
})
const visit = (id: string, over: Record<string, unknown> = {}) => ({
  id, org_id: ORG, work_order_number: `WO-0000${id.slice(-1)}`, work_order_type: 'service_visit', status: 'completed', completed_at: COMPLETED, assigned_sub_id: SUB, job_id: null, estimated_hours: null, visit_step: 'service', ...over,
})
const photo = (wo: string) => ({ id: `p-${wo}`, org_id: ORG, work_order_id: wo, photo_tag: null, deleted_at: null })
const work = (id: string, user: string, wo: string, from: string, to: string) => ({ id, org_id: ORG, user_id: user, kind: 'work', work_order_id: wo, started_at: from, ended_at: to, source: 'lead_tap', end_source: 'lead_tap', removed_at: null })

function seed(over: Record<string, Array<Record<string, unknown>>> = {}, orgRow = org(ORG, 'lawn_landscape')) {
  let n = 0
  return createFakeDb(
    {
      orgs: [orgRow, org(ARX, 'roofing', { ...RULES })],
      payroll_periods: [period('P1', wk1, { status: 'locked', locked_at: '2026-11-12T10:00:00Z' }), period('P2', wk2)],
      payroll_bonus_lines: [],
      work_orders: [visit('v1'), visit('v2')],
      photos: [photo('v1'), photo('v2')],
      crew_members: [{ org_id: ORG, sub_id: SUB, user_id: A }, { org_id: ORG, sub_id: SUB, user_id: B }, { org_id: ORG, sub_id: 'sub-2', user_id: OTHER_CREW_PERSON }],
      sub_contractors: [{ id: SUB, org_id: ORG, company_name: 'Crew One' }, { id: 'sub-2', org_id: ORG, company_name: 'Crew Two' }],
      users: [{ id: STAFF, org_id: ORG, full_name: 'Dana Office' }, { id: A, org_id: ORG, full_name: 'Ana' }, { id: B, org_id: ORG, full_name: 'Ben' }, { id: OTHER_CREW_PERSON, org_id: ORG, full_name: 'Zed' }],
      time_entries: [],
      crew_visit_marks: [],
      production_jobs: [],
      service_visit_charges: [],
      ...over,
    },
    {
      unique: {
        // As in prod: our once-ever key (named, from the migration) and the old per-week-per-person-per-type-per-source key.
        payroll_bonus_lines: [{ name: 'payroll_bonus_lines_source_key_uniq', cols: ['org_id', 'source_key'] }, { name: 'payroll_bonus_lines_period_id_user_id_bonus_type_source_id_key', cols: ['payroll_period_id', 'user_id', 'bonus_type', 'source_id'] }],
        crew_visit_marks: [['org_id', 'work_order_id', 'kind']],
      },
      idFactory: () => `gen-${++n}` }
  )
}
const lines = (db: ReturnType<typeof seed>) => db.tables.payroll_bonus_lines

describe('runCrewIncentives', () => {
  it('proposes pending lines for a completed visit, with reasons that carry no customer detail', async () => {
    const db = seed()
    const r = await runCrewIncentives(db.client, ORG, { now: NOW })
    expect(r.proposed).toBeGreaterThan(0)
    const done = lines(db).filter((l) => l.bonus_type === 'crew_done_right' && String(l.source_key).includes(':v1:'))
    expect(done).toHaveLength(2)
    expect(done.every((l) => l.status === 'pending_approval' && l.amount === 5 && l.created_by === null)).toBe(true)
    expect(done[0].description).toBe('Visit done right — WO-00001, 11/9')
    for (const l of lines(db)) expect(String(l.description)).not.toMatch(/Smith|Oak|St\b/)
  })

  it('is idempotent: a second and third run add nothing', async () => {
    const db = seed()
    await runCrewIncentives(db.client, ORG, { now: NOW })
    const count = lines(db).length
    expect(count).toBeGreaterThan(0)
    const again = await runCrewIncentives(db.client, ORG, { now: NOW })
    await runCrewIncentives(db.client, ORG, { now: new Date(NOW.getTime() + 3600_000) })
    expect(again.proposed).toBe(0)
    expect(lines(db)).toHaveLength(count)
    expect(new Set(lines(db).map((l) => l.source_key)).size).toBe(count)
  })

  it('a rejected line is never proposed again', async () => {
    const db = seed()
    await runCrewIncentives(db.client, ORG, { now: NOW })
    for (const l of lines(db)) l.status = 'rejected'
    const n = lines(db).length
    await runCrewIncentives(db.client, ORG, { now: NOW })
    expect(lines(db)).toHaveLength(n)
  })

  it('never adds to a locked week: rolls to the next open week', async () => {
    const db = seed()
    await runCrewIncentives(db.client, ORG, { now: NOW })
    expect(new Set(lines(db).map((l) => l.payroll_period_id))).toEqual(new Set(['P2']))
  })

  it('an open week for the earning date gets the line; a week being approved (live claim) rolls on', async () => {
    const open = seed({ payroll_periods: [period('P1', wk1), period('P2', wk2)] })
    await runCrewIncentives(open.client, ORG, { now: NOW })
    expect(new Set(lines(open).map((l) => l.payroll_period_id))).toEqual(new Set(['P1']))
    const claimed = seed({ payroll_periods: [period('P1', wk1, { lock_claimed_at: new Date(Date.now() - 60_000).toISOString() /* periodIsEditable reads the real clock */ }), period('P2', wk2)] })
    await runCrewIncentives(claimed.client, ORG, { now: NOW })
    expect(new Set(lines(claimed).map((l) => l.payroll_period_id))).toEqual(new Set(['P2']))
  })

  it('an approved (non-open) week with no open one after it makes the next week, never reuses the closed one', async () => {
    const db = seed({ payroll_periods: [period('P1', wk1, { status: 'locked' })] })
    await runCrewIncentives(db.client, ORG, { now: NOW })
    const used = new Set(lines(db).map((l) => l.payroll_period_id))
    expect(used.has('P1')).toBe(false)
    expect(used.size).toBe(1)
    const made = db.tables.payroll_periods.find((p) => p.id === Array.from(used)[0])!
    expect(new Date(made.cutoff_at as string).getTime()).toBe(wk2.getTime())
  })

  it('weekly target: the crew splits the amount once, from the people who worked the visits', async () => {
    const db = seed({ time_entries: [work('t1', A, 'v1', '2026-11-09T13:00:00Z', '2026-11-09T14:00:00Z'), work('t2', B, 'v2', '2026-11-09T14:00:00Z', '2026-11-09T15:00:00Z')] })
    await runCrewIncentives(db.client, ORG, { now: NOW })
    const wt = lines(db).filter((l) => l.bonus_type === 'crew_weekly_target')
    expect(wt.map((l) => l.amount).sort()).toEqual([20, 20])
    await runCrewIncentives(db.client, ORG, { now: NOW })
    expect(lines(db).filter((l) => l.bonus_type === 'crew_weekly_target')).toHaveLength(2)
  })

  it('beat the time: time on site under the work order hours', async () => {
    const db = seed({
      work_orders: [visit('v1', { estimated_hours: 4 })],
      time_entries: [work('t1', A, 'v1', '2026-11-09T13:00:00Z', '2026-11-09T14:00:00Z'), work('t2', B, 'v1', '2026-11-09T13:00:00Z', '2026-11-09T14:00:00Z')],
    })
    await runCrewIncentives(db.client, ORG, { now: NOW })
    const bt = lines(db).filter((l) => l.bonus_type === 'crew_beat_time')
    expect(bt.map((l) => l.amount)).toEqual([3, 3])
    expect(String(bt[0].description)).toContain('on site 1 h, budget 4 h')
  })

  it('the production job hours are the budget only when it is the job\'s single work order', async () => {
    const jobWo = (id: string) => visit(id, { job_id: 'job1', work_order_type: 'install', estimated_hours: null })
    const entries = [work('t1', A, 'v1', '2026-11-09T13:00:00Z', '2026-11-09T14:00:00Z')]
    const one = seed({ work_orders: [jobWo('v1')], production_jobs: [{ id: 'job1', org_id: ORG, estimated_hours: 5 }], time_entries: entries })
    await runCrewIncentives(one.client, ORG, { now: NOW })
    expect(lines(one).some((l) => l.bonus_type === 'crew_beat_time')).toBe(true)
    const two = seed({ work_orders: [jobWo('v1'), jobWo('v3')], production_jobs: [{ id: 'job1', org_id: ORG, estimated_hours: 5 }], time_entries: entries })
    await runCrewIncentives(two.client, ORG, { now: NOW })
    expect(lines(two).some((l) => l.bonus_type === 'crew_beat_time')).toBe(false)
  })

  it('a deduction is a negative pending line through the same table, once', async () => {
    const db = seed()
    expect(await setVisitMark(db.client, ORG, STAFF, 'v1', 'callback', true, NOW)).toEqual({ ok: true })
    await runCrewIncentives(db.client, ORG, { now: NOW })
    await runCrewIncentives(db.client, ORG, { now: NOW })
    const dd = lines(db).filter((l) => l.bonus_type === 'crew_deduction')
    expect(dd.map((l) => l.amount)).toEqual([-4, -4])
    expect(dd.every((l) => l.status === 'pending_approval')).toBe(true)
    // the marked visit earns no done-right bonus
    expect(lines(db).some((l) => l.bonus_type === 'crew_done_right' && String(l.source_key).includes(':v1:'))).toBe(false)
  })

  it('review mark: full amount to each member; an un-mark is refused once the line exists', async () => {
    const db = seed()
    await setVisitMark(db.client, ORG, STAFF, 'v2', 'review', true, NOW)
    await runCrewIncentives(db.client, ORG, { now: NOW })
    expect(lines(db).filter((l) => l.bonus_type === 'crew_review').map((l) => l.amount)).toEqual([20, 20])
    const res = await setVisitMark(db.client, ORG, STAFF, 'v2', 'review', false)
    expect(res).toMatchObject({ ok: false, status: 409 })
  })

  it('an un-mark before any line exists just removes it; an unfinished visit cannot be marked', async () => {
    const db = seed({ work_orders: [visit('v1'), visit('v9', { status: 'scheduled', completed_at: null })] })
    await setVisitMark(db.client, ORG, STAFF, 'v1', 'review', true)
    expect(await setVisitMark(db.client, ORG, STAFF, 'v1', 'review', false)).toEqual({ ok: true })
    expect(db.tables.crew_visit_marks).toHaveLength(0)
    expect(await setVisitMark(db.client, ORG, STAFF, 'v9', 'review', true)).toMatchObject({ ok: false, status: 400 })
  })

  it('a visit outside the company is not found', async () => {
    const db = seed({ work_orders: [visit('v1', { org_id: 'someone-else' })] })
    expect(await setVisitMark(db.client, ORG, STAFF, 'v1', 'review', true)).toMatchObject({ ok: false, status: 404 })
  })
})


describe('owner decisions', () => {
  const lineFor = (db: ReturnType<typeof seed>, type: string, user: string, wo?: string) => lines(db).filter((l) => l.bonus_type === type && l.user_id === user && (!wo || String(l.source_key).includes(`:${wo}:`)))

  describe('1. no back pay', () => {
    it('work finished before a rule was turned on is never paid, even when it is marked later', async () => {
      const after = '2026-11-10T00:00:00.000Z' // visits finished 11/09
      const db = seed({}, org(ORG, 'lawn_landscape', { ...RULES, enabledAt: after, doneRight: { ...RULES.doneRight, onSince: after }, review: { ...RULES.review, onSince: after }, deduction: { ...RULES.deduction, onSince: after }, weeklyTarget: { ...RULES.weeklyTarget, onSince: after }, beatTime: { ...RULES.beatTime, onSince: after } }))
      await setVisitMark(db.client, ORG, STAFF, 'v1', 'review', true, NOW)
      await setVisitMark(db.client, ORG, STAFF, 'v2', 'callback', true, NOW)
      await runCrewIncentives(db.client, ORG, { now: NOW })
      expect(lines(db)).toHaveLength(0)
    })
    it('the same visits pay once the rules were on before they finished', async () => {
      const db = seed()
      await runCrewIncentives(db.client, ORG, { now: NOW })
      expect(lines(db).length).toBeGreaterThan(0)
    })
    it('the weekly target counts only visits finished after it was turned on', async () => {
      // 2 visits needed; only v2 finished after the stamp -> not reached
      const stamp = '2026-11-09T16:00:00.000Z'
      const db = seed({ work_orders: [visit('v1'), visit('v2', { completed_at: '2026-11-09T18:00:00Z' })], time_entries: [work('t1', A, 'v1', '2026-11-09T13:00:00Z', '2026-11-09T14:00:00Z')] }, org(ORG, 'lawn_landscape', only('weeklyTarget', { onSince: stamp })))
      await runCrewIncentives(db.client, ORG, { now: NOW })
      expect(lines(db)).toHaveLength(0)
    })
  })

  describe('2. beat the time is wall-clock time on site', () => {
    it('two people on site together for 2 h = 2 h on site (not 4 man-hours): beats a 3 h budget', async () => {
      const db = seed({ work_orders: [visit('v1', { estimated_hours: 3 })], time_entries: [work('t1', A, 'v1', '2026-11-09T13:00:00Z', '2026-11-09T15:00:00Z'), work('t2', B, 'v1', '2026-11-09T13:00:00Z', '2026-11-09T15:00:00Z')] }, org(ORG, 'lawn_landscape', only('beatTime')))
      await runCrewIncentives(db.client, ORG, { now: NOW })
      const bt = lines(db)
      expect(bt.map((l) => l.amount)).toEqual([3, 3])
      expect(String(bt[0].description)).toContain('on site 2 h, budget 3 h')
    })
    it('first clock-in to last clock-out spans a gap between people; over budget pays nothing', async () => {
      const db = seed({ work_orders: [visit('v1', { estimated_hours: 3 })], time_entries: [work('t1', A, 'v1', '2026-11-09T13:00:00Z', '2026-11-09T14:00:00Z'), work('t2', B, 'v1', '2026-11-09T15:30:00Z', '2026-11-09T16:30:00Z')] }, org(ORG, 'lawn_landscape', only('beatTime')))
      await runCrewIncentives(db.client, ORG, { now: NOW })
      expect(lines(db)).toHaveLength(0) // 13:00 -> 16:30 = 3.5 h on site
    })
  })

  describe('3. deductions only take back bonus money', () => {
    it('limited to the crew bonuses the person earned that week; the rest is dropped and the line says why', async () => {
      // doneRight 4 split = 2 each on v2; deduction 20 split = 10 each on v1 -> capped at 2 each
      const rules = { ...only('doneRight', { amount: 4 }), deduction: { ...RULES.deduction, amount: 20 } }
      const db = seed({}, org(ORG, 'lawn_landscape', rules))
      await setVisitMark(db.client, ORG, STAFF, 'v1', 'callback', true, NOW)
      await runCrewIncentives(db.client, ORG, { now: NOW })
      const dd = lineFor(db, 'crew_deduction', A)
      expect(dd).toHaveLength(1)
      expect(dd[0]).toMatchObject({ amount: -2, status: 'pending_approval' })
      expect(String(dd[0].description)).toContain('Deduction limited to bonuses earned this week')
      // the person's crew total for the week is never below $0
      const total = (u: string) => lines(db).filter((l) => l.user_id === u && l.status !== 'rejected').reduce((n, l) => n + Number(l.amount), 0)
      expect(total(A)).toBeGreaterThanOrEqual(0)
      expect(total(B)).toBeGreaterThanOrEqual(0)
    })
    it('nothing earned = a $0 closed line (kept on record, never proposed again), not a negative', async () => {
      const db = seed({}, org(ORG, 'lawn_landscape', only('deduction', { amount: 8 })))
      await setVisitMark(db.client, ORG, STAFF, 'v1', 'callback', true, NOW)
      await runCrewIncentives(db.client, ORG, { now: NOW })
      await runCrewIncentives(db.client, ORG, { now: NOW })
      const dd = lines(db).filter((l) => l.bonus_type === 'crew_deduction')
      expect(dd).toHaveLength(2)
      expect(dd.every((l) => l.amount === 0 && l.status === 'rejected' && l.review_note === 'Deduction limited to bonuses earned this week')).toBe(true)
    })
    it('counts bonuses already there (approved, pending) but not rejected ones, other kinds of bonus or other weeks', async () => {
      const bonus = (user: string, amount: number, status: string, over: Record<string, unknown> = {}) => ({ id: `x-${user}-${amount}-${status}`, org_id: ORG, user_id: user, bonus_type: 'crew_done_right', amount, status, payroll_period_id: 'P2', source_id: null, source_key: `old:${user}:${amount}:${status}`, ...over })
      const db = seed(
        { payroll_bonus_lines: [bonus(A, 3, 'approved'), bonus(A, 50, 'rejected'), bonus(A, 100, 'approved', { bonus_type: 'manual', source_key: 'm1' }), bonus(A, 40, 'approved', { payroll_period_id: 'P-old', source_key: 'o1' })] },
        org(ORG, 'lawn_landscape', only('deduction', { amount: 8 }))
      )
      await setVisitMark(db.client, ORG, STAFF, 'v1', 'callback', true, NOW)
      await runCrewIncentives(db.client, ORG, { now: NOW })
      expect(lineFor(db, 'crew_deduction', A)[0].amount).toBe(-3) // 4 wanted, 3 earned that week
    })
    it('two callbacks the same week share what the person earned (never more than it in total)', async () => {
      const rules = { ...only('doneRight', { amount: 6 }), deduction: { ...RULES.deduction, amount: 8, split: 'full' } }
      const db = seed({ work_orders: [visit('v1'), visit('v2'), visit('v3')], photos: [photo('v1'), photo('v2'), photo('v3')] }, org(ORG, 'lawn_landscape', rules))
      await setVisitMark(db.client, ORG, STAFF, 'v1', 'callback', true, NOW)
      await setVisitMark(db.client, ORG, STAFF, 'v2', 'callback', true, NOW)
      await runCrewIncentives(db.client, ORG, { now: NOW })
      // A earned 3 on v3 only (v1, v2 had callbacks) = 3; two deductions of 8 each: -3 then 0
      const dd = lineFor(db, 'crew_deduction', A).filter((l) => l.status !== 'rejected')
      expect(dd.reduce((n, l) => n + Number(l.amount), 0)).toBe(-3)
    })
  })

  describe('M1 unique keys', () => {
    it('weekly-target lines from two weeks rolled onto ONE open pay week both go in (a source id per week)', async () => {
      const wk2b = nextWeekCutoff(wk1, sched)
      const later = new Date('2026-11-20T15:00:00Z')
      const db = seed({
        payroll_periods: [period('P1', wk1, { status: 'locked', locked_at: '2026-11-12T10:00:00Z' }), period('P2', wk2b)],
        work_orders: [visit('v1'), visit('v2'), visit('v3', { completed_at: '2026-11-16T15:00:00Z' }), visit('v4', { completed_at: '2026-11-16T16:00:00Z' })],
        time_entries: [work('t1', A, 'v1', '2026-11-09T13:00:00Z', '2026-11-09T14:00:00Z'), work('t3', A, 'v3', '2026-11-16T13:00:00Z', '2026-11-16T14:00:00Z')],
      }, org(ORG, 'lawn_landscape', only('weeklyTarget')))
      const r = await runCrewIncentives(db.client, ORG, { now: later })
      const wt = lines(db).filter((l) => l.bonus_type === 'crew_weekly_target' && l.user_id === A)
      expect(wt).toHaveLength(2)
      expect(new Set(wt.map((l) => l.payroll_period_id))).toEqual(new Set(['P2']))
      expect(new Set(wt.map((l) => l.source_id)).size).toBe(2)
      expect(r.deferred).toBe(0)
    })
    it('a unique violation that is NOT our source key is not "already proposed": it is retried, not recorded', async () => {
      // A line with the same (week, person, type, source id) but a different key exists: inserting ours violates THAT constraint.
      const db = seed(
        { payroll_bonus_lines: [{ id: 'old1', org_id: ORG, user_id: A, bonus_type: 'crew_done_right', amount: 1, status: 'approved', payroll_period_id: 'P2', source_id: toSourceUuid('v2'), source_key: 'something:else' }] },
        org(ORG, 'lawn_landscape', only('doneRight'))
      )
      const r = await runCrewIncentives(db.client, ORG, { now: NOW })
      expect(r.deferred).toBeGreaterThanOrEqual(1)
      expect(lines(db).some((l) => String(l.source_key) === `crew:doneRight:v2:${A}`)).toBe(false)
      expect(lines(db).some((l) => String(l.source_key) === `crew:doneRight:v2:${B}`)).toBe(true) // the others still went in
    })
    it('a source id that is not a uuid becomes a stable one; a uuid is kept', () => {
      expect(toSourceUuid('sub1|2026-11-18')).toBe(toSourceUuid('sub1|2026-11-18'))
      expect(toSourceUuid('sub1|2026-11-18')).not.toBe(toSourceUuid('sub1|2026-11-25'))
      expect(toSourceUuid('sub1|2026-11-18')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
      expect(toSourceUuid(A)).toBe(A)
    })
  })

  describe('M2 open clocks', () => {
    it('a visit with anyone still clocked in is skipped, for every rule and for the weekly count; it pays once the clock is closed', async () => {
      const open = { ...work('t9', B, 'v1', '2026-11-09T14:00:00Z', null as unknown as string), ended_at: null }
      const db = seed({ work_orders: [visit('v1', { estimated_hours: 4 }), visit('v2')], time_entries: [work('t1', A, 'v1', '2026-11-09T13:00:00Z', '2026-11-09T14:00:00Z'), open] })
      await runCrewIncentives(db.client, ORG, { now: NOW })
      expect(lines(db).filter((l) => String(l.source_key).includes(':v1:'))).toHaveLength(0)
      expect(lines(db).some((l) => l.bonus_type === 'crew_weekly_target')).toBe(false) // only v2 counts: 1 of 2
      db.tables.time_entries.find((t) => t.id === 't9')!.ended_at = '2026-11-09T15:00:00Z'
      await runCrewIncentives(db.client, ORG, { now: NOW })
      expect(lines(db).some((l) => String(l.source_key).includes(':v1:'))).toBe(true)
    })
  })

  describe('M3 nobody marks their own crew\'s work', () => {
    it('a crew member (roster) or someone who clocked the visit is refused; office staff can mark; the line says who', async () => {
      const db = seed({ time_entries: [work('t1', STAFF, 'v2', '2026-11-09T13:00:00Z', '2026-11-09T14:00:00Z')] })
      expect(await setVisitMark(db.client, ORG, A, 'v1', 'review', true, NOW)).toMatchObject({ ok: false, status: 403 })
      expect(await setVisitMark(db.client, ORG, STAFF, 'v2', 'review', true, NOW)).toMatchObject({ ok: false, status: 403 }) // clocked v2
      expect(db.tables.crew_visit_marks).toHaveLength(0)
      expect(await setVisitMark(db.client, ORG, STAFF, 'v1', 'review', true, NOW)).toEqual({ ok: true })
      await runCrewIncentives(db.client, ORG, { now: NOW })
      const rv = lines(db).filter((l) => l.bonus_type === 'crew_review')
      expect(rv.length).toBeGreaterThan(0)
      expect(String(rv[0].description)).toContain('(marked by Dana Office)')
    })
  })

  describe('low items', () => {
    it('a deactivated person gets no line; someone who joined the crew after the visit was not on it', async () => {
      const db = seed({
        users: [{ id: A, org_id: ORG, full_name: 'Ana', active: false }, { id: B, org_id: ORG, full_name: 'Ben', active: true }, { id: STAFF, org_id: ORG, full_name: 'Dana Office' }],
      }, org(ORG, 'lawn_landscape', only('doneRight')))
      await runCrewIncentives(db.client, ORG, { now: NOW })
      expect(lines(db).some((l) => l.user_id === A)).toBe(false)
      expect(lines(db).filter((l) => l.user_id === B).length).toBeGreaterThan(0)
      const later = seed({ crew_members: [{ org_id: ORG, sub_id: SUB, user_id: A, created_at: '2026-01-01T00:00:00Z' }, { org_id: ORG, sub_id: SUB, user_id: B, created_at: '2026-11-10T00:00:00Z' }] }, org(ORG, 'lawn_landscape', only('doneRight')))
      await runCrewIncentives(later.client, ORG, { now: NOW })
      expect(lines(later).some((l) => l.user_id === B)).toBe(false) // joined 11/10, visit 11/09
      expect(lines(later).some((l) => l.user_id === A)).toBe(true)
    })
    it('an un-mark is refused once ANY line exists from it (even a rejected one), in plain words', async () => {
      const db = seed()
      await setVisitMark(db.client, ORG, STAFF, 'v2', 'review', true, NOW)
      // a line exists but the run has not stamped the mark yet
      db.tables.payroll_bonus_lines.push({ id: 'r1', org_id: ORG, user_id: A, bonus_type: 'crew_review', amount: 0, status: 'rejected', payroll_period_id: 'P2', source_id: 'v2', source_key: `crew:review:v2:${A}` })
      const res = await setVisitMark(db.client, ORG, STAFF, 'v2', 'review', false)
      expect(res).toMatchObject({ ok: false, status: 409 })
      expect((res as { error: string }).error).toContain('cannot be removed here')
    })
  })
})

describe('ARX (roofing) is unaffected', () => {
  it('a roofing company is never available or active, even with the rules saved as on', async () => {
    const db = seed()
    expect(await loadCrewIncentivesState(db.client, ARX)).toMatchObject({ available: false, active: false })
  })
  it('the run returns before reading a visit and writes nothing', async () => {
    const reads: string[] = []
    const db = createFakeDb(
      { orgs: [org(ARX, 'roofing')], work_orders: [{ ...visit('v1'), org_id: ARX }], payroll_periods: [], payroll_bonus_lines: [], crew_members: [], photos: [] },
      { onSelect: (t) => reads.push(t) }
    )
    const r = await runCrewIncentives(db.client, ARX, { now: NOW })
    expect(r.skipped).toBe('off')
    expect(db.writes).toHaveLength(0)
    expect(reads).not.toContain('work_orders')
    expect(await loadScoreboard(db.client, ARX, { userId: A }, NOW)).toBeNull()
  })
  it('a lawn company with the switch off proposes nothing', async () => {
    const db = seed({}, org(ORG, 'lawn_landscape', { ...RULES, enabled: false }))
    expect((await runCrewIncentives(db.client, ORG, { now: NOW })).skipped).toBe('off')
    expect(lines(db)).toHaveLength(0)
  })
  it('a company with no profile stored is roofing', async () => {
    const db = createFakeDb({ orgs: [{ id: ARX, timezone: DEFAULT_TIMEZONE, settings: { crewIncentives: RULES } }] })
    expect((await loadCrewIncentivesState(db.client, ARX)).available).toBe(false)
  })
})

describe('access', () => {
  const on = { available: true, active: true }
  it('roofing: nobody, not even an owner', () => {
    expect(crewIncentivesAllowed({ available: false, active: false }, 'owner', { owner: true, canEditJobs: true })).toBe(false)
    expect(crewIncentivesAllowed({ available: false, active: true }, 'member', { owner: true, canEditJobs: true })).toBe(false)
  })
  it('owners reach the rules even while the switch is off; marking and the scoreboard need it on', () => {
    const off = { available: true, active: false }
    expect(crewIncentivesAllowed(off, 'owner', { owner: true, canEditJobs: false })).toBe(true)
    expect(crewIncentivesAllowed(off, 'mark', { owner: true, canEditJobs: true })).toBe(false)
    expect(crewIncentivesAllowed(off, 'member', { owner: false, canEditJobs: false })).toBe(false)
  })
  it('only owners change rules; only jobs:edit marks; anyone signed in reads their scoreboard', () => {
    expect(crewIncentivesAllowed(on, 'owner', { owner: false, canEditJobs: true })).toBe(false)
    expect(crewIncentivesAllowed(on, 'mark', { owner: false, canEditJobs: false })).toBe(false)
    expect(crewIncentivesAllowed(on, 'mark', { owner: false, canEditJobs: true })).toBe(true)
    expect(crewIncentivesAllowed(on, 'member', { owner: false, canEditJobs: false })).toBe(true)
  })
})

describe('scoreboard visibility', () => {
  const lineRow = (user: string, amount: number, status: string, period = 'P2') => ({ id: `l-${user}-${amount}-${status}`, org_id: ORG, user_id: user, bonus_type: 'crew_done_right', amount, status, payroll_period_id: period, created_at: '2026-11-12T00:00:00Z' })
  const withLines = () =>
    seed({
      payroll_periods: [period('P2', weekCutoffContaining(NOW, sched))],
      payroll_bonus_lines: [lineRow(A, 5, 'approved'), lineRow(A, 7, 'pending_approval'), lineRow(B, 3, 'paid'), lineRow(OTHER_CREW_PERSON, 99, 'approved'), lineRow(A, 50, 'rejected')],
    })

  it('a crew member sees their own crew (themselves first), never another crew\'s pay', async () => {
    const db = withLines()
    const sb = await loadScoreboard(db.client, ORG, { userId: A }, NOW)
    expect(sb!.crews.map((c) => c.name)).toEqual(['Crew One'])
    const names = sb!.crews[0].people.map((p) => p.name)
    expect(names).toEqual(['Ana', 'Ben'])
    expect(sb!.crews[0].people[0]).toMatchObject({ isMe: true, earned: 5, pending: 7 })
    expect(sb!.crews[0].people[1]).toMatchObject({ earned: 3, pending: 0 })
    expect(JSON.stringify(sb)).not.toContain('Zed')
    expect(JSON.stringify(sb)).not.toContain('99')
  })
  it('the other crew sees only itself', async () => {
    const sb = await loadScoreboard(withLines().client, ORG, { userId: OTHER_CREW_PERSON }, NOW)
    expect(sb!.crews.map((c) => c.name)).toEqual(['Crew Two'])
    expect(JSON.stringify(sb)).not.toContain('Ana')
  })
  it('a crew link (public) shows crew totals and target only: no per-person dollars, no names', async () => {
    const sb = await loadScoreboard(withLines().client, ORG, { subId: SUB }, NOW)
    expect(sb!.crews[0].people).toEqual([])
    expect(sb!.crews[0].totals).toEqual({ earned: 8, pending: 7 })
    const json = JSON.stringify(sb)
    for (const hidden of ['Ana', 'Ben', 'Zed', 'userId']) expect(json).not.toContain(hidden)
  })
  it('pending covers this pay week only; other weeks\' pending lines are not shown here', async () => {
    const db = seed({
      payroll_periods: [period('P2', weekCutoffContaining(NOW, sched)), period('P0', wk1)],
      payroll_bonus_lines: [lineRow(A, 7, 'pending_approval'), lineRow(A, 11, 'pending_approval', 'P0')],
    })
    const sb = await loadScoreboard(db.client, ORG, { userId: A }, NOW)
    expect(sb!.crews[0].people[0]).toMatchObject({ isMe: true, pending: 7 })
  })
  it('the weekly target counts the same visits the rule counts: crew work only, finished after it was turned on', async () => {
    const inWeek = new Date('2026-11-11T20:00:00Z')
    const db = seed({ work_orders: [visit('v1'), visit('v2', { visit_step: 'inspection' }), visit('v3', { completed_at: '2026-11-02T15:00:00Z' })] }, org(ORG, 'lawn_landscape', { ...RULES, weeklyTarget: { ...RULES.weeklyTarget, onSince: '2026-11-05T00:00:00.000Z', target: 4 } }))
    const sb = await loadScoreboard(db.client, ORG, { userId: A }, inWeek)
    expect(sb!.crews[0].target).toMatchObject({ basis: 'visits', done: 1, goal: 4 })
  })
  it('a person on no crew sees nothing; a crew link shows only that crew', async () => {
    expect((await loadScoreboard(withLines().client, ORG, { userId: 'nobody' }, NOW))!.crews).toEqual([])
    expect((await loadScoreboard(withLines().client, ORG, { subId: SUB }, NOW))!.crews.map((c) => c.subId)).toEqual([SUB])
  })
  it('a dollar target shows a percent, never job money', async () => {
    const db = seed({ work_orders: [visit('v1')], service_visit_charges: [{ work_order_id: 'v1', org_id: ORG, price: 130 }] }, org(ORG, 'lawn_landscape', { ...RULES, weeklyTarget: { ...RULES.weeklyTarget, basis: 'dollars', target: 500, amount: 40 } }))
    const nowInWeek = new Date(COMPLETED)
    nowInWeek.setUTCHours(20)
    const sb = await loadScoreboard(db.client, ORG, { userId: A }, nowInWeek)
    expect(sb!.crews[0].target).toMatchObject({ basis: 'dollars', percent: 26, goal: null, done: null })
    expect(JSON.stringify(sb)).not.toContain('130')
  })
})

describe('ARX sees no setting, and the key has one writer', () => {
  const { visibleSettingsGroups } = jest.requireActual('@/lib/settings-registry') as typeof import('@/lib/settings-registry')
  const { mergeOrgSettings } = jest.requireActual('@/lib/org-settings') as typeof import('@/lib/org-settings')
  const hrefs = (profileId?: 'roofing' | 'lawn_landscape') =>
    visibleSettingsGroups({ canCost: true, canPayroll: true, canSuperuser: true, canWorkAreas: true, canOwner: true, canSuperAdmin: true, profileId }).flatMap((g) => g.items.map((i) => i.href))
  it('the Settings entry exists only for lawn_landscape', () => {
    expect(hrefs('roofing')).not.toContain('/admin#crew-incentives')
    expect(hrefs(undefined)).not.toContain('/admin#crew-incentives')
    expect(hrefs('lawn_landscape')).toContain('/admin#crew-incentives')
  })
  it('a top-level settings write of crewIncentives is refused (only path [crewIncentives] writes it)', async () => {
    const db = createFakeDb({ orgs: [org(ORG, 'lawn_landscape')] })
    expect(await mergeOrgSettings(db.client, ORG, { crewIncentives: {} })).toEqual({ error: expect.stringContaining('crewIncentives') })
  })
  it('no Sisu file is imported by the crew incentive modules', () => {
    const fs = jest.requireActual('fs') as typeof import('fs')
    for (const f of ['lib/crew-incentives.ts', 'lib/crew-incentives-db.ts', 'lib/crew-incentives-access.ts']) expect(fs.readFileSync(f, 'utf8')).not.toMatch(/sisu|setter-ramp/i)
  })
})
