import {
  getCompPlanPayabilityWarnings,
  hasBlockingCompPlanWarning,
  planTypePaysCommission,
  PLAN_TYPES_WITHOUT_COMMISSION_LINES,
} from '@/lib/comp-plan-payability'
import { calculateCommissionFromPlanForSale } from '@/lib/calculate-commission-from-plan'
import {
  COMP_PLAN_ROLE_OPTIONS,
  isCompPlanManagerRole,
  compPlanRoleLabel,
  isKnownCompPlanRole,
} from '@/lib/comp-plan-roles'

describe('planTypePaysCommission', () => {
  it('matches what the commission engine actually calculates', () => {
    // Guard rail: if the payroll engine starts paying one of these types, this test
    // fails and PLAN_TYPES_WITHOUT_COMMISSION_LINES must be updated with it.
    for (const planType of PLAN_TYPES_WITHOUT_COMMISSION_LINES) {
      const result = calculateCommissionFromPlanForSale({
        plan: { id: 'p', plan_type: planType, base_percentage: 7 },
        commissionableAmount: 10000,
        periodVolume: 0,
        periodSits: 0,
        periodClosingRatePct: null,
        overridePercentage: null,
      })
      expect(result.totalAmount).toBe(0)
    }

    const paid = calculateCommissionFromPlanForSale({
      plan: { id: 'p', plan_type: 'percentage', base_percentage: 7 },
      commissionableAmount: 10000,
      periodVolume: 0,
      periodSits: 0,
      periodClosingRatePct: null,
      overridePercentage: null,
    })
    expect(paid.totalAmount).toBe(700)
    expect(planTypePaysCommission('percentage')).toBe(true)
    // hybrid now produces a real per-sale line from its % of Sale / $ per Job
    // components, so it is no longer warned about as a $0 plan type.
    expect(planTypePaysCommission('hybrid')).toBe(true)
    expect(planTypePaysCommission('hourly')).toBe(false)
  })
})

describe('getCompPlanPayabilityWarnings', () => {
  it('passes a clean ladder percentage plan', () => {
    const warnings = getCompPlanPayabilityWarnings({
      plan_type: 'percentage',
      base_percentage: '7',
    })
    expect(warnings).toHaveLength(0)
  })

  it('blocks a percentage plan with no rate', () => {
    const warnings = getCompPlanPayabilityWarnings({ plan_type: 'percentage', base_percentage: '' })
    expect(hasBlockingCompPlanWarning(warnings)).toBe(true)
  })

  it('blocks hourly/unit plans that pay $0 through per-sale commission math', () => {
    for (const planType of ['hourly', 'unit_based']) {
      const warnings = getCompPlanPayabilityWarnings({ plan_type: planType })
      expect(hasBlockingCompPlanWarning(warnings)).toBe(true)
    }
  })

  it('does not block a hybrid plan — its per-sale components now pay', () => {
    const warnings = getCompPlanPayabilityWarnings({ plan_type: 'hybrid' })
    expect(hasBlockingCompPlanWarning(warnings)).toBe(false)
  })

  it('blocks a flat-rate plan with no amount and allows one with an amount', () => {
    expect(
      hasBlockingCompPlanWarning(getCompPlanPayabilityWarnings({ plan_type: 'flat_rate', flat_amount: '0' }))
    ).toBe(true)
    expect(
      hasBlockingCompPlanWarning(getCompPlanPayabilityWarnings({ plan_type: 'flat_rate', flat_amount: '500' }))
    ).toBe(false)
  })

  it('blocks tiered plans with no tiers or all-zero rates', () => {
    expect(
      hasBlockingCompPlanWarning(getCompPlanPayabilityWarnings({ plan_type: 'tiered', tiers: [] }))
    ).toBe(true)
    expect(
      hasBlockingCompPlanWarning(
        getCompPlanPayabilityWarnings({ plan_type: 'tiered', tiers: [{ rate: '0' }, { rate: '' }] })
      )
    ).toBe(true)
    expect(
      hasBlockingCompPlanWarning(
        getCompPlanPayabilityWarnings({ plan_type: 'tiered', tiers: [{ rate: '5' }] })
      )
    ).toBe(false)
  })

  it('cautions (but does not block) on manager team overrides, which payroll does not pay', () => {
    const warnings = getCompPlanPayabilityWarnings({
      plan_type: 'percentage',
      base_percentage: '7',
      is_manager_plan: true,
      team_override_enabled: true,
      team_overrides: [{}],
    })
    expect(warnings).toHaveLength(1)
    expect(warnings[0].level).toBe('caution')
    expect(hasBlockingCompPlanWarning(warnings)).toBe(false)
  })
})

describe('comp plan role options', () => {
  it('covers every rung of the published ladder', () => {
    const roles = COMP_PLAN_ROLE_OPTIONS.map((o) => o.role)
    for (const required of ['canvasser', 'setter', 'sales_rep', 'setter_manager', 'sales_manager']) {
      expect(roles).toContain(required)
    }
  })

  it('has no duplicate role slugs', () => {
    const roles = COMP_PLAN_ROLE_OPTIONS.map((o) => o.role)
    expect(new Set(roles).size).toBe(roles.length)
  })

  it('treats all four manager slugs as manager roles', () => {
    for (const role of ['sales_manager', 'setter_manager', 'regional_manager', 'regional_setter_manager']) {
      expect(isCompPlanManagerRole(role)).toBe(true)
    }
    expect(isCompPlanManagerRole('sales_rep')).toBe(false)
  })

  it('falls back to the raw slug for roles saved before this list existed', () => {
    expect(isKnownCompPlanRole('rep')).toBe(false)
    expect(compPlanRoleLabel('rep')).toBe('rep')
    expect(compPlanRoleLabel('canvasser')).toBe('Field Marketer')
  })
})
