/** Crew incentive rules (pure): each rule, the split modes, the deduction, settings parsing. */
import {
  DEFAULT_CREW_INCENTIVE_SETTINGS,
  parseCrewIncentivesPatch,
  planVisitLines,
  planWeeklyLines,
  readCrewIncentiveSettings,
  splitCents,
  targetProgress,
  workOrderHours,
  type CrewIncentiveSettings,
  type VisitFacts,
} from '@/lib/crew-incentives'
import { DEFAULT_TIMEZONE } from '@/lib/timezone'
import type { TimeEntry } from '@/lib/time-tracking'

const TZ = DEFAULT_TIMEZONE
const A = 'aaaaaaaa-0000-4000-8000-000000000001'
const B = 'aaaaaaaa-0000-4000-8000-000000000002'
const C = 'aaaaaaaa-0000-4000-8000-000000000003'
const NOW = new Date('2026-11-20T15:00:00Z')

const settings = (over: Partial<CrewIncentiveSettings> = {}): CrewIncentiveSettings => ({
  ...readCrewIncentiveSettings({ enabled: true }),
  ...over,
})
const visit = (over: Partial<VisitFacts> = {}): VisitFacts => ({
  id: 'wo1', number: 'WO-00123', completedAt: '2026-11-12T15:00:00Z', isJobWorkOrder: false, members: [A, B], photoCount: 2, photoTags: [],
  callbackAt: null, reviewAt: null, budgetHours: null, actualHours: null, ...over,
})
const sum = (lines: Array<{ cents: number }>) => lines.reduce((n, l) => n + l.cents, 0)

describe('splitCents', () => {
  it('even: parts add up exactly, leftover cents go to the first ids', () => {
    const m = splitCents(1000, [C, A, B], 'even')
    expect(Array.from(m.values()).reduce((a, b) => a + b, 0)).toBe(1000)
    expect(m.get(A)).toBe(334)
    expect(m.get(B)).toBe(333)
    expect(m.get(C)).toBe(333)
  })
  it('even: negative amounts split the same way', () => {
    const m = splitCents(-1000, [A, B, C], 'even')
    expect(Array.from(m.values())).toEqual([-334, -333, -333])
  })
  it('full: everyone gets the whole amount', () => {
    expect(Array.from(splitCents(1500, [A, B], 'full').values())).toEqual([1500, 1500])
  })
  it('nobody = nothing; a repeated id counts once', () => {
    expect(splitCents(500, [], 'even').size).toBe(0)
    expect(splitCents(500, [A, A], 'even').get(A)).toBe(500)
  })
})

describe('rule 1: visit done right', () => {
  const s = settings({ doneRight: { on: true, amount: 10, split: 'even', holdDays: 3, minPhotos: 1 } })
  it('proposes after the waiting days, split evenly, with a reason that has no customer detail', () => {
    const lines = planVisitLines(s, visit(), NOW, TZ)
    expect(lines.map((l) => l.cents)).toEqual([500, 500])
    expect(lines[0].reason).toBe('Visit done right — WO-00123, 11/12')
    expect(lines[0].sourceKey).toBe(`crew:doneRight:wo1:${A}`)
  })
  it('each member gets the full amount in full mode', () => {
    expect(planVisitLines(settings({ doneRight: { ...s.doneRight, split: 'full' } }), visit(), NOW, TZ).map((l) => l.cents)).toEqual([1000, 1000])
  })
  it('waits until the callback window has passed', () => {
    expect(planVisitLines(s, visit({ completedAt: '2026-11-19T15:00:00Z' }), NOW, TZ)).toEqual([])
  })
  it('needs its done photos', () => {
    expect(planVisitLines(s, visit({ photoCount: 0 }), NOW, TZ)).toEqual([])
  })
  it('a job work order needs the four walk-around angles, not a count', () => {
    const job = visit({ isJobWorkOrder: true, photoCount: 9, photoTags: ['final_front', 'final_back', 'final_left'] })
    expect(planVisitLines(s, job, NOW, TZ)).toEqual([])
    expect(planVisitLines(s, { ...job, photoTags: [...job.photoTags, 'final_right'] }, NOW, TZ)).toHaveLength(2)
  })
  it('a staff-marked callback means no bonus', () => {
    expect(planVisitLines(s, visit({ callbackAt: '2026-11-13T12:00:00Z' }), NOW, TZ)).toEqual([])
  })
  it('off, or on with no amount, or the master switch off = nothing', () => {
    expect(planVisitLines(settings({ doneRight: { ...s.doneRight, on: false } }), visit(), NOW, TZ)).toEqual([])
    expect(planVisitLines(settings({ doneRight: { ...s.doneRight, amount: 0 } }), visit(), NOW, TZ)).toEqual([])
    expect(planVisitLines({ ...s, enabled: false }, visit(), NOW, TZ)).toEqual([])
  })
  it('no crew members = nothing', () => {
    expect(planVisitLines(s, visit({ members: [] }), NOW, TZ)).toEqual([])
  })
})

describe('rule 2: beat the time', () => {
  const flat = settings({ beatTime: { on: true, mode: 'flat', amount: 20, percent: 0, ratePerHour: 0, split: 'even' } })
  const pct = settings({ beatTime: { on: true, mode: 'percent', amount: 0, percent: 50, ratePerHour: 40, split: 'full' } })
  it('flat bonus when under budget', () => {
    const lines = planVisitLines(flat, visit({ budgetHours: 4, actualHours: 3 }), NOW, TZ)
    expect(sum(lines)).toBe(2000)
    expect(lines[0].reason).toBe('Beat the time — WO-00123, 11/12 (saved 1 h)')
  })
  it('percent of hours saved x the hourly value', () => {
    // saved 1.5 h x $40 x 50% = $30 each (full)
    const lines = planVisitLines(pct, visit({ budgetHours: 5, actualHours: 3.5 }), NOW, TZ)
    expect(lines.map((l) => l.cents)).toEqual([3000, 3000])
  })
  it('nothing at or over budget, with no budget, or when nobody clocked', () => {
    expect(planVisitLines(flat, visit({ budgetHours: 4, actualHours: 4 }), NOW, TZ)).toEqual([])
    expect(planVisitLines(flat, visit({ budgetHours: 4, actualHours: 5 }), NOW, TZ)).toEqual([])
    expect(planVisitLines(flat, visit({ budgetHours: null, actualHours: 1 }), NOW, TZ)).toEqual([])
    expect(planVisitLines(flat, visit({ budgetHours: 4, actualHours: null }), NOW, TZ)).toEqual([])
  })
  it('person-hours from the clock, minus breaks, unfinished entries ignored', () => {
    const e = (id: string, userId: string, kind: 'work' | 'break', s: string, en: string | null, wo: string | null): TimeEntry => ({
      id, userId, subId: null, workOrderId: wo, jobId: null, kind, startedAt: s, endedAt: en, source: 'lead_tap', endSource: 'lead_tap', closedForTravel: false, needsReview: false, reviewNote: null, pricebookItemId: null, tappedBy: null, endedBy: null,
    })
    const entries = [
      e('1', A, 'work', '2026-11-12T13:00:00Z', '2026-11-12T16:00:00Z', 'wo1'),
      e('2', A, 'break', '2026-11-12T14:00:00Z', '2026-11-12T14:30:00Z', null),
      e('3', B, 'work', '2026-11-12T13:00:00Z', '2026-11-12T15:00:00Z', 'wo1'),
      e('4', B, 'work', '2026-11-12T15:00:00Z', null, 'wo1'),
      e('5', B, 'work', '2026-11-12T17:00:00Z', '2026-11-12T19:00:00Z', 'other'),
    ]
    expect(workOrderHours(entries, 'wo1')).toBe(2.5 + 2)
  })
})

describe('rule 3: review names the crew', () => {
  const s = settings({ review: { on: true, amount: 25, split: 'even' } })
  it('proposes only when staff marked it', () => {
    expect(planVisitLines(s, visit(), NOW, TZ)).toEqual([])
    const lines = planVisitLines(s, visit({ reviewAt: '2026-11-18T12:00:00Z' }), NOW, TZ)
    expect(lines.map((l) => l.cents)).toEqual([1250, 1250])
    expect(lines[0].sourceKey).toBe(`crew:review:wo1:${A}`)
  })
})

describe('rule 4: weekly target', () => {
  const week = { subId: 'sub1', weekEnding: '2026-11-18', visits: 10, dollars: 900, members: [A, B, C], earnedAt: new Date('2026-11-16T15:00:00Z') }
  it('visits: the crew splits the amount once the target is reached', () => {
    const s = settings({ weeklyTarget: { on: true, basis: 'visits', target: 10, amount: 100, split: 'even' } })
    expect(planWeeklyLines(s, { ...week, visits: 9 })).toEqual([])
    const lines = planWeeklyLines(s, week)
    expect(sum(lines)).toBe(10000)
    expect(lines[0].reason).toBe('Weekly crew target hit — week ending 11/18 (10 visits)')
    expect(lines[0].sourceKey).toBe(`crew:weeklyTarget:sub1:2026-11-18:${A}`)
  })
  it('dollars basis, full mode', () => {
    const s = settings({ weeklyTarget: { on: true, basis: 'dollars', target: 1000, amount: 50, split: 'full' } })
    expect(planWeeklyLines(s, week)).toEqual([])
    expect(planWeeklyLines(s, { ...week, dollars: 1000 }).map((l) => l.cents)).toEqual([5000, 5000, 5000])
  })
  it('progress shows dollars targets as a percent only', () => {
    const d = settings({ weeklyTarget: { on: true, basis: 'dollars', target: 1000, amount: 50, split: 'even' } })
    expect(targetProgress(d, { visits: 3, dollars: 620 })).toMatchObject({ percent: 62, goal: null, done: null, hit: false })
    const v = settings({ weeklyTarget: { on: true, basis: 'visits', target: 10, amount: 50, split: 'even' } })
    expect(targetProgress(v, { visits: 7, dollars: 0 })).toMatchObject({ percent: 70, goal: 10, done: 7 })
  })
})

describe('rule 5: deduction', () => {
  const s = settings({ deduction: { on: true, amount: 30, split: 'even' } })
  it('a marked callback is a NEGATIVE line per member', () => {
    const lines = planVisitLines(s, visit({ callbackAt: '2026-11-14T10:00:00Z' }), NOW, TZ)
    expect(lines.map((l) => l.cents)).toEqual([-1500, -1500])
    expect(lines[0].reason).toBe('Callback or redo — WO-00123, 11/12')
    expect(lines[0].sourceKey).toBe(`crew:deduction:wo1:${A}`)
  })
  it('full mode takes the whole amount from each', () => {
    expect(planVisitLines(settings({ deduction: { ...s.deduction, split: 'full' } }), visit({ callbackAt: '2026-11-14T10:00:00Z' }), NOW, TZ).map((l) => l.cents)).toEqual([-3000, -3000])
  })
  it('no mark, no deduction', () => {
    expect(planVisitLines(s, visit(), NOW, TZ)).toEqual([])
  })
})

describe('settings', () => {
  it('default is everything off', () => {
    expect(DEFAULT_CREW_INCENTIVE_SETTINGS.enabled).toBe(false)
    expect(readCrewIncentiveSettings(null)).toEqual(DEFAULT_CREW_INCENTIVE_SETTINGS)
    expect(readCrewIncentiveSettings({ doneRight: { on: 'yes', amount: -5 } }).doneRight).toMatchObject({ on: false, amount: 0 })
  })
  it('a patch merges over the current rule and refuses wrong values', () => {
    const cur = readCrewIncentiveSettings({ doneRight: { on: true, amount: 5, holdDays: 3 } })
    const ok = parseCrewIncentivesPatch({ crewIncentives: { doneRight: { amount: 12.5 }, enabled: true } }, cur)
    expect('set' in ok && ok.set).toMatchObject({ enabled: true, doneRight: { on: true, amount: 12.5, holdDays: 3 } })
    for (const bad of [
      { doneRight: { amount: -1 } }, { doneRight: { split: 'half' } }, { beatTime: { percent: 101 } }, { weeklyTarget: { basis: 'x' } },
      { doneRight: { holdDays: 99 } }, { nope: {} }, { doneRight: { nope: 1 } }, { enabled: 'yes' },
    ]) expect(parseCrewIncentivesPatch({ crewIncentives: bad }, cur)).toHaveProperty('error')
    expect(parseCrewIncentivesPatch({ crewIncentives: {} }, cur)).toHaveProperty('error')
  })
})
