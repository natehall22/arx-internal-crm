import { buildCommissionPayrollSnapshot } from '@/lib/commission-payroll'
import { roundMoney } from '@/lib/money'
import { EMPTY_JOB_COST_SUMMARY, jobDirectCost, type JobCostSummary } from '@/lib/job-cost-ledger'

export type JobEconomicsRow = {
  id: string
  sale_amount: number | string | null
  sale_date: string | null
  created_at: string
  dealer_fee_amount?: number | string | null
  commission_comp_base?: number | string | null
  commission_pre_tax_subtotal?: number | string | null
}

export type JobEconomicsSummary = {
  totalSale: number
  totalCosts: number
  totalCommissions: number
  netProfit: number
  jobsInMonth: number
  jobsMissingCostData: number
}

function money(value: number | string | null | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

/**
 * Direct cost = the job cost ledger + the financing dealer fee, once (lib/job-cost-ledger.ts).
 * Before 2026-10-21 this preferred the stale production_jobs.material_cost / labor_cost columns
 * and then added misc cost lines on top, which double-counted 26-0041 and 26-0013.
 */
function jobDirectCosts(job: JobEconomicsRow, costs: JobCostSummary): number {
  return jobDirectCost(costs, job.dealer_fee_amount)
}

function jobCommissions(job: JobEconomicsRow): number {
  const snapshot = buildCommissionPayrollSnapshot({
    commission_comp_base: money(job.commission_comp_base) || null,
    commission_pre_tax_subtotal: money(job.commission_pre_tax_subtotal) || null,
    sale_amount: money(job.sale_amount) || null,
    dealer_fee_amount: money(job.dealer_fee_amount) || null,
  })
  return snapshot.poolCap ?? 0
}

export function summarizeJobEconomics(
  jobs: JobEconomicsRow[],
  costsByJob: Map<string, JobCostSummary>
): JobEconomicsSummary {
  let totalSale = 0
  let totalCosts = 0
  let totalCommissions = 0
  let jobsMissingCostData = 0

  for (const job of jobs) {
    const sale = money(job.sale_amount)
    const costs = costsByJob.get(job.id) ?? EMPTY_JOB_COST_SUMMARY
    if (costs.lineCount === 0) jobsMissingCostData += 1

    const direct = jobDirectCosts(job, costs)
    const commissions = jobCommissions(job)
    totalSale += sale
    totalCosts += direct + commissions
    totalCommissions += commissions
  }

  return {
    totalSale: roundMoney(totalSale),
    totalCosts: roundMoney(totalCosts),
    totalCommissions: roundMoney(totalCommissions),
    netProfit: roundMoney(totalSale - totalCosts),
    jobsInMonth: jobs.length,
    jobsMissingCostData,
  }
}

export function jobMonthKey(job: JobEconomicsRow): string {
  const raw = job.sale_date || job.created_at
  return raw.slice(0, 7)
}
