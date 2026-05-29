import { calculateCommissionFromPlanForSale } from '@/lib/calculate-commission-from-plan'

describe('calculateCommissionFromPlanForSale', () => {
  it('stacks matching percentage and flat bonuses across different tier metrics', () => {
    const result = calculateCommissionFromPlanForSale({
      plan: {
        id: 'closer-plan',
        plan_type: 'percentage',
        base_percentage: 6,
        volume_bonuses: [
          {
            min_volume: 20,
            max_volume: null,
            bonus_type: 'percentage',
            bonus_value: 5,
            tier_metric: 'closing_rate',
          },
          {
            min_volume: 12,
            max_volume: null,
            bonus_type: 'flat',
            bonus_value: 1000,
            tier_metric: 'sits',
          },
          {
            min_volume: 4,
            max_volume: null,
            bonus_type: 'percentage',
            bonus_value: 1.5,
            tier_metric: 'volume',
          },
        ],
      },
      commissionableAmount: 10000,
      periodVolume: 10000,
      periodSits: 12,
      periodClosingRatePct: 25,
      overridePercentage: null,
    })

    expect(result.baseRate).toBe(6)
    expect(result.volumeBonusRate).toBe(6.5)
    expect(result.volumeBonusFlat).toBe(1000)
    expect(result.effectiveRate).toBe(12.5)
    expect(result.totalAmount).toBe(2250)
  })

  it('returns zero commission but supported for hourly/hybrid (hours entered separately)', () => {
    const result = calculateCommissionFromPlanForSale({
      plan: { id: 'h', plan_type: 'hybrid' },
      commissionableAmount: 10000,
      periodVolume: 0,
      periodSits: 0,
      periodClosingRatePct: null,
      overridePercentage: null,
    })
    expect(result.unsupported).toBe(false)
    expect(result.totalAmount).toBe(0)
    expect(result.note).toMatch(/hours entry/i)
  })
})
