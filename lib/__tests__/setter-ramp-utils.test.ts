import { compute444WeekWindows } from '@/lib/program-444-utils'
import {
  computeSetterRampWeekWindow,
  tenureWeekNumberForDate,
  evaluateRampGate,
  computeRollingAverageAppointments,
} from '@/lib/setter-ramp-utils'

// Wednesday start date — exercises the "roll forward to next Sunday" branch,
// same fixture shape as program-444-period.test.ts uses for 444.
const START_DATE = new Date('2026-06-10T15:00:00Z') // Wed Jun 10, 2026

describe('computeSetterRampWeekWindow', () => {
  it('matches compute444WeekWindows exactly for weeks 1 and 2', () => {
    const legacy = compute444WeekWindows(START_DATE)
    const week1 = computeSetterRampWeekWindow(START_DATE, 1)
    const week2 = computeSetterRampWeekWindow(START_DATE, 2)

    expect(week1.weekStartsAt).toBe(legacy.week1StartsAt)
    expect(week1.weekEndsAt).toBe(legacy.week1EndsAt)
    expect(week2.weekStartsAt).toBe(legacy.week2StartsAt)
    expect(week2.weekEndsAt).toBe(legacy.week2EndsAt)
  })

  it('produces contiguous, non-overlapping weeks for an open-ended sequence', () => {
    for (let n = 1; n <= 8; n += 1) {
      const week = computeSetterRampWeekWindow(START_DATE, n)
      const next = computeSetterRampWeekWindow(START_DATE, n + 1)
      expect(week.weekEndsAt).toBe(next.weekStartsAt)
    }
  })

  it('rejects a non-positive week number', () => {
    expect(() => computeSetterRampWeekWindow(START_DATE, 0)).toThrow()
  })
})

describe('tenureWeekNumberForDate', () => {
  it('returns null before week 1 starts', () => {
    const week1 = computeSetterRampWeekWindow(START_DATE, 1)
    const beforeStart = new Date(new Date(week1.weekStartsAt).getTime() - 1000)
    expect(tenureWeekNumberForDate(START_DATE, beforeStart)).toBeNull()
  })

  it('identifies week 1, 2, and 3 correctly at their boundaries', () => {
    const week1 = computeSetterRampWeekWindow(START_DATE, 1)
    const week2 = computeSetterRampWeekWindow(START_DATE, 2)
    const week3 = computeSetterRampWeekWindow(START_DATE, 3)

    expect(tenureWeekNumberForDate(START_DATE, new Date(week1.weekStartsAt))).toBe(1)
    expect(tenureWeekNumberForDate(START_DATE, new Date(new Date(week1.weekEndsAt).getTime() - 1))).toBe(1)
    expect(tenureWeekNumberForDate(START_DATE, new Date(week2.weekStartsAt))).toBe(2)
    expect(tenureWeekNumberForDate(START_DATE, new Date(week3.weekStartsAt))).toBe(3)
  })

  it('keeps advancing indefinitely (week 10+ resolves correctly)', () => {
    const week10 = computeSetterRampWeekWindow(START_DATE, 10)
    expect(tenureWeekNumberForDate(START_DATE, new Date(week10.weekStartsAt))).toBe(10)
  })
})

describe('evaluateRampGate', () => {
  it('week 1 passes only at >= 200 doors', () => {
    expect(
      evaluateRampGate({ weekNumber: 1, doorsKnocked: 199, appointmentsSet: 0, rollingAvgAppointments: null, week3AvgTarget: 10 })
    ).toBe(false)
    expect(
      evaluateRampGate({ weekNumber: 1, doorsKnocked: 200, appointmentsSet: 0, rollingAvgAppointments: null, week3AvgTarget: 10 })
    ).toBe(true)
  })

  it('week 2 requires both 400 doors AND 4 appointments', () => {
    expect(
      evaluateRampGate({ weekNumber: 2, doorsKnocked: 400, appointmentsSet: 3, rollingAvgAppointments: null, week3AvgTarget: 10 })
    ).toBe(false)
    expect(
      evaluateRampGate({ weekNumber: 2, doorsKnocked: 399, appointmentsSet: 4, rollingAvgAppointments: null, week3AvgTarget: 10 })
    ).toBe(false)
    expect(
      evaluateRampGate({ weekNumber: 2, doorsKnocked: 400, appointmentsSet: 4, rollingAvgAppointments: null, week3AvgTarget: 10 })
    ).toBe(true)
  })

  it('week 3+ uses the rolling average against the org target, and fails with no history', () => {
    expect(
      evaluateRampGate({ weekNumber: 3, doorsKnocked: 0, appointmentsSet: 12, rollingAvgAppointments: null, week3AvgTarget: 10 })
    ).toBe(false)
    expect(
      evaluateRampGate({ weekNumber: 3, doorsKnocked: 0, appointmentsSet: 12, rollingAvgAppointments: 9.9, week3AvgTarget: 10 })
    ).toBe(false)
    expect(
      evaluateRampGate({ weekNumber: 5, doorsKnocked: 0, appointmentsSet: 12, rollingAvgAppointments: 10, week3AvgTarget: 10 })
    ).toBe(true)
  })
})

describe('computeRollingAverageAppointments', () => {
  it('returns null with no history', () => {
    expect(computeRollingAverageAppointments([])).toBeNull()
  })

  it('expands until the window is full, then becomes a true trailing average', () => {
    // window = 4
    expect(computeRollingAverageAppointments([8], 4)).toBe(8) // week 3 alone
    expect(computeRollingAverageAppointments([8, 12], 4)).toBe(10) // weeks 3-4
    expect(computeRollingAverageAppointments([8, 12, 10, 10], 4)).toBe(10) // full window
    // a 5th week drops week 3 from the trailing window
    expect(computeRollingAverageAppointments([8, 12, 10, 10, 4], 4)).toBe(9)
  })
})
