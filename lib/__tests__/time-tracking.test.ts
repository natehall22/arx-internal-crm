import { DEFAULT_TIMEZONE } from '@/lib/timezone'
import {
  clipIntervals,
  formatDuration,
  localHm,
  localTimeToInstant,
  localYmd,
  mergeIntervals,
  paidTime,
  parseClockTap,
  parseEntryEdit,
  parseTimeTrackingSettingsPatch,
  readTimeTrackingSettings,
  resolveTapTime,
  splitOvertime,
  subtractIntervals,
  totalSeconds,
  weekWarnings,
  DEFAULT_TIME_TRACKING_SETTINGS,
  type TimeEntry,
} from '@/lib/time-tracking'
import { payWeekCutoffFor, payWeekStartInstant, cutoffYmdEt } from '@/lib/weekly-payroll/cutoff'

const TZ = DEFAULT_TIMEZONE
const at = (ymd: string, hm: string) => localTimeToInstant(ymd, hm, TZ)!.toISOString()
let n = 0
function entry(p: Partial<TimeEntry> & Pick<TimeEntry, 'kind' | 'startedAt'>): TimeEntry {
  return {
    id: `e${++n}`,
    userId: 'u1',
    subId: null,
    workOrderId: 'wo1',
    jobId: null,
    endedAt: null,
    source: 'lead_tap',
    endSource: 'lead_tap',
    closedForTravel: false,
    needsReview: false,
    reviewNote: null,
    pricebookItemId: null,
    tappedBy: null,
    endedBy: null,
    ...p,
  }
}
const hours = (s: number) => s / 3600

describe('interval math', () => {
  it('merges, subtracts and clips', () => {
    expect(mergeIntervals([{ start: 5, end: 10 }, { start: 0, end: 5 }, { start: 20, end: 30 }])).toEqual([{ start: 0, end: 10 }, { start: 20, end: 30 }])
    expect(subtractIntervals([{ start: 0, end: 100 }], [{ start: 10, end: 20 }, { start: 90, end: 200 }])).toEqual([{ start: 0, end: 10 }, { start: 20, end: 90 }])
    expect(clipIntervals([{ start: 0, end: 100 }], 50, 70)).toEqual([{ start: 50, end: 70 }])
  })
})

describe('paidTime', () => {
  it('work minus lunch; lunch is only what was tapped', () => {
    const t = paidTime(
      [
        entry({ kind: 'work', startedAt: at('2026-06-10', '07:00'), endedAt: at('2026-06-10', '15:30') }),
        entry({ kind: 'break', startedAt: at('2026-06-10', '12:00'), endedAt: at('2026-06-10', '12:30') }),
      ],
      { timeZone: TZ }
    )
    expect(hours(totalSeconds(t.paid))).toBe(8)
    expect(hours(totalSeconds(t.breaks))).toBe(0.5)
  })

  it('pays the drive between stops only when the crew left "for the next stop" the same day', () => {
    const a = entry({ kind: 'work', startedAt: at('2026-06-10', '07:00'), endedAt: at('2026-06-10', '09:00'), closedForTravel: true })
    const b = entry({ kind: 'work', startedAt: at('2026-06-10', '09:25'), endedAt: at('2026-06-10', '11:00'), workOrderId: 'wo2' })
    const t = paidTime([a, b], { timeZone: TZ })
    expect(totalSeconds(t.travel)).toBe(25 * 60)
    expect(totalSeconds(t.paid)).toBe(4 * 3600)
    // Clocked out for the day (no travel flag): the gap is not paid.
    const t2 = paidTime([{ ...a, closedForTravel: false }, b], { timeZone: TZ })
    expect(totalSeconds(t2.travel)).toBe(0)
    // Travel flag but the next clock-in is the next morning: not paid.
    const c = entry({ kind: 'work', startedAt: at('2026-06-11', '07:00'), endedAt: at('2026-06-11', '08:00') })
    expect(totalSeconds(paidTime([a, c], { timeZone: TZ }).travel)).toBe(0)
  })

  it('open entries only count when a "now" is given (payroll takes closed time only)', () => {
    const e = entry({ kind: 'work', startedAt: at('2026-06-10', '07:00') })
    expect(totalSeconds(paidTime([e], { timeZone: TZ }).paid)).toBe(0)
    expect(totalSeconds(paidTime([e], { timeZone: TZ, now: Date.parse(at('2026-06-10', '08:00')) }).paid)).toBe(3600)
  })

  it('equipment never counts as a person’s time', () => {
    const e = entry({ kind: 'equipment', userId: null, pricebookItemId: 'p1', startedAt: at('2026-06-10', '07:00'), endedAt: at('2026-06-10', '09:00') })
    expect(totalSeconds(paidTime([e], { timeZone: TZ }).paid)).toBe(0)
  })
})

describe('clock changes (DST)', () => {
  it('March: a 10pm–6am shift across spring-forward is 7 hours', () => {
    const e = entry({ kind: 'work', startedAt: at('2026-03-07', '22:00'), endedAt: at('2026-03-08', '06:00') })
    expect(hours(totalSeconds(paidTime([e], { timeZone: TZ }).paid))).toBe(7)
  })

  it('November: a 10pm–6am shift across fall-back is 9 hours', () => {
    const e = entry({ kind: 'work', startedAt: at('2026-10-31', '22:00'), endedAt: at('2026-11-01', '06:00') })
    expect(hours(totalSeconds(paidTime([e], { timeZone: TZ }).paid))).toBe(9)
  })

  it('local wall time → instant: a skipped spring time moves forward, the repeated fall hour takes its first occurrence', () => {
    const skipped = localTimeToInstant('2026-03-08', '02:30', TZ)!
    expect(localHm(skipped.getTime(), TZ)).toBe('03:30')
    const repeated = localTimeToInstant('2026-11-01', '01:30', TZ)!
    expect(repeated.toISOString()).toBe('2026-11-01T05:30:00.000Z') // 01:30 EDT, the first one
    expect(localYmd(Date.parse('2026-11-01T04:30:00.000Z'), TZ)).toBe('2026-11-01')
  })

  it('pay weeks: the week holding the November change is 169 hours; March 167 — and shifts split at the cutoff', () => {
    const nov = payWeekCutoffFor(new Date(at('2026-11-02', '09:00')))
    expect(cutoffYmdEt(nov)).toBe('2026-11-04')
    expect((nov.getTime() + 1 - payWeekStartInstant(nov).getTime()) / 3_600_000).toBe(169)
    const mar = payWeekCutoffFor(new Date(at('2026-03-09', '09:00')))
    expect((mar.getTime() + 1 - payWeekStartInstant(mar).getTime()) / 3_600_000).toBe(167)

    // Wednesday 10pm → Thursday 2am crosses the weekly cutoff: 2 h in each week, none lost.
    const e = entry({ kind: 'work', startedAt: at('2026-11-04', '22:00'), endedAt: at('2026-11-05', '02:00') })
    const paid = paidTime([e], { timeZone: TZ }).paid
    const thisWeek = totalSeconds(clipIntervals(paid, payWeekStartInstant(nov).getTime(), nov.getTime()))
    const next = payWeekCutoffFor(new Date(at('2026-11-05', '01:00')))
    const nextWeek = totalSeconds(clipIntervals(paid, payWeekStartInstant(next).getTime(), next.getTime()))
    expect(Math.round(thisWeek / 60)).toBe(120)
    expect(Math.round(nextWeek / 60)).toBe(120)
    // An instant exactly at the cutoff belongs to that week.
    expect(payWeekCutoffFor(nov).getTime()).toBe(nov.getTime())
  })
})

describe('overtime + warnings', () => {
  it('splits at the company line, exact (no quarter-hour rounding)', () => {
    const ot = splitOvertime(41.5 * 3600 + 20, 40)
    expect(ot.regularHours).toBe(40)
    expect(ot.overtimeHours).toBeCloseTo(1.5 + 20 / 3600, 12)
    expect(splitOvertime(38 * 3600, 40)).toEqual({ regularHours: 38, overtimeHours: 0 })
    expect(splitOvertime(50 * 3600, 0)).toEqual({ regularHours: 50, overtimeHours: 0 })
  })

  it('warns (never deducts) on a long day with no break', () => {
    const cutoff = payWeekCutoffFor(new Date(at('2026-06-10', '09:00')))
    const w = weekWarnings([entry({ kind: 'work', startedAt: at('2026-06-10', '06:00'), endedAt: at('2026-06-10', '13:00') })], {
      timeZone: TZ,
      settings: DEFAULT_TIME_TRACKING_SETTINGS,
      weekFrom: payWeekStartInstant(cutoff).getTime(),
      weekTo: cutoff.getTime(),
      now: Date.parse(at('2026-06-12', '09:00')),
    })
    expect(w.map((x) => x.code)).toEqual(['no_break'])
    expect(w[0].text).toBe('7 h with no break')
  })

  it('formats durations', () => {
    expect(formatDuration(0)).toBe('0 min')
    expect(formatDuration(45 * 60)).toBe('45 min')
    expect(formatDuration(7 * 3600 + 20 * 60)).toBe('7 h 20 min')
  })
})

describe('taps', () => {
  const now = new Date('2026-06-10T15:00:00.000Z')
  const base = { tapId: 'tap-12345678', action: 'clock_in', at: now.toISOString(), deviceNow: now.toISOString(), workOrderId: '11111111-1111-4111-8111-111111111111' }

  it('parses and refuses bad input', () => {
    expect('tap' in parseClockTap(base)).toBe(true)
    expect(parseClockTap({ ...base, workOrderId: null })).toEqual({ error: 'Which stop or job?' })
    expect(parseClockTap({ ...base, action: 'nap' })).toEqual({ error: 'Unknown action' })
    expect(parseClockTap({ ...base, tapId: 'x' })).toEqual({ error: 'Bad tap id' })
    expect(parseClockTap({ ...base, userIds: ['not-a-uuid'] })).toEqual({ error: 'Bad people list' })
    expect(parseClockTap({ ...base, action: 'finish_answer', entryId: '11111111-1111-4111-8111-111111111111' })).toEqual({ error: 'What time did you finish?' })
  })

  it('uses phone time; corrects and flags a phone clock that is off', () => {
    const ok = resolveTapTime({ at: '2026-06-10T14:00:00.000Z', deviceNow: now.toISOString() }, now)
    expect('at' in ok && ok.at.toISOString()).toBe('2026-06-10T14:00:00.000Z')
    expect('flag' in ok && ok.flag).toBeNull()
    // Phone 10 minutes fast: the tap moves back 10 minutes and is flagged.
    const fast = resolveTapTime({ at: '2026-06-10T14:10:00.000Z', deviceNow: '2026-06-10T15:10:00.000Z' }, now)
    expect('at' in fast && fast.at.toISOString()).toBe('2026-06-10T14:00:00.000Z')
    expect('flag' in fast && fast.flag).toMatch(/fast/)
    // A queued tap from 8 days ago is refused.
    expect(resolveTapTime({ at: '2026-06-02T14:00:00.000Z', deviceNow: now.toISOString() }, now)).toHaveProperty('error')
  })
})

describe('office edits + settings', () => {
  it('needs a reason and sane times', () => {
    expect(parseEntryEdit({ startedAt: '2026-06-10T12:00:00Z' }, { adding: false })).toEqual({ error: 'Say why (a few words)' })
    expect(parseEntryEdit({ reason: 'Forgot', startedAt: '2026-06-10T12:00:00Z', endedAt: '2026-06-10T11:00:00Z' }, { adding: false })).toEqual({ error: 'End is before start' })
    expect(parseEntryEdit({ reason: 'Forgot to tap', userId: '11111111-1111-4111-8111-111111111111', startedAt: '2026-06-10T12:00:00Z', endedAt: '2026-06-10T13:00:00Z' }, { adding: true })).toEqual({ error: 'Which job or visit?' })
    const ok = parseEntryEdit({ reason: 'Came in late', startedAt: '2026-06-10T12:00:00Z' }, { adding: false })
    expect('edit' in ok && ok.edit.startedAt).toBe('2026-06-10T12:00:00.000Z')
  })

  it('reads defaults and validates owner saves', () => {
    expect(readTimeTrackingSettings({})).toEqual(DEFAULT_TIME_TRACKING_SETTINGS)
    expect(readTimeTrackingSettings({ timeTracking: { autoCloseHours: 10, captureLocation: true } })).toMatchObject({ autoCloseHours: 10, captureLocation: true, overtimeAfterHours: 40 })
    expect(readTimeTrackingSettings({ timeTracking: { autoCloseHours: 99 } }).autoCloseHours).toBe(12)
    expect(parseTimeTrackingSettingsPatch({ timeTracking: { autoCloseHours: 1 } })).toHaveProperty('error')
    expect(parseTimeTrackingSettingsPatch({ timeTracking: { overtimeAfterHours: 44 } })).toEqual({ set: { overtimeAfterHours: 44 } })
    expect(parseTimeTrackingSettingsPatch({ timeTracking: { bogus: 1 } })).toEqual({ error: 'Unknown setting: bogus' })
  })
})
