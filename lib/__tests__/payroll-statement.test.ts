import {
  aggregateProjectedBreakdown,
  computePayrollStatementTotals,
  dealCommissionRoleForParticipant,
  resolveParticipantLineAmount,
  type PayrollStatementDealRow,
} from '@/lib/payroll-statement'

describe('dealCommissionRoleForParticipant', () => {
  it('maps owner and sales_rep to closer for deal_commission_roles joins', () => {
    expect(dealCommissionRoleForParticipant('owner')).toBe('closer')
    expect(dealCommissionRoleForParticipant('sales_rep')).toBe('closer')
  })

  it('maps setter to setter', () => {
    expect(dealCommissionRoleForParticipant('setter')).toBe('setter')
  })

  it('passes through manager roles', () => {
    expect(dealCommissionRoleForParticipant('field_manager')).toBe('field_manager')
  })
})

describe('computePayrollStatementTotals', () => {
  it('uses gross amounts pre-chargeback and subtracts chargebacks once in net', () => {
    const deals: Pick<PayrollStatementDealRow, 'grossAmount' | 'dealTotal'>[] = [
      { grossAmount: 100, dealTotal: 70 },
      { grossAmount: 50, dealTotal: 50 },
    ]
    const totals = computePayrollStatementTotals({
      deals,
      hourlyTotal: 200,
      chargebacksApplied: 80,
    })
    expect(totals.grossCommission).toBe(150)
    expect(totals.hourlyEarnings).toBe(200)
    expect(totals.chargebacksApplied).toBe(80)
    expect(totals.netPayout).toBe(270)
    expect(totals.grossCommissionDefinition).toBe('pre_chargeback')
    expect(totals.hasDeficit).toBe(false)
  })

  it('sets hasDeficit when net is negative', () => {
    const totals = computePayrollStatementTotals({
      deals: [{ grossAmount: 50, dealTotal: 50 }],
      hourlyTotal: 0,
      chargebacksApplied: 200,
    })
    expect(totals.netPayout).toBe(-150)
    expect(totals.hasDeficit).toBe(true)
  })

  it('does not double-subtract chargebacks already reflected in dealTotal', () => {
    const deals = [{ grossAmount: 100, dealTotal: 60 }]
    const totals = computePayrollStatementTotals({
      deals,
      hourlyTotal: 0,
      chargebacksApplied: 40,
    })
    expect(totals.netPayout).toBe(60)
  })
})

describe('aggregateProjectedBreakdown', () => {
  it('sums components across multiple deal lines (setter + closer same job)', () => {
    const deals = [
      {
        lineComponents: [
          { key: 'plan:a:base', label: 'Closer plan', amount: 80 },
          { key: 'volume_bonus', label: 'Volume bonus', amount: 5 },
        ],
      },
      {
        lineComponents: [{ key: 'plan:b:base', label: 'Setter plan', amount: 40 }],
      },
    ]
    const breakdown = aggregateProjectedBreakdown(deals)
    expect(breakdown).toHaveLength(3)
    const closer = breakdown.find((b) => b.label === 'Closer plan')
    const setter = breakdown.find((b) => b.label === 'Setter plan')
    const vol = breakdown.find((b) => b.key === 'volume_bonus')
    expect(closer?.amount).toBe(80)
    expect(setter?.amount).toBe(40)
    expect(vol?.amount).toBe(5)
  })
})

describe('resolveParticipantLineAmount', () => {
  it('replaces engine amount when override_amount is set', () => {
    const r = resolveParticipantLineAmount(100, 1000, { override_amount: 250 })
    expect(r.grossAmount).toBe(250)
    expect(r.overrideAmount).toBe(250)
  })

  it('uses override_percent of commissionable base', () => {
    const r = resolveParticipantLineAmount(100, 1000, { override_percent: 10 })
    expect(r.grossAmount).toBe(100)
    expect(r.overrideAmount).toBe(100)
  })

  it('adds premier pricing to engine amount when no override', () => {
    const r = resolveParticipantLineAmount(80, 1000, { premier_pricing_amount: 20 })
    expect(r.grossAmount).toBe(100)
    expect(r.premierPricingCommission).toBe(20)
  })
})

describe('hybrid statement shape', () => {
  it('net includes hourly when commission and hours both present', () => {
    const totals = computePayrollStatementTotals({
      deals: [{ grossAmount: 300, dealTotal: 300 }],
      hourlyTotal: 450,
      chargebacksApplied: 0,
    })
    expect(totals.netPayout).toBe(750)
    expect(totals.grossCommission).toBe(300)
    expect(totals.hourlyEarnings).toBe(450)
  })
})
