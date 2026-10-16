import { isLenderFeeCostLine, netProductOrdersTotal, summarizeJobCosts } from '@/lib/job-costs'

const base = { materialCostColumn: null, laborCostColumn: null, dealerFeeAmount: null, ordersTotal: null, lines: [] }

describe('summarizeJobCosts', () => {
  it('counts a 26-0041-shaped cost once: column wins, the interior-work line is a misc extra, the old order is ignored', () => {
    const r = summarizeJobCosts({
      ...base,
      materialCostColumn: 6327.5,
      laborCostColumn: 4589.55,
      ordersTotal: 5421.03,
      lines: [{ amount: 5421.03, cost_type: 'misc', approved: false, description: 'Interior Work; Jason W' }],
    })
    expect(r.materials).toBe(6327.5)
    expect(r.misc).toBe(5421.03)
    expect(r.direct).toBe(16338.08)
    expect(r.hasLegacyOnly).toBe(false)
    expect(r.pendingExtras).toBe(5421.03)
  })

  it('does not add material/labor lines on top of the stored columns', () => {
    const r = summarizeJobCosts({
      ...base,
      materialCostColumn: 1000,
      laborCostColumn: 500,
      lines: [
        { amount: 900, cost_type: 'material', approved: true },
        { amount: 400, cost_type: 'subcontractor', approved: true },
      ],
    })
    expect(r.direct).toBe(1500)
  })

  it('falls back to orders, then lines, when a column is empty', () => {
    expect(summarizeJobCosts({ ...base, ordersTotal: 700 }).materials).toBe(700)
    expect(summarizeJobCosts({ ...base, ordersTotal: 700 }).hasLegacyOnly).toBe(true)
    const r = summarizeJobCosts({
      ...base,
      lines: [
        { amount: 300, cost_type: 'material', approved: true },
        { amount: 200, cost_type: 'labor', approved: true },
        { amount: 50, cost_type: 'subcontractor', approved: true },
      ],
    })
    expect(r.materials).toBe(300)
    expect(r.labor).toBe(250)
  })

  it('treats the lender/dealer fee line as finance, not misc, and never both', () => {
    const feeLine = { amount: 918, cost_type: 'misc', approved: true, description: 'Lender / dealer fee' }
    const fromLine = summarizeJobCosts({ ...base, lines: [feeLine] })
    expect(fromLine.finance).toBe(918)
    expect(fromLine.misc).toBe(0)
    const fromColumn = summarizeJobCosts({ ...base, dealerFeeAmount: 918, lines: [feeLine] })
    expect(fromColumn.finance).toBe(918)
    expect(fromColumn.total).toBe(918)
  })

  it('recognises "Lending Fee" as the finance fee, so a mirrored lending-fee line is not counted twice (26-0013)', () => {
    const r = summarizeJobCosts({
      ...base,
      materialCostColumn: 1000,
      laborCostColumn: 500,
      dealerFeeAmount: 918,
      lines: [{ amount: 918, cost_type: 'misc', approved: true, description: 'Lending Fee (Sunlight)' }],
    })
    expect(r.misc).toBe(0)
    expect(r.total).toBe(2418)
  })

  it('keeps a stored $0 column authoritative instead of falling through', () => {
    expect(summarizeJobCosts({ ...base, materialCostColumn: 0, ordersTotal: 500 }).materials).toBe(0)
  })

  it('splits pending from approved extras and counts permit', () => {
    const r = summarizeJobCosts({
      ...base,
      lines: [
        { amount: 100, cost_type: 'permit', approved: true },
        { amount: 60, cost_type: 'other', approved: false },
      ],
    })
    expect(r.permit).toBe(100)
    expect(r.misc).toBe(60)
    expect(r.pendingExtras).toBe(60)
  })
})

describe('netProductOrdersTotal', () => {
  it('is null with no orders and nets out returns', () => {
    expect(netProductOrdersTotal([])).toBeNull()
    expect(
      netProductOrdersTotal([
        { amount: 1000, status: 'paid' },
        { amount: 200, status: 'returned' },
      ])
    ).toBe(800)
  })
})

describe('isLenderFeeCostLine', () => {
  it.each(['Lender / dealer fee', 'lending fee', 'Lending Fee (Sunlight)', 'Dealer fee'])('matches %s', (description) => {
    expect(isLenderFeeCostLine({ cost_type: 'misc', description })).toBe(true)
  })
  it.each(['Lender required roof inspection', 'Permit - lender requirement', 'Dumpster'])('does not match %s', (description) => {
    expect(isLenderFeeCostLine({ cost_type: 'misc', description })).toBe(false)
  })
})
