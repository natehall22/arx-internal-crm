import {
  calculateCommissionFromPlanForSale,
  hasUnsupportedBonusTier,
} from '@/lib/calculate-commission-from-plan'

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
        ],
      },
      commissionableAmount: 10000,
      periodSits: 12,
      periodClosingRatePct: 25,
      overridePercentage: null,
    })

    expect(result.baseRate).toBe(6)
    expect(result.volumeBonusRate).toBe(5)
    expect(result.volumeBonusFlat).toBe(1000)
    expect(result.effectiveRate).toBe(11)
    // totalAmount is the per-sale commission only; volumeBonusFlat is applied
    // once per period by the export pipeline, not per sale.
    expect(result.totalAmount).toBe(1100)
  })

  it('pays nothing on a legacy $-volume tier or a tier with no metric', () => {
    // Monthly sales-volume tiers were removed 2026-09-14. A row that still says
    // 'volume' (or omits tier_metric, which used to default to volume) must not
    // match on some other metric by accident.
    const result = calculateCommissionFromPlanForSale({
      plan: {
        id: 'legacy',
        plan_type: 'percentage',
        base_percentage: 7,
        volume_bonuses: [
          { min_volume: 0, max_volume: null, bonus_type: 'percentage', bonus_value: 2, tier_metric: 'volume' },
          { min_volume: 0, max_volume: null, bonus_type: 'flat', bonus_value: 500 },
        ],
      },
      commissionableAmount: 10000,
      periodSits: 50,
      periodClosingRatePct: 90,
      overridePercentage: null,
    })
    expect(result.volumeBonusRate).toBe(0)
    expect(result.volumeBonusFlat).toBe(0)
    expect(result.effectiveRate).toBe(7)
    expect(result.totalAmount).toBe(700)
  })

  it('returns zero commission but supported for hourly/hybrid (hours entered separately)', () => {
    const result = calculateCommissionFromPlanForSale({
      plan: { id: 'h', plan_type: 'hybrid' },
      commissionableAmount: 10000,
      periodSits: 0,
      periodClosingRatePct: null,
      overridePercentage: null,
    })
    expect(result.unsupported).toBe(false)
    expect(result.totalAmount).toBe(0)
    expect(result.note).toMatch(/hours entry/i)
  })
})

describe('hasUnsupportedBonusTier', () => {
  it('accepts no tiers and sits / close-rate tiers', () => {
    expect(hasUnsupportedBonusTier(null)).toBe(false)
    expect(hasUnsupportedBonusTier(undefined)).toBe(false)
    expect(hasUnsupportedBonusTier([])).toBe(false)
    expect(
      hasUnsupportedBonusTier([
        { min_volume: 20, max_volume: null, bonus_type: 'flat', bonus_value: 500, tier_metric: 'sits' },
        { min_volume: 30, max_volume: null, bonus_type: 'percentage', bonus_value: 1, tier_metric: 'closing_rate' },
      ])
    ).toBe(false)
  })

  it('rejects volume, untyped and malformed tiers', () => {
    expect(hasUnsupportedBonusTier([{ tier_metric: 'volume' }])).toBe(true)
    expect(hasUnsupportedBonusTier([{ min_volume: 0 }])).toBe(true)
    expect(hasUnsupportedBonusTier([null])).toBe(true)
    expect(hasUnsupportedBonusTier({ tier_metric: 'sits' })).toBe(true)
  })
})
