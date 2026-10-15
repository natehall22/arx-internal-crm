import { buildSubScorecard } from '@/lib/reporting/sub-scorecard'
import type { JobLedgerRow } from '@/lib/reporting/job-ledger'

function row(over: Partial<JobLedgerRow> & { id: string; labor?: number }): JobLedgerRow {
  const { labor = 5000, ...rest } = over
  return {
    jobNumber: null,
    subId: 's1',
    salespersonId: null,
    completedMonth: '2026-09',
    squares: null,
    revenue: 20000,
    costs: { materials: 4000, labor, permit: 0, misc: 0, finance: 0, direct: 4000 + labor, total: 4000 + labor, pendingExtras: 0, pendingLines: 0, sources: [], hasLegacyOnly: false },
    salesComp: 3000,
    opp: 1800,
    grossProfit: 8000,
    ownerDraw: 1600,
    ownerDrawPerOwner: 400,
    allocatedOverhead: null,
    operatingProfit: null,
    netProfit: null,
    missingCostData: false,
    ...rest,
  }
}

describe('buildSubScorecard', () => {
  it('aggregates revenue, labor, gross profit, margin and average per job', () => {
    const [s] = buildSubScorecard([
      row({ id: '1', revenue: 20000, grossProfit: 8000 }),
      row({ id: '2', revenue: 10000, grossProfit: 2000 }),
    ])
    expect(s.subId).toBe('s1')
    expect(s.jobs).toBe(2)
    expect(s.jobsWithCosts).toBe(2)
    expect(s.revenue).toBe(30000)
    expect(s.laborCost).toBe(10000)
    expect(s.grossProfit).toBe(10000)
    expect(s.grossMarginPct).toBe(33.3)
    expect(s.avgGrossProfitPerJob).toBe(5000)
    expect(s.operatingProfit).toBeNull()
  })

  it('excludes missing-cost jobs from money averages but still counts them', () => {
    const [s] = buildSubScorecard([
      row({ id: '1', revenue: 20000, grossProfit: 8000 }),
      row({ id: '2', revenue: 20000, grossProfit: 20000, missingCostData: true, labor: 0 }),
    ])
    expect(s.jobs).toBe(2)
    expect(s.jobsWithCosts).toBe(1)
    expect(s.revenue).toBe(20000)
    expect(s.grossProfit).toBe(8000)
    expect(s.grossMarginPct).toBe(40)
    expect(s.avgGrossProfitPerJob).toBe(8000)
  })

  it('returns null margin/average when a sub has only un-costed jobs', () => {
    const [s] = buildSubScorecard([row({ id: '1', missingCostData: true })])
    expect(s.jobs).toBe(1)
    expect(s.jobsWithCosts).toBe(0)
    expect(s.grossMarginPct).toBeNull()
    expect(s.avgGrossProfitPerJob).toBeNull()
    expect(s.laborPerSquare).toBeNull()
    expect(s.revenue).toBe(0)
  })

  it('computes labor per square only over costed jobs that have squares', () => {
    const [s] = buildSubScorecard([
      row({ id: '1', squares: 20, labor: 4000 }), // 200/sq
      row({ id: '2', squares: 30, labor: 9000 }), // 300/sq
      row({ id: '3', squares: null, labor: 99999 }), // no squares: excluded
      row({ id: '4', squares: 10, labor: 1, missingCostData: true }), // un-costed: excluded
    ])
    expect(s.squares).toBe(50)
    expect(s.laborPerSquare).toBe(260) // 13000 / 50
  })

  it('rounds squares to 2 decimals and treats 0 squares as absent', () => {
    const [s] = buildSubScorecard([row({ id: '1', squares: 10.123 }), row({ id: '2', squares: 0 })])
    expect(s.squares).toBe(10.12)
    const [z] = buildSubScorecard([row({ id: '3', squares: 0 })])
    expect(z.laborPerSquare).toBeNull()
  })

  it('sums operating profit (before owner draw) only over costed jobs that have one', () => {
    const [s] = buildSubScorecard([
      row({ id: '1', operatingProfit: 5000, netProfit: 3400 }),
      row({ id: '2', operatingProfit: -500, netProfit: -400 }),
      row({ id: '3', operatingProfit: null }),
      row({ id: '4', operatingProfit: 9999, missingCostData: true }),
    ])
    expect(s.operatingProfit).toBe(4500)
  })

  it('sorts by average gross profit per job desc with the null (unassigned) sub last', () => {
    const out = buildSubScorecard([
      row({ id: '1', subId: null, grossProfit: 99999 }),
      row({ id: '2', subId: 'low', grossProfit: 1000 }),
      row({ id: '3', subId: 'high', grossProfit: 9000 }),
      row({ id: '4', subId: 'mid', grossProfit: 5000 }),
    ])
    expect(out.map((r) => r.subId)).toEqual(['high', 'mid', 'low', null])
  })

  it('sorts subs with no costed jobs after subs with data (but before unassigned)', () => {
    const out = buildSubScorecard([
      row({ id: '1', subId: 'nocost', missingCostData: true }),
      row({ id: '2', subId: null }),
      row({ id: '3', subId: 'ok', grossProfit: -100 }),
    ])
    expect(out.map((r) => r.subId)).toEqual(['ok', 'nocost', null])
  })

  it('returns an empty list for no rows', () => {
    expect(buildSubScorecard([])).toEqual([])
  })

  it('scores only completed jobs, and only counts jobs with a labor figure in the money averages', () => {
    const [s] = buildSubScorecard([
      row({ id: 'done', revenue: 20000, grossProfit: 8000 }),
      row({ id: 'open', completedMonth: null, revenue: 99999, grossProfit: 99999 }),
      row({ id: 'nolabor', labor: 0, revenue: 20000, grossProfit: 16000 }),
    ])
    expect(s.jobs).toBe(2)
    expect(s.jobsWithCosts).toBe(1)
    expect(s.avgGrossProfitPerJob).toBe(8000)
  })
})
