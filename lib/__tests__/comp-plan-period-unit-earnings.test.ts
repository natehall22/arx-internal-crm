import {
  computePeriodUnitEarningsFromCounts,
  extractPeriodUnitComponents,
  planHasPeriodUnitPay,
  resolveOpportunityCustomerName,
  resolveSaleCustomerName,
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
    expect(result.lines).toEqual([])
  })

  it('includes customer pay lines when provided', () => {
    const lines = [
      {
        unitType: 'sit' as const,
        payTypeLabel: 'Sit pay',
        amount: 5,
        rate: 5,
        customerName: 'Jane Smith',
        eventDate: '2026-05-28',
        opportunityId: 'opp-1',
        leadId: 'lead-1',
        contractId: null,
      },
      {
        unitType: 'sale' as const,
        payTypeLabel: 'Sale pay',
        amount: 10,
        rate: 10,
        customerName: 'Bob Jones',
        eventDate: '2026-05-30',
        opportunityId: 'opp-2',
        leadId: null,
        contractId: 'contract-1',
      },
    ]
    const result = computePeriodUnitEarningsFromCounts({
      components: [
        { unitType: 'sit', rate: 5 },
        { unitType: 'sale', rate: 10 },
      ],
      sitCount: 1,
      saleCount: 1,
      lines,
    })
    expect(result.lines).toEqual(lines)
    expect(result.total).toBe(15)
  })

  it('prefers lead homeowner name for sit customer display', () => {
    expect(
      resolveOpportunityCustomerName({
        leadHomeownerName: 'Jane Smith',
        customerName: 'Customer Record',
        addressText: '123 Main St',
        opportunityId: 'abcd1234',
      })
    ).toBe('Jane Smith')
  })

  it('prefers contract customer name for sale pay display', () => {
    expect(
      resolveSaleCustomerName({
        contractCustomerName: 'Signed Name',
        leadHomeownerName: 'Lead Name',
        opportunityId: 'abcd1234',
      })
    ).toBe('Signed Name')
  })

  it('falls back to opportunity customer resolution for sale when contract name blank', () => {
    expect(
      resolveSaleCustomerName({
        contractCustomerName: '',
        leadHomeownerName: 'Lead Name',
        opportunityId: 'abcd1234',
      })
    ).toBe('Lead Name')
  })
})
