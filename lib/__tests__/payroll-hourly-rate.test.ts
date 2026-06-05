import { resolveHourlyRate } from '@/lib/payroll-hourly-rate'

describe('resolveHourlyRate', () => {
  it('prefers user override over plan rate', () => {
    expect(
      resolveHourlyRate({
        hourlyRateOverride: 22,
        compPlan: { id: 'p1', plan_type: 'hourly', hourly_rate: 15 },
      })
    ).toBe(22)
  })

  it('uses top-level hourly_rate on hourly plans', () => {
    expect(
      resolveHourlyRate({
        hourlyRateOverride: null,
        compPlan: { id: 'p1', plan_type: 'hourly', hourly_rate: 18 },
      })
    ).toBe(18)
  })

  it('extracts hourly rate from hybrid_components when top-level hourly_rate is unset', () => {
    expect(
      resolveHourlyRate({
        hourlyRateOverride: null,
        compPlan: {
          id: 'p1',
          plan_type: 'hybrid',
          hourly_rate: null,
          hybrid_components: [
            { type: 'hourly', rate: 5 },
            { type: 'per_unit', rate: 10, unit_type: 'sit' },
          ],
        },
      })
    ).toBe(5)
  })

  it('returns null when hybrid plan has no hourly component', () => {
    expect(
      resolveHourlyRate({
        hourlyRateOverride: null,
        compPlan: {
          id: 'p1',
          plan_type: 'hybrid',
          hybrid_components: [{ type: 'per_unit', rate: 10, unit_type: 'sit' }],
        },
      })
    ).toBeNull()
  })
})
