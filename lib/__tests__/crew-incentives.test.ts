/** Crew incentive rules (pure): each rule, the split modes, the deduction, settings parsing. */
import {
  DEFAULT_CREW_INCENTIVE_SETTINGS,
  DEDUCTION_LIMITED_TEXT,
  RULE_KEYS,
  capDeductionCents,
  countsForWeeklyTarget,
  coveredByRule,
  liveSince,
  parseCrewIncentivesPatch,
  planVisitLines,
  planWeeklyLines,
  readCrewIncentiveSettings,
  splitCents,
  targetProgress,
  timeOnSite,
  type RuleKey,
  type CrewIncentiveSettings,
  type VisitFacts,
  isDeductionNeedsBonusesError,
} from '@/lib/crew-incentives'
import { DEFAULT_TIMEZONE } from '@/lib/timezone'
import type { TimeEntry } from '@/lib/time-tracking'

const TZ = DEFAULT_TIMEZONE
const A = 'aaaaaaaa-0000-4000-8000-000000000001'
const B = 'aaaaaaaa-0000-4000-8000-000000000002'
const C = 'aaaaaaaa-0000-4000-8000-000000000003'
const NOW = new Date('2026-11-20T15:00:00Z')

const EARLY = '2026-01-01T00:00:00.000Z' // everything below was turned on long before the visits (no back-pay cut-off applies)
type Over = { [K in RuleKey]?: Partial<CrewIncentiveSettings[K]> } & { enabled?: boolean; enabledAt?: string | null }
const settings = (over: Over = {}): CrewIncentiveSettings => {
  const base = readCrewIncentiveSettings({ enabled: true, enabledAt: EARLY, ...Object.fromEntries(RULE_KEYS.map((k) => [k, { onSince: EARLY }])) })
  const out = { ...base, ...(over.enabled !== undefined ? { enabled: over.enabled } : {}), ...(over.enabledAt !== undefined ? { enabledAt: over.enabledAt } : {}) } as Record<string, unknown>
  for (const k of RULE_KEYS) out[k] = { ...(base[k] as object), ...((over[k] as object) ?? {}) }
  return out as unknown as CrewIncentiveSettings
}
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
    expect(lines[0].reason).toBe('Beat the time — WO-00123, 11/12 (on site 3 h, budget 4 h)')
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
  it('time on site is wall clock: first clock-in to last clock-out, not man-hours, breaks not taken out', () => {
    const e = (id: string, userId: string, kind: 'work' | 'break', s: string, en: string | null, wo: string | null): TimeEntry => ({
      id, userId, subId: null, workOrderId: wo, jobId: null, kind, startedAt: s, endedAt: en, source: 'lead_tap', endSource: 'lead_tap', closedForTravel: false, needsReview: false, reviewNote: null, pricebookItemId: null, tappedBy: null, endedBy: null,
    })
    // Two people, 13:00-16:00 and 14:00-15:00, a break in the middle: 3 hours on site, not 4 man-hours or 3.5 minus the break.
    const done = [
      e('1', A, 'work', '2026-11-12T13:00:00Z', '2026-11-12T16:00:00Z', 'wo1'),
      e('2', A, 'break', '2026-11-12T14:00:00Z', '2026-11-12T14:30:00Z', null),
      e('3', B, 'work', '2026-11-12T14:00:00Z', '2026-11-12T15:00:00Z', 'wo1'),
      e('5', B, 'work', '2026-11-12T17:00:00Z', '2026-11-12T19:00:00Z', 'other'),
    ]
    expect(timeOnSite(done, 'wo1')).toEqual({ hours: 3, open: false })
    expect(timeOnSite(done, 'nobody')).toEqual({ hours: null, open: false })
    // Anyone still clocked in on it: the visit is not finished being timed.
    expect(timeOnSite([...done, e('4', B, 'work', '2026-11-12T15:00:00Z', null, 'wo1')], 'wo1').open).toBe(true)
  })
  it('a visit with a clock still open pays nothing under any rule', () => {
    const all = settings({ doneRight: { on: true, amount: 10 }, review: { on: true, amount: 5 }, deduction: { on: true, amount: 5 } })
    expect(planVisitLines(all, visit({ budgetHours: 4, actualHours: 3, clockOpen: true, reviewAt: '2026-11-18T12:00:00Z', callbackAt: '2026-11-18T12:00:00Z' }), NOW, TZ)).toEqual([])
  })
  it('the reason says what was beaten: time on site against the budget', () => {
    const lines = planVisitLines(flat, visit({ budgetHours: 4, actualHours: 3 }), NOW, TZ)
    expect(lines[0].reason).toBe('Beat the time — WO-00123, 11/12 (on site 3 h, budget 4 h)')
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
  it('the line names who marked it (staff, never the customer)', () => {
    const lines = planVisitLines(s, visit({ reviewAt: '2026-11-18T12:00:00Z', reviewBy: 'Dana Office' }), NOW, TZ)
    expect(lines[0].reason).toBe('5-star review named the crew — WO-00123, 11/12 (marked by Dana Office)')
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
    // A per-week seed, so two weeks' lines rolled onto one open pay week never share a source id.
    expect(lines[0].sourceId).toBe('sub1|2026-11-18')
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
    expect(planVisitLines(s, visit({ callbackAt: '2026-11-14T10:00:00Z', callbackBy: 'Dana Office' }), NOW, TZ)[0].reason).toBe('Callback or redo — WO-00123, 11/12 (marked by Dana Office)')
    expect(lines[0].sourceKey).toBe(`crew:deduction:wo1:${A}`)
  })
  it('full mode takes the whole amount from each', () => {
    expect(planVisitLines(settings({ deduction: { ...s.deduction, split: 'full' } }), visit({ callbackAt: '2026-11-14T10:00:00Z' }), NOW, TZ).map((l) => l.cents)).toEqual([-3000, -3000])
  })
  it('no mark, no deduction', () => {
    expect(planVisitLines(s, visit(), NOW, TZ)).toEqual([])
  })
  it('only takes back bonus money: capped at what the person has, the rest dropped (never lower than $0)', () => {
    expect(capDeductionCents(-1500, 4000)).toEqual({ cents: -1500, limited: false })
    expect(capDeductionCents(-1500, 500)).toEqual({ cents: -500, limited: true })
    expect(capDeductionCents(-1500, 0)).toEqual({ cents: 0, limited: true })
    expect(capDeductionCents(-1500, -300)).toEqual({ cents: 0, limited: true }) // never a negative room
    expect(DEDUCTION_LIMITED_TEXT).toBe('Deduction limited to bonuses earned this week')
  })
})

describe('no back pay (owner decision): a rule pays only for work finished after it was turned on', () => {
  const on = (since: string) => settings({ enabledAt: EARLY, doneRight: { on: true, amount: 10, onSince: since }, review: { on: true, amount: 5, onSince: since }, deduction: { on: true, amount: 5, onSince: since }, beatTime: { on: true, amount: 5, onSince: since } })
  const all = (extra: Partial<VisitFacts> = {}) => visit({ budgetHours: 4, actualHours: 3, reviewAt: '2026-11-18T12:00:00Z', callbackAt: null, ...extra })
  it('work finished before the rule was turned on earns nothing; after it, everything', () => {
    const rules = (lines: ReturnType<typeof planVisitLines>) => Array.from(new Set(lines.map((l) => l.rule))).sort()
    expect(rules(planVisitLines(on('2026-11-13T00:00:00.000Z'), all(), NOW, TZ))).toEqual([]) // visit done 11/12
    expect(rules(planVisitLines(on('2026-11-12T00:00:00.000Z'), all(), NOW, TZ))).toEqual(['beatTime', 'doneRight', 'review'])
  })
  it('marking an OLD visit pays and deducts nothing', () => {
    const s = on('2026-11-13T00:00:00.000Z')
    expect(planVisitLines(s, visit({ reviewAt: '2026-11-18T12:00:00Z', callbackAt: '2026-11-18T12:00:00Z' }), NOW, TZ)).toEqual([])
  })
  it('the master switch counts too: a rule that was on earlier still waits for the switch', () => {
    const s = settings({ enabledAt: '2026-11-13T00:00:00.000Z', doneRight: { on: true, amount: 10 } })
    expect(liveSince(s, 'doneRight')).toBe(Date.parse('2026-11-13T00:00:00.000Z'))
    expect(planVisitLines(s, visit(), NOW, TZ)).toEqual([])
  })
  it('a missing stamp fails closed (pays nothing)', () => {
    const s = { ...settings(), enabledAt: null }
    expect(liveSince(s, 'doneRight')).toBeNull()
    expect(coveredByRule(s, 'doneRight', '2026-11-12T15:00:00Z')).toBe(false)
    expect(planVisitLines(s, visit(), NOW, TZ)).toEqual([])
  })
  it('the weekly target counts only visits finished after it was turned on, and only crew work', () => {
    const s = settings({ weeklyTarget: { on: true, target: 2, amount: 10, onSince: '2026-11-13T00:00:00.000Z' } })
    expect(countsForWeeklyTarget(s, { visit_step: 'service', completed_at: '2026-11-12T15:00:00Z' })).toBe(false)
    expect(countsForWeeklyTarget(s, { visit_step: 'service', completed_at: '2026-11-14T15:00:00Z' })).toBe(true)
    expect(countsForWeeklyTarget(s, { visit_step: 'inspection', completed_at: '2026-11-14T15:00:00Z' })).toBe(false)
  })
  it('turning a rule on stamps the moment; off clears it; the browser can never set a stamp', () => {
    const NOWP = new Date('2026-11-20T15:00:00Z')
    const cur = readCrewIncentiveSettings({ enabled: true, enabledAt: EARLY })
    const turnedOn = parseCrewIncentivesPatch({ crewIncentives: { doneRight: { on: true, amount: 5, onSince: '2020-01-01T00:00:00Z' }, enabledAt: '2020-01-01T00:00:00Z' } }, cur, NOWP)
    expect('set' in turnedOn && (turnedOn.set.doneRight as { onSince: string }).onSince).toBe(NOWP.toISOString())
    const stays = readCrewIncentiveSettings({ enabled: true, enabledAt: EARLY, doneRight: { on: true, onSince: EARLY, amount: 5 } })
    const edited = parseCrewIncentivesPatch({ crewIncentives: { doneRight: { amount: 7 } } }, stays, NOWP)
    expect('set' in edited && (edited.set.doneRight as { onSince: string }).onSince).toBe(EARLY) // an edit does not restart the clock
    const off = parseCrewIncentivesPatch({ crewIncentives: { doneRight: { on: false } } }, stays, NOWP)
    expect('set' in off && (off.set.doneRight as { onSince: string | null }).onSince).toBeNull()
    const master = parseCrewIncentivesPatch({ crewIncentives: { enabled: true } }, readCrewIncentiveSettings({ enabled: false }), NOWP)
    expect('set' in master && master.set.enabledAt).toBe(NOWP.toISOString())
    const masterOff = parseCrewIncentivesPatch({ crewIncentives: { enabled: false } }, cur, NOWP)
    expect('set' in masterOff && masterOff.set.enabledAt).toBeNull()
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

describe('approving a deduction before its bonuses', () => {
  it('recognises the database refusal (crew_deduction_cap) and nothing else', () => {
    expect(isDeductionNeedsBonusesError({ message: "crew_deduction_needs_bonuses: approve this person's crew bonuses for the week first" })).toBe(true)
    expect(isDeductionNeedsBonusesError({ message: 'payroll_period_not_open: this week is already approved' })).toBe(false)
    expect(isDeductionNeedsBonusesError(null)).toBe(false)
  })
})
