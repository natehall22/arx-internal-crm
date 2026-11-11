import {
  addWeeks,
  cutoffYmd,
  describePayWeek,
  lastCutoffAtOrBefore,
  lateFundingUntil,
  LEGACY_PAY_WEEK,
  nextCutoffAfter,
  parsePayWeek,
  payDateFor,
  previewPayWeekChange,
  readPayWeekSchedule,
  weekDays,
  type PayWeekSchedule,
} from '@/lib/payroll-week-schedule'
import { DEFAULT_TIMEZONE } from '@/lib/timezone'
import {
  addEasternDays,
  getLastWeeklyPayrollCutoffEtAtOrBefore,
  getNextWeeklyPayrollCutoffEtAfter,
  weekStartYmd,
  weeklyPayrollPayDateForCutoff,
} from '@/lib/weekly-payroll/cutoff'

const legacy: PayWeekSchedule = { ...LEGACY_PAY_WEEK, timeZone: DEFAULT_TIMEZONE }
// ARX's rep agreements: Monday–Sunday, paid the following Friday; financed money in by Wednesday 11:59:59 PM still pays.
const monSun: PayWeekSchedule = { weekStartDay: 1, cutoffTime: '23:59', paydayWeekday: 5, lateFunding: { weekday: 3, time: '23:59' }, timeZone: DEFAULT_TIMEZONE }

describe('legacy schedule = the code before the setting (byte-identical)', () => {
  // Every 6 hours across a whole year, both clock changes included.
  const start = Date.parse('2026-01-01T00:00:00Z')
  const instants = Array.from({ length: 4 * 366 }, (_, i) => new Date(start + i * 6 * 3_600_000))
  it('last cutoff / next cutoff / payday / week start / +k weeks all agree with lib/weekly-payroll/cutoff.ts', () => {
    for (const at of instants) {
      const a = lastCutoffAtOrBefore(at, legacy)
      expect(a.toISOString()).toBe(getLastWeeklyPayrollCutoffEtAtOrBefore(at).toISOString())
      expect(nextCutoffAfter(at, legacy).toISOString()).toBe(getNextWeeklyPayrollCutoffEtAfter(at).toISOString())
      expect(payDateFor(a, legacy)).toBe(weeklyPayrollPayDateForCutoff(a))
      expect(weekDays(a, legacy).start).toBe(weekStartYmd(a))
      expect(addWeeks(a, 1, legacy).toISOString()).toBe(addEasternDays(a, 7).toISOString())
      expect(addWeeks(a, -2, legacy).toISOString()).toBe(addEasternDays(a, -14).toISOString())
    }
  })
  it('a company with nothing saved (or junk saved) gets the legacy schedule', () => {
    expect(readPayWeekSchedule({}, null)).toEqual(legacy)
    expect(readPayWeekSchedule({ payWeek: { weekStartDay: 9 } }, DEFAULT_TIMEZONE)).toEqual(legacy)
    expect(readPayWeekSchedule(null, undefined)).toEqual(legacy)
  })
})

describe('Monday–Sunday, Sunday cutoff, Friday payday', () => {
  it('cutoff is Sunday 11:59:59.999 PM local; payday the Friday after', () => {
    const c = lastCutoffAtOrBefore(new Date('2026-11-11T15:00:00Z'), monSun) // a Wednesday
    expect(c.toISOString()).toBe('2026-11-09T04:59:59.999Z') // Sun 2026-11-08 23:59:59.999 EST
    expect(cutoffYmd(c, monSun)).toBe('2026-11-08')
    expect(payDateFor(c, monSun)).toBe('2026-11-13')
    expect(weekDays(c, monSun)).toEqual(expect.objectContaining({ start: '2026-11-02', end: '2026-11-08' }))
    expect(lateFundingUntil(c, monSun)!.toISOString()).toBe('2026-11-12T04:59:59.999Z') // Wed 11-11 23:59:59.999 EST
  })
  it('one millisecond before / at the cutoff', () => {
    const c = new Date('2026-11-09T04:59:59.999Z')
    expect(lastCutoffAtOrBefore(c, monSun).toISOString()).toBe(c.toISOString())
    expect(lastCutoffAtOrBefore(new Date(c.getTime() - 1), monSun).toISOString()).toBe('2026-11-02T04:59:59.999Z')
    expect(nextCutoffAfter(new Date(c.getTime() - 1), monSun).toISOString()).toBe(c.toISOString())
  })

  it('DST March: the week holding the spring-forward Sunday closes at 23:59 EDT and is still 7 calendar days', () => {
    // 2026-03-08 02:00 EST -> 03:00 EDT. That Sunday is a cutoff day.
    const c = lastCutoffAtOrBefore(new Date('2026-03-09T12:00:00Z'), monSun)
    expect(c.toISOString()).toBe('2026-03-09T03:59:59.999Z') // 23:59:59.999 EDT
    const prev = addWeeks(c, -1, monSun)
    expect(prev.toISOString()).toBe('2026-03-02T04:59:59.999Z') // 23:59:59.999 EST: 167 hours earlier, not 168
    expect(weekDays(c, monSun, prev)).toEqual({ start: '2026-03-02', end: '2026-03-08', days: ['2026-03-08', '2026-03-07', '2026-03-06', '2026-03-05', '2026-03-04', '2026-03-03', '2026-03-02'] })
    expect(payDateFor(c, monSun)).toBe('2026-03-13')
    expect(lateFundingUntil(c, monSun)!.toISOString()).toBe('2026-03-12T03:59:59.999Z')
  })
  it('DST November: the fall-back Sunday cutoff is 23:59 EST and the week is 7 calendar days', () => {
    // 2026-11-01 02:00 EDT -> 01:00 EST.
    const c = lastCutoffAtOrBefore(new Date('2026-11-02T12:00:00Z'), monSun)
    expect(c.toISOString()).toBe('2026-11-02T04:59:59.999Z')
    const prev = addWeeks(c, -1, monSun)
    expect(prev.toISOString()).toBe('2026-10-26T03:59:59.999Z') // 169 hours earlier
    expect(weekDays(c, monSun, prev).days).toHaveLength(7)
    expect(weekDays(c, monSun, prev).start).toBe('2026-10-26')
    // An instant in the repeated 1 AM hour belongs to the week that has not closed yet.
    expect(nextCutoffAfter(new Date('2026-11-01T05:30:00Z'), monSun).toISOString()).toBe(c.toISOString())
  })
  it('a company in another zone gets its own wall clock', () => {
    const pacific = { ...monSun, timeZone: 'America/Los_Angeles' }
    expect(lastCutoffAtOrBefore(new Date('2026-11-11T15:00:00Z'), pacific).toISOString()).toBe('2026-11-09T07:59:59.999Z')
  })
})

describe('transition week and odd gaps', () => {
  it('weekDays: a neighbour 1–13 days back sets the length; further back is a normal week', () => {
    const c = '2026-11-09T04:59:59.999Z' // Sun 11-08
    expect(weekDays(c, monSun, '2026-11-05T04:59:59.999Z').days).toEqual(['2026-11-08', '2026-11-07', '2026-11-06', '2026-11-05'])
    expect(weekDays(c, monSun, '2026-10-27T03:59:59.999Z').days).toHaveLength(13) // Mon 10-26 -> 13 days
    expect(weekDays(c, monSun, '2026-08-16T22:10:00Z').days).toHaveLength(7) // ARX's last hand-made week: not a neighbour
    expect(weekDays(c, monSun, c).days).toHaveLength(7)
  })
  it('Wednesday → Sunday: Thursday–Sunday in-between week, then normal Monday–Sunday weeks', () => {
    // Last existing week ended Wed 11-11; the first new week closes Sun 11-15.
    const p = previewPayWeekChange(new Date('2026-11-16T04:59:59.999Z'), new Date('2026-11-12T04:59:59.999Z'), monSun)
    expect(p.firstWeek).toEqual({ start: '2026-11-12', end: '2026-11-15', payDate: '2026-11-20', days: 4 })
    expect(p.then[0]).toEqual({ start: '2026-11-16', end: '2026-11-22', payDate: '2026-11-27' })
  })
  it('no recent week (ARX: last CRM week was in August): the first new week is a normal 7-day week', () => {
    const p = previewPayWeekChange(new Date('2026-11-09T04:59:59.999Z'), '2026-08-16T22:10:00Z', monSun)
    expect(p.firstWeek).toEqual({ start: '2026-11-02', end: '2026-11-08', payDate: '2026-11-13', days: 7 })
  })
})

describe('parsePayWeek', () => {
  it('accepts a full schedule and describes it in plain words', () => {
    const r = parsePayWeek({ weekStartDay: 1, cutoffTime: '23:59', paydayWeekday: 5, lateFunding: { weekday: 3, time: '23:59' } })
    expect(r.ok).toBe(true)
    if (r.ok) expect(describePayWeek(r.value)).toBe('Monday–Sunday · closes Sunday 11:59 PM · paid Friday · money in by Wednesday 11:59 PM still pays that week')
  })
  it.each([
    [{ weekStartDay: 7, cutoffTime: '23:59', paydayWeekday: 5 }],
    [{ weekStartDay: 1, cutoffTime: '24:00', paydayWeekday: 5 }],
    [{ weekStartDay: 1, cutoffTime: '23:59', paydayWeekday: 1.5 }],
    [{ weekStartDay: 1, cutoffTime: '23:59', paydayWeekday: 5, lateFunding: { weekday: 6, time: '12:00' } }], // after payday
    [{ weekStartDay: 1, cutoffTime: '23:59', paydayWeekday: 5, lateFunding: { weekday: 5, time: '08:00' } }], // on payday
    [null],
  ])('refuses %j', (raw) => expect(parsePayWeek(raw).ok).toBe(false))
})
