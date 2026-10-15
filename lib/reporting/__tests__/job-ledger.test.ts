import { buildJobLedger, oppCost, type LedgerJobInput } from '@/lib/reporting/job-ledger'
import { summarizeJobEconomics } from '@/lib/goals-job-economics'
import { summarizeJobCosts, type JobCostLineInput, type JobProductOrderInput } from '@/lib/job-costs'

function job(over: Partial<LedgerJobInput> & { id: string }): LedgerJobInput {
  return {
    sale_amount: 20000,
    sale_date: '2026-09-01',
    created_at: '2026-08-20T12:00:00Z',
    labor_cost: 5000,
    material_cost: 4000,
    dealer_fee_amount: null,
    commission_comp_base: 18000,
    commission_pre_tax_subtotal: null,
    completed_at: '2026-09-15',
    ...over,
  }
}

describe('buildJobLedger', () => {
  it('computes revenue, costs, sales comp and gross profit for a costed job', () => {
    const [row] = buildJobLedger([job({ id: 'j1', job_number: '26-0001', assigned_sub_id: 's1', salesperson_id: 'p1', squares: '30.5' })], new Map())
    expect(row.id).toBe('j1')
    expect(row.jobNumber).toBe('26-0001')
    expect(row.subId).toBe('s1')
    expect(row.salespersonId).toBe('p1')
    expect(row.squares).toBe(30.5)
    expect(row.revenue).toBe(20000)
    expect(row.costs.labor).toBe(5000)
    expect(row.costs.materials).toBe(4000)
    expect(row.costs.total).toBe(9000)
    expect(row.salesComp).toBe(3240) // 18% of 18,000 comp base
    expect(row.opp).toBe(1800)
    expect(row.grossProfit).toBe(5960) // 20000 - 9000 - 3240 - 1800 OPP
    expect(row.ownerDraw).toBe(1192) // 20% of 5960
    expect(row.ownerDrawPerOwner).toBe(298) // ÷ 4
    expect(row.missingCostData).toBe(false)
    expect(row.completedMonth).toBe('2026-09')
  })

  it('gross profit equals summarizeJobEconomics netProfit minus OPP for the same job (with lines, orders, dealer fee)', () => {
    const j = job({ id: 'j2', material_cost: null, labor_cost: null, dealer_fee_amount: 600 })
    const lines: JobCostLineInput[] = [
      { amount: 3000, cost_type: 'material', approved: true },
      { amount: 4000, cost_type: 'subcontractor', approved: true },
      { amount: 250, cost_type: 'permit', approved: true },
    ]
    const orders: JobProductOrderInput[] = [{ amount: 100, status: 'delivered' }]
    const [row] = buildJobLedger([j], new Map([['j2', lines]]), new Map([['j2', orders]]))
    const econ = summarizeJobEconomics([j], new Map([['j2', lines]]), new Map([['j2', orders]]))
    expect(row.grossProfit).toBe(Math.round((econ.netProfit - row.opp) * 100) / 100)
    expect(row.salesComp).toBe(econ.totalCommissions)
    expect(row.revenue).toBe(econ.totalSale)
    const costs = summarizeJobCosts({ materialCostColumn: null, laborCostColumn: null, dealerFeeAmount: 600, ordersTotal: 100, lines })
    expect(row.costs).toEqual(costs)
  })

  it('allocates overhead equally across jobs completed in the month and computes net profit', () => {
    const jobs = ['a', 'b', 'c', 'd', 'e'].map((id) => job({ id }))
    const rows = buildJobLedger(jobs, new Map(), new Map(), { '2026-09': 1200 })
    for (const r of rows) {
      expect(r.allocatedOverhead).toBe(240)
      expect(r.operatingProfit).toBe(5720) // 5960 − 240
      expect(r.netProfit).toBe(4528) // 5960 − 1192 draw − 240 overhead
    }
  })

  it('gives incomplete jobs null overhead and null net profit', () => {
    const rows = buildJobLedger([job({ id: 'a' }), job({ id: 'b', completed_at: null })], new Map(), new Map(), { '2026-09': 100 })
    expect(rows[0].allocatedOverhead).toBe(100)
    expect(rows[1].allocatedOverhead).toBeNull()
    expect(rows[1].netProfit).toBeNull()
    expect(rows[1].completedMonth).toBeNull()
  })

  it('completed job in a month without overhead carries 0 (not null)', () => {
    const [r] = buildJobLedger([job({ id: 'a' })], new Map())
    expect(r.allocatedOverhead).toBe(0)
    expect(r.netProfit).toBe(4768) // 5960 − 1192
  })

  it('a losing job carries a negative owner draw, like the sheet', () => {
    const [r] = buildJobLedger([job({ id: 'loss', labor_cost: 20000 })], new Map())
    expect(r.grossProfit).toBe(-9040) // 20000 − 24000 − 3240 − 1800
    expect(r.ownerDraw).toBe(-1808)
    expect(r.ownerDrawPerOwner).toBe(-452)
    expect(r.netProfit).toBe(-7232)
  })

  it('assigns the Eastern business month to a late-evening UTC completion', () => {
    const [r] = buildJobLedger([job({ id: 'a', completed_at: '2026-10-01T01:30:00Z' })], new Map(), new Map(), { '2026-09': 90, '2026-10': 10 })
    expect(r.completedMonth).toBe('2026-09')
    expect(r.allocatedOverhead).toBe(90)
  })

  it('flags missing cost data and treats squares edge values', () => {
    const rows = buildJobLedger(
      [
        job({ id: 'a', labor_cost: null, material_cost: null, squares: '' }),
        job({ id: 'b', squares: 'abc' }),
        job({ id: 'c', squares: null }),
        job({ id: 'd', squares: 0 }),
      ],
      new Map()
    )
    expect(rows[0].missingCostData).toBe(true)
    expect(rows[0].squares).toBeNull()
    expect(rows[1].squares).toBeNull()
    expect(rows[2].squares).toBeNull()
    expect(rows[3].squares).toBe(0)
    expect(rows[1].missingCostData).toBe(false)
  })

  it('cost lines count as cost data', () => {
    const [r] = buildJobLedger(
      [job({ id: 'a', labor_cost: null, material_cost: null })],
      new Map([['a', [{ amount: 500, cost_type: 'labor', approved: true }]]])
    )
    expect(r.missingCostData).toBe(false)
    expect(r.costs.labor).toBe(500)
  })

  it('defaults optional fields to null', () => {
    const [r] = buildJobLedger([job({ id: 'a' })], new Map())
    expect(r.jobNumber).toBeNull()
    expect(r.subId).toBeNull()
    expect(r.salespersonId).toBeNull()
  })

  it('falls back to estimating comp from sale amount when no comp base is stored', () => {
    const [r] = buildJobLedger([job({ id: 'a', commission_comp_base: null })], new Map())
    expect(r.salesComp).toBeGreaterThan(0)
    expect(r.grossProfit).toBe(Math.round((20000 - 9000 - r.salesComp - r.opp) * 100) / 100)
  })
})

describe('oppCost', () => {
  it('is 9% of the sale amount, never negative, rounded to the cent', () => {
    expect(oppCost(20000)).toBe(1800)
    expect(oppCost(0)).toBe(0)
    expect(oppCost(-500)).toBe(0)
    expect(oppCost(16325)).toBe(1469.25)
  })
})
