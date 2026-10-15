/**
 * TS side of the TS↔SQL parity check. The same fixtures drive supabase/proposed/test/run_parity.sh,
 * so `summarizeJobCosts` and the proposed `job_cost_summary()` SQL function can never drift apart
 * silently: change one, and one of the two suites fails until the other (and the fixture) follow.
 */
import { netProductOrdersTotal, summarizeJobCosts } from '@/lib/job-costs'
import fixtures from '@/supabase/proposed/test/job-cost-fixtures.json'

type Fixture = {
  name: string
  job: { material_cost: number | null; labor_cost: number | null; dealer_fee_amount: number | null }
  orders: Array<{ amount: number | null; status: string | null }>
  lines: Array<{ amount: number | null; cost_type: string | null; approved: boolean | null; description: string | null }>
  expected: ReturnType<typeof summarizeJobCosts>
}

describe('job-cost SQL parity fixtures (TS side)', () => {
  it.each((fixtures as Fixture[]).map((f) => [f.name, f] as const))('%s', (_name, f) => {
    const result = summarizeJobCosts({
      materialCostColumn: f.job.material_cost,
      laborCostColumn: f.job.labor_cost,
      dealerFeeAmount: f.job.dealer_fee_amount,
      ordersTotal: netProductOrdersTotal(f.orders),
      lines: f.lines,
    })
    expect(result).toEqual(f.expected)
  })
})
