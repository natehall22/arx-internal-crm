import { pickPayrollPeriodForWeekEnd, payrollZoneDate } from '@/lib/payroll-period-week'

// Zaavon's real Week 1 window ends 2026-06-15 00:00 ET (stored as 04:00Z).
const WEEK1_END = '2026-06-15T04:00:00.000Z'

describe('payrollZoneDate', () => {
  it('returns the America/New_York calendar date of a UTC instant', () => {
    // 04:00Z on Jun 15 is 00:00 ET on Jun 15 (EDT, -04:00).
    expect(payrollZoneDate('2026-06-15T04:00:00.000Z')).toBe('2026-06-15')
    // 03:59Z on Jun 15 is still 23:59 ET on Jun 14.
    expect(payrollZoneDate('2026-06-15T03:59:00.000Z')).toBe('2026-06-14')
  })
})

describe('pickPayrollPeriodForWeekEnd', () => {
  it("excludes a period that pays before the week ends (Zaavon's bug)", () => {
    // W24 pays Jun 12 — BEFORE the Jun 8–14 work week closes. Must not be chosen.
    const periods = [{ id: 'w24', scheduled_pay_date: '2026-06-12' }]
    expect(pickPayrollPeriodForWeekEnd(periods, WEEK1_END)).toBeNull()
  })

  it('picks the first payday on/after the week end (the Friday after the work)', () => {
    const periods = [
      { id: 'w24', scheduled_pay_date: '2026-06-12' }, // too early
      { id: 'w25', scheduled_pay_date: '2026-06-19' }, // correct
      { id: 'w26', scheduled_pay_date: '2026-06-26' }, // later
    ]
    expect(pickPayrollPeriodForWeekEnd(periods, WEEK1_END)).toBe('w25')
  })

  it('treats a payday exactly on the week-end date as eligible', () => {
    const periods = [{ id: 'same', scheduled_pay_date: '2026-06-15' }]
    expect(pickPayrollPeriodForWeekEnd(periods, WEEK1_END)).toBe('same')
  })

  it('is order-independent and always returns the earliest eligible', () => {
    const periods = [
      { id: 'late', scheduled_pay_date: '2026-07-03' },
      { id: 'correct', scheduled_pay_date: '2026-06-19' },
      { id: 'early', scheduled_pay_date: '2026-06-05' },
    ]
    expect(pickPayrollPeriodForWeekEnd(periods, WEEK1_END)).toBe('correct')
  })

  it('returns null when no open period pays on/after the week end (HOLD)', () => {
    const periods = [
      { id: 'w22', scheduled_pay_date: '2026-06-05' },
      { id: 'w24', scheduled_pay_date: '2026-06-12' },
    ]
    expect(pickPayrollPeriodForWeekEnd(periods, WEEK1_END)).toBeNull()
  })

  it('returns null when there are no periods at all', () => {
    expect(pickPayrollPeriodForWeekEnd([], WEEK1_END)).toBeNull()
  })
})
