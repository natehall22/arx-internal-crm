import {
  calculateCommissionFromPlanForSale,
  sumHybridSaleComponents,
} from '@/lib/calculate-commission-from-plan'
import { isPoolCapExcludedPlanType } from '@/lib/commission-payroll'
import { poolKey, scaleCommissionsToPool } from '@/lib/payroll-export'

describe('sumHybridSaleComponents', () => {
  it('sums percentage and flat_per_job components and ignores period-scoped ones', () => {
    expect(
      sumHybridSaleComponents([
        { type: 'hourly', rate: 20 },
        { type: 'percentage', rate: 6 },
        { type: 'per_unit', rate: 10, unit_type: 'sit' },
        { type: 'flat_per_job', rate: 150 },
      ])
    ).toEqual({ percentRate: 6, flatPerJob: 150, hasSaleBasedComponent: true })
  })

  it('sums repeated components of the same type rather than taking the first', () => {
    expect(
      sumHybridSaleComponents([
        { type: 'percentage', rate: 4 },
        { type: 'percentage', rate: 2 },
        { type: 'flat_per_job', rate: 50 },
        { type: 'flat_per_job', rate: 25 },
      ])
    ).toEqual({ percentRate: 6, flatPerJob: 75, hasSaleBasedComponent: true })
  })

  it('reports no sale-based component for a pure hourly / per-unit hybrid', () => {
    // This is the live "Call center rep" plan shape.
    expect(
      sumHybridSaleComponents([
        { type: 'hourly', rate: 5, description: 'Hourly' },
        { type: 'per_unit', rate: 10, unit_type: 'sit' },
        { type: 'per_unit', rate: 5, unit_type: 'sale' },
      ])
    ).toEqual({ percentRate: 0, flatPerJob: 0, hasSaleBasedComponent: false })
  })

  it('ignores junk, missing, zero and negative rates', () => {
    expect(
      sumHybridSaleComponents([
        { type: 'percentage', rate: null },
        { type: 'percentage', rate: Number.NaN },
        { type: 'percentage', rate: 0 },
        { type: 'flat_per_job', rate: -100 },
      ])
    ).toEqual({ percentRate: 0, flatPerJob: 0, hasSaleBasedComponent: false })
    expect(sumHybridSaleComponents(null)).toEqual({
      percentRate: 0,
      flatPerJob: 0,
      hasSaleBasedComponent: false,
    })
  })
})

describe('calculateCommissionFromPlanForSale — hybrid plans', () => {
  const base = {
    commissionableAmount: 14000,
    periodVolume: 0,
    periodSits: 0,
    periodClosingRatePct: null,
    overridePercentage: null,
  }

  it('pays a hybrid % of Sale component instead of $0', () => {
    // This is the live "Setting Manager" plan: a single 6% component that has never
    // produced a payroll line.
    const result = calculateCommissionFromPlanForSale({
      ...base,
      plan: {
        id: 'setting-manager',
        plan_type: 'hybrid',
        hybrid_components: [{ type: 'percentage', rate: 6, description: 'Commission' }],
      },
    })
    expect(result.baseRate).toBe(6)
    expect(result.effectiveRate).toBe(6)
    expect(result.totalAmount).toBe(840)
    expect(result.countsTowardPoolCap).toBe(true)
    expect(result.unsupported).toBe(false)
  })

  it('adds a $ per Job component on top of the percentage', () => {
    const result = calculateCommissionFromPlanForSale({
      ...base,
      plan: {
        id: 'hybrid-mixed',
        plan_type: 'hybrid',
        hybrid_components: [
          { type: 'percentage', rate: 3 },
          { type: 'flat_per_job', rate: 250 },
        ],
      },
    })
    // 3% of 14,000 = 420, plus 250 per job.
    expect(result.totalAmount).toBe(670)
  })

  it('pays the $ per Job component even with no percentage component', () => {
    const result = calculateCommissionFromPlanForSale({
      ...base,
      plan: {
        id: 'flat-per-job-only',
        plan_type: 'hybrid',
        hybrid_components: [
          { type: 'hourly', rate: 18 },
          { type: 'flat_per_job', rate: 300 },
        ],
      },
    })
    expect(result.baseRate).toBe(0)
    expect(result.totalAmount).toBe(300)
    expect(result.countsTowardPoolCap).toBe(true)
  })

  it('stacks a volume bonus onto the hybrid percentage components', () => {
    const result = calculateCommissionFromPlanForSale({
      ...base,
      plan: {
        id: 'hybrid-bonus',
        plan_type: 'hybrid',
        hybrid_components: [{ type: 'percentage', rate: 6 }],
        volume_bonuses: [
          { min_volume: 10000, max_volume: null, bonus_type: 'percentage', bonus_value: 1.5 },
        ],
      },
      periodVolume: 50000,
    })
    expect(result.effectiveRate).toBe(7.5)
    expect(result.totalAmount).toBe(1050)
  })

  it('lets user_comp_plans.override_percentage REPLACE the hybrid percentage components', () => {
    // Live landmine: the Setting Manager assignment carries override_percentage = 1.00
    // alongside a 6% component. The override replaces the rate, it does not stack.
    const result = calculateCommissionFromPlanForSale({
      ...base,
      plan: {
        id: 'setting-manager',
        plan_type: 'hybrid',
        hybrid_components: [{ type: 'percentage', rate: 6 }],
      },
      overridePercentage: 1,
    })
    expect(result.baseRate).toBe(1)
    expect(result.totalAmount).toBe(140)
  })

  it('still pays nothing, and stays outside the pool cap, for a pure hourly/per-unit hybrid', () => {
    const result = calculateCommissionFromPlanForSale({
      ...base,
      plan: {
        id: 'call-center',
        plan_type: 'hybrid',
        hybrid_components: [
          { type: 'hourly', rate: 5 },
          { type: 'per_unit', rate: 10, unit_type: 'sit' },
        ],
      },
    })
    expect(result.totalAmount).toBe(0)
    expect(result.countsTowardPoolCap).toBe(false)
    expect(result.unsupported).toBe(false)
  })

  it('keeps hourly and unit_based plans at $0 and outside the pool cap', () => {
    for (const planType of ['hourly', 'unit_based']) {
      const result = calculateCommissionFromPlanForSale({
        ...base,
        plan: { id: `p-${planType}`, plan_type: planType },
      })
      expect(result.totalAmount).toBe(0)
      expect(result.countsTowardPoolCap).toBe(false)
      expect(isPoolCapExcludedPlanType(planType)).toBe(true)
    }
  })

  it('leaves percentage and tiered plans byte-identical to before the hybrid change', () => {
    const pct = calculateCommissionFromPlanForSale({
      ...base,
      plan: { id: 'closer', plan_type: 'percentage', base_percentage: 7 },
    })
    expect(pct.totalAmount).toBe(980)
    expect(pct.countsTowardPoolCap).toBe(true)

    const flat = calculateCommissionFromPlanForSale({
      ...base,
      plan: { id: 'flat', plan_type: 'flat_rate', flat_amount: 500 },
    })
    expect(flat.totalAmount).toBe(500)
    expect(flat.countsTowardPoolCap).toBe(true)
  })
})

describe('pool-cap interaction once hybrid components pay', () => {
  const compBase = 14000
  const poolCap = 2520 // 18% of 14,000

  it('now counts a hybrid per-sale component inside the 18% cap', () => {
    // Closer 7% + a hybrid setter on 6% + a hybrid 6% setting manager = 19% > 18%.
    const raw = new Map<string, number>([
      [poolKey('closer', 'sales_rep'), 980],
      [poolKey('setter', 'setter'), 840],
      [poolKey('manager', 'owner'), 840],
    ])
    const { scaled, enforced } = scaleCommissionsToPool(raw, poolCap)
    expect(enforced).toBe(true)
    const total = Array.from(scaled.values()).reduce((a, b) => a + b, 0)
    expect(Math.round(total * 100) / 100).toBe(poolCap)
    // Every line scales down together — the hybrid line is not privileged.
    expect(scaled.get(poolKey('setter', 'setter'))!).toBeLessThan(840)
  })

  it('does NOT sweep hourly/per-unit dollars into the cap', () => {
    // A pure hourly/per-unit hybrid contributes 0 to the pool, so a job that is under
    // the cap on its percentage lines alone stays unenforced.
    const raw = new Map<string, number>([
      [poolKey('closer', 'sales_rep'), 980],
      [poolKey('call-center-rep', 'setter'), 0], // hourly + per-unit hybrid
    ])
    const { scaled, enforced } = scaleCommissionsToPool(raw, poolCap)
    expect(enforced).toBe(false)
    expect(scaled.get(poolKey('closer', 'sales_rep'))).toBe(980)
  })
})
