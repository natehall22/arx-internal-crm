import {
  computePeriodUnitEarningsFromCounts,
  extractPeriodUnitComponents,
  planHasPeriodUnitPay,
} from '@/lib/comp-plan-period-unit-earnings'

describe('comp-plan-period-unit-earnings', () => {
  it('extracts sit and sale components from hybrid plan', () => {
    const components = extractPeriodUnitComponents({
      plan_type: 'hybrid',
      hybrid_components: [
        { type: 'hourly', rate: 5 },
        { type: 'per_unit', rate: 5, unit_type: 'sit' },
        { type: 'per_unit', rate: 10, unit_type: 'sale' },
        { type: 'per_unit', rate: 25, unit_type: 'square' },
      ],
    })
    expect(components).toEqual([
      { unitType: 'sit', rate: 5 },
      { unitType: 'sale', rate: 10 },
    ])
    expect(
      planHasPeriodUnitPay({
        plan_type: 'hybrid',
        hybrid_components: [{ type: 'per_unit', rate: 5, unit_type: 'sit' }],
      })
    ).toBe(true)
  })

  it('computes call center example sit=$5 sale=$10', () => {
    const result = computePeriodUnitEarningsFromCounts({
      components: [
        { unitType: 'sit', rate: 5 },
        { unitType: 'sale', rate: 10 },
      ],
      sitCount: 12,
      saleCount: 3,
    })
    expect(result.total).toBe(90)
    expect(result.components).toEqual([
      { unitType: 'sit', label: 'Sit pay', count: 12, rate: 5, amount: 60 },
      { unitType: 'sale', label: 'Sale pay', count: 3, rate: 10, amount: 30 },
    ])
  })
})
