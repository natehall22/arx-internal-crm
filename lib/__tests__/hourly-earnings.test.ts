import { computeHourlyEarnings } from '@/lib/weekly-payroll/hourly-earnings'

describe('computeHourlyEarnings', () => {
  it('computes regular, OT at 1.5x, and total', () => {
    const r = computeHourlyEarnings({
      regularHours: 40,
      overtimeHours: 5,
      hourlyRate: 20,
    })
    expect(r.regularEarnings).toBe(800)
    expect(r.overtimeEarnings).toBe(150)
    expect(r.total).toBe(950)
  })
})
