/**
 * Job ledger — one row per job with revenue, cost, sales comp, OPP, gross profit, owner draw, allocated
 * overhead and net profit. Note `grossProfit` here is AFTER sales comp and OPP; the proposed `rpt_job` SQL view
 * (supabase/proposed/) only has `gross_profit_before_comp` — compare like with like.
 *
 * Apart from OPP and owner draw (below, both mirroring the profit tracker / Google sheet), it adds NO new money math: costs come from `summarizeJobCosts` (lib/job-costs.ts), sales comp and
 * gross profit from `summarizeJobEconomics` (lib/goals-job-economics.ts — the same numbers the Goals
 * page shows), overhead from `allocateOverhead`. If any of those change, this follows automatically.
 *
 * Not wired into any page yet (see lib/reporting/README.md).
 */
import { roundMoney } from '@/lib/money'
import { EASTERN_TZ } from '@/lib/eastern-datetime'
import {
  netProductOrdersTotal,
  summarizeJobCosts,
  type JobCostLineInput,
  type JobCostSummary,
  type JobProductOrderInput,
} from '@/lib/job-costs'
import { summarizeJobEconomics, type JobEconomicsRow } from '@/lib/goals-job-economics'
import { allocateOverhead, completionMonthKey } from '@/lib/reporting/overhead-allocation'

/**
 * OPP (Steve + Andrew, owner operating pay) is a JOB COST (Nathan, Oct 9 2026): 9% of the sale amount,
 * the same base `/admin/job-profit-tracker` uses today. CLAUDE.md describes it as "9% of commissionable"
 * — the two differ only on financed jobs; confirm before wiring. This is the single home for the rate;
 * the profit tracker's inline `saleAmount * 0.09` should import it when that page moves to the ledger.
 */
export const OPP_RATE = 0.09

export function oppCost(saleAmount: number): number {
  return roundMoney(Math.max(0, saleAmount) * OPP_RATE)
}

/**
 * Owner draw — 20% of gross profit, split four ways (Nathan, Oct 9 2026: "net cash" is what's left after
 * everyone has been paid, including the 4-way owners draw, as the ARX Google tracker sheet does).
 * The 4-way split is the sheet's convention, not today's ownership (3 owners at 33.33%); change
 * OWNER_DRAW_SPLIT only when the sheet changes.
 * Mirrors `/admin/job-profit-tracker`: ownerDraw = grossProfit × 0.2, per owner = ownerDraw ÷ 4,
 * netProfit = grossProfit − ownerDraw (the ledger also subtracts allocated overhead once it exists).
 * Like the sheet, a losing job carries a negative draw.
 */
export const OWNER_DRAW_RATE = 0.2
export const OWNER_DRAW_SPLIT = 4

export type LedgerJobInput = JobEconomicsRow & {
  completed_at: string | null
  assigned_sub_id?: string | null
  salesperson_id?: string | null
  job_number?: string | null
  /** Roof squares installed/sold, when known — enables $/square on the sub scorecard. */
  squares?: number | string | null
}

export type JobLedgerRow = {
  id: string
  jobNumber: string | null
  subId: string | null
  salespersonId: string | null
  completedMonth: string | null
  squares: number | null
  revenue: number
  costs: JobCostSummary
  /** Sales comp as Goals estimates it today (commission pool cap from the payroll snapshot). */
  salesComp: number
  /** OPP 9% — a job cost. */
  opp: number
  /** revenue − costs.total − salesComp − opp */
  grossProfit: number
  /** OWNER_DRAW_RATE × grossProfit */
  ownerDraw: number
  /** ownerDraw ÷ OWNER_DRAW_SPLIT */
  ownerDrawPerOwner: number
  /** null when the job is not complete (overhead is only carried by completed jobs). */
  allocatedOverhead: number | null
  /** grossProfit − allocatedOverhead (before owner draw) — what the business earned; null until complete. */
  operatingProfit: number | null
  /** What's left after everyone is paid: grossProfit − ownerDraw − allocatedOverhead; null until complete. */
  netProfit: number | null
  missingCostData: boolean
}

function toNumberOrNull(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export function buildJobLedger(
  jobs: LedgerJobInput[],
  costLinesByJob: Map<string, JobCostLineInput[]>,
  ordersByJob: Map<string, JobProductOrderInput[]> = new Map(),
  overheadByMonth: Record<string, number> | Map<string, number> = {},
  timeZone: string = EASTERN_TZ
): JobLedgerRow[] {
  const overhead = allocateOverhead(jobs, overheadByMonth, timeZone)

  return jobs.map((job) => {
    const lines = costLinesByJob.get(job.id) || []
    const orders = ordersByJob.get(job.id) || []
    const costs = summarizeJobCosts({
      materialCostColumn: job.material_cost,
      laborCostColumn: job.labor_cost,
      dealerFeeAmount: job.dealer_fee_amount,
      ordersTotal: netProductOrdersTotal(orders),
      lines,
    })
    const econ = summarizeJobEconomics([job], new Map([[job.id, lines]]), new Map([[job.id, orders]]))
    const opp = oppCost(econ.totalSale)
    const grossProfit = roundMoney(econ.netProfit - opp)
    const ownerDraw = roundMoney(grossProfit * OWNER_DRAW_RATE)
    const allocated = job.completed_at ? overhead.byJob.get(job.id) ?? 0 : null

    return {
      id: job.id,
      jobNumber: job.job_number ?? null,
      subId: job.assigned_sub_id ?? null,
      salespersonId: job.salesperson_id ?? null,
      completedMonth: job.completed_at ? completionMonthKey(job.completed_at, timeZone) : null,
      squares: toNumberOrNull(job.squares),
      revenue: econ.totalSale,
      costs,
      salesComp: econ.totalCommissions,
      opp,
      grossProfit,
      ownerDraw,
      ownerDrawPerOwner: roundMoney(ownerDraw / OWNER_DRAW_SPLIT),
      allocatedOverhead: allocated,
      operatingProfit: allocated == null ? null : roundMoney(grossProfit - allocated),
      netProfit: allocated == null ? null : roundMoney(grossProfit - ownerDraw - allocated),
      // A job whose only cost is legacy product orders still has cost data.
      missingCostData: econ.jobsMissingCostData > 0 && netProductOrdersTotal(orders) == null,
    }
  })
}
