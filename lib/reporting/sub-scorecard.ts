/**
 * Sub (crew) scorecard — "which crews are more profitable".
 *
 * v1 is JOB-level: a job is credited to `production_jobs.assigned_sub_id`, which
 * `syncJobScheduleFromTrades` derives from the roofing trade. That answers the question for roofing
 * crews. Gutters/siding/windows crews need trade-level cost (planned `job_cost_lines.work_order_id`,
 * see docs/DATA_ARCHITECTURE_PLAN.md §6) before they can be scored fairly; until then their work is
 * inside the roofing sub's job totals.
 *
 * Only COMPLETED jobs are scored. A job counts toward the money averages only when it has cost data
 * AND a labor figure — a crew's job with materials but no sub invoice yet would otherwise show labor $0
 * and look wildly profitable.
 */
import { roundMoney } from '@/lib/money'
import type { JobLedgerRow } from '@/lib/reporting/job-ledger'

export type SubScorecardRow = {
  subId: string | null
  jobs: number
  jobsWithCosts: number
  revenue: number
  laborCost: number
  grossProfit: number
  /** grossProfit (after sales comp AND OPP 9%) ÷ revenue over costed jobs; null when no costed revenue. */
  grossMarginPct: number | null
  avgGrossProfitPerJob: number | null
  squares: number
  /** labor ÷ squares over costed jobs that have squares; null when none. */
  laborPerSquare: number | null
  /** Sum of operating profit (after overhead, BEFORE owner draw — the draw isn't a crew cost). */
  operatingProfit: number | null
}

/** Has cost data and a real labor figure (stored labor column or labor/sub cost lines > 0). */
export function isCostedForScoring(row: JobLedgerRow): boolean {
  return !row.missingCostData && (row.costs.sources.includes('labor:column') || row.costs.labor > 0)
}

export function buildSubScorecard(rows: JobLedgerRow[]): SubScorecardRow[] {
  const groups = new Map<string | null, JobLedgerRow[]>()
  for (const row of rows) {
    if (row.completedMonth == null) continue
    groups.set(row.subId, [...(groups.get(row.subId) || []), row])
  }

  const out: SubScorecardRow[] = []
  groups.forEach((jobs, subId) => {
    const costed = jobs.filter(isCostedForScoring)
    const revenue = costed.reduce((s, j) => s + j.revenue, 0)
    const grossProfit = costed.reduce((s, j) => s + j.grossProfit, 0)
    const laborCost = costed.reduce((s, j) => s + j.costs.labor, 0)
    const withSquares = costed.filter((j) => j.squares != null && j.squares > 0)
    const squares = withSquares.reduce((s, j) => s + (j.squares || 0), 0)
    const laborOnSquares = withSquares.reduce((s, j) => s + j.costs.labor, 0)
    const withOp = costed.filter((j) => j.operatingProfit != null)

    out.push({
      subId,
      jobs: jobs.length,
      jobsWithCosts: costed.length,
      revenue: roundMoney(revenue),
      laborCost: roundMoney(laborCost),
      grossProfit: roundMoney(grossProfit),
      grossMarginPct: revenue > 0 ? Math.round((grossProfit / revenue) * 1000) / 10 : null,
      avgGrossProfitPerJob: costed.length ? roundMoney(grossProfit / costed.length) : null,
      squares: Math.round(squares * 100) / 100,
      laborPerSquare: squares > 0 ? roundMoney(laborOnSquares / squares) : null,
      operatingProfit: withOp.length ? roundMoney(withOp.reduce((s, j) => s + (j.operatingProfit || 0), 0)) : null,
    })
  })

  // Most profitable first; unassigned (null sub) last.
  return out.sort((a, b) => {
    if (a.subId == null) return 1
    if (b.subId == null) return -1
    const diff = (b.avgGrossProfitPerJob ?? -1e15) - (a.avgGrossProfitPerJob ?? -1e15)
    return diff !== 0 ? diff : String(a.subId).localeCompare(String(b.subId))
  })
}
