import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { ensureNextOpenPeriod } from '@/lib/payroll-periods'
import { loadPayWeek } from '@/lib/payroll-pay-week'
import { payWeekDays } from '@/lib/payroll-hours'
import { addDaysYmd, addEasternDays, cutoffInstantForYmd, getLastWeeklyPayrollCutoffEtAtOrBefore, weekStartYmd, weeklyPayrollPayDateForCutoff } from '@/lib/weekly-payroll/cutoff'

/**
 * Payroll dates are Eastern CALENDAR arithmetic, rebuilt with the timezone database (Wednesday 11:59:59.999 PM local).
 * Fixed 24-hour days are an hour off across a clock change. Clock changes: fall back Sun 2026-11-01, spring forward Sun 2027-03-14.
 */
const ORG = 'org1'
const iso = (d: Date) => d.toISOString()

describe('Wednesday cutoff across the clock changes', () => {
  it('fall back (2026-11-01): the next week\'s cutoff is Wed 11:59:59.999 PM EST, not 10:59 PM', () => {
    const before = cutoffInstantForYmd('2026-10-28') // EDT
    expect(iso(before)).toBe('2026-10-29T03:59:59.999Z')
    expect(iso(addEasternDays(before, 7))).toBe('2026-11-05T04:59:59.999Z') // EST
    expect(iso(new Date(before.getTime() + 7 * 86_400_000))).toBe('2026-11-05T03:59:59.999Z') // the naive answer: one hour early (22:59 EST)
  })

  it('spring forward (2027-03-14): the next week\'s cutoff is Wed 11:59:59.999 PM EDT, not Thursday 12:59 AM', () => {
    const before = cutoffInstantForYmd('2027-03-10') // EST
    expect(iso(before)).toBe('2027-03-11T04:59:59.999Z')
    expect(iso(addEasternDays(before, 7))).toBe('2027-03-18T03:59:59.999Z') // EDT
    expect(iso(new Date(before.getTime() + 7 * 86_400_000))).toBe('2027-03-18T04:59:59.999Z') // naive: lands on Thursday 12:59 AM
  })

  it('the week that ends in a clock-change week starts on the right Thursday', () => {
    expect(weekStartYmd(cutoffInstantForYmd('2026-11-04'))).toBe('2026-10-29')
    expect(weekStartYmd(cutoffInstantForYmd('2027-03-17'))).toBe('2027-03-11')
    // the old fixed-day way gave 2026-10-30 here (Oct 30 00:59 EDT)
    expect(weekStartYmd(cutoffInstantForYmd('2026-11-04'))).not.toBe('2026-10-30')
  })

  it('every pay week has 7 distinct Eastern days, the last being the cutoff\'s own date', () => {
    for (const ymd of ['2026-11-04', '2027-03-17', '2026-10-28', '2027-03-10']) {
      const w = payWeekDays(cutoffInstantForYmd(ymd).toISOString())
      expect(new Set(w.days).size).toBe(7)
      expect(w.end).toBe(ymd)
      expect(w.start).toBe(addDaysYmd(ymd, -6))
    }
  })

  it('payday is the Friday after, across both changes', () => {
    expect(weeklyPayrollPayDateForCutoff(cutoffInstantForYmd('2026-11-04'))).toBe('2026-11-06')
    expect(weeklyPayrollPayDateForCutoff(cutoffInstantForYmd('2027-03-17'))).toBe('2027-03-19')
  })

  it('"the week that just ended" is the right cutoff just before and just after each change', () => {
    expect(iso(getLastWeeklyPayrollCutoffEtAtOrBefore(new Date('2026-11-05T05:00:00Z')))).toBe('2026-11-05T04:59:59.999Z')
    expect(iso(getLastWeeklyPayrollCutoffEtAtOrBefore(new Date('2026-11-05T04:30:00Z')))).toBe('2026-10-29T03:59:59.999Z')
    expect(iso(getLastWeeklyPayrollCutoffEtAtOrBefore(new Date('2027-03-18T03:59:59.999Z')))).toBe('2027-03-18T03:59:59.999Z')
    expect(iso(getLastWeeklyPayrollCutoffEtAtOrBefore(new Date('2027-03-18T03:00:00Z')))).toBe('2027-03-11T04:59:59.999Z')
  })
})

describe('the periods the app creates and reads', () => {
  it('ensureNextOpenPeriod creates next week at the exact Eastern cutoff across the fall-back and spring-forward weeks', async () => {
    for (const [from, to] of [['2026-10-29T03:59:59.999Z', '2026-11-05T04:59:59.999Z'], ['2027-03-11T04:59:59.999Z', '2027-03-18T03:59:59.999Z']]) {
      const db = createFakeDb({ payroll_periods: [] })
      await ensureNextOpenPeriod(db.client, ORG, from)
      expect(db.tables.payroll_periods).toHaveLength(1)
      expect(iso(new Date(db.tables.payroll_periods[0].cutoff_at as string))).toBe(to)
      expect(db.tables.payroll_periods[0].period_label).toBe(`Week ending ${to.startsWith('2026') ? '2026-11-04' : '2027-03-17'}`)
    }
  })

  it('a week that crosses the clock change reports the right weekStart/weekEnding on the screen', async () => {
    const db = createFakeDb({ payroll_periods: [{ id: 'p', org_id: ORG, status: 'open', cutoff_at: '2026-11-05T04:59:59.999Z', scheduled_pay_date: '2026-11-06', period_label: 'w' }] })
    const week = await loadPayWeek(db.client, ORG, new Date('2026-11-05T12:00:00Z'), 'p')
    expect(week.period.weekEnding).toBe('2026-11-04')
    expect(week.period.weekStart).toBe('2026-10-29')
  })
})
