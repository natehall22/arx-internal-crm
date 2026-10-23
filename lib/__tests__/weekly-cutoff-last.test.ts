import { getLastWeeklyPayrollCutoffEtAtOrBefore, weeklyPayrollPayDateForCutoff } from '@/lib/weekly-payroll/cutoff'

describe('last weekly cutoff', () => {
  it('Thursday evening → the Wednesday that just ended (EDT)', () => {
    const c = getLastWeeklyPayrollCutoffEtAtOrBefore(new Date('2026-10-22T20:00:00Z')) // Thu 4pm ET
    expect(c.toISOString()).toBe('2026-10-22T03:59:59.999Z') // Wed Oct 21 11:59:59.999 PM ET
    expect(weeklyPayrollPayDateForCutoff(c)).toBe('2026-10-23')
  })
  it('Wednesday afternoon → the PREVIOUS Wednesday (this week has not ended)', () => {
    expect(getLastWeeklyPayrollCutoffEtAtOrBefore(new Date('2026-10-21T18:00:00Z')).toISOString()).toBe('2026-10-15T03:59:59.999Z')
  })
  it('crosses the DST change (EST after Nov 1)', () => {
    const c = getLastWeeklyPayrollCutoffEtAtOrBefore(new Date('2026-11-05T15:00:00Z'))
    expect(c.toISOString()).toBe('2026-11-05T04:59:59.999Z')
    expect(weeklyPayrollPayDateForCutoff(c)).toBe('2026-11-06')
  })
})
