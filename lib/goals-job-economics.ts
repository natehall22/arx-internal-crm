import { buildCommissionPayrollSnapshot } from '@/lib/commission-payroll'
import { roundMoney } from '@/lib/money'
import { netProductOrdersTotal, summarizeJobCosts, type JobCostLineInput, type JobProductOrderInput } from '@/lib/job-costs'

export type JobEconomicsRow = {
  id: string
  sale_amount: number | string | null
  sale_date: string | null
  created_at: string
  labor_cost: number | string | null
  material_cost: number | string | null
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

function hasMoney(value: number | string | null | undefined): boolean {
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value === 'string') return value.trim() !== '' && Number.isFinite(Number(value))
  return false
}

function jobHasCostData(job: JobEconomicsRow, costLines: JobCostLineInput[], orders: JobProductOrderInput[]): boolean {
  if (hasMoney(job.labor_cost) || hasMoney(job.material_cost) || orders.length > 0) return true
  return costLines.some((line) => money(line.amount) > 0)
}

/** All job costs including the lender/dealer fee, which the books treat as an expense. */
function jobTotalCosts(
  job: JobEconomicsRow,
  costLines: JobCostLineInput[],
  orders: JobProductOrderInput[]
): number {
  return summarizeJobCosts({
    materialCostColumn: job.material_cost,
    laborCostColumn: job.labor_cost,
    dealerFeeAmount: job.dealer_fee_amount,
    ordersTotal: netProductOrdersTotal(orders),
    lines: costLines,
  }).total
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
  costLinesByJob: Map<string, JobCostLineInput[]>,
  ordersByJob: Map<string, JobProductOrderInput[]> = new Map()
): JobEconomicsSummary {
  let totalSale = 0
  let totalCosts = 0
  let totalCommissions = 0
  let jobsMissingCostData = 0

  for (const job of jobs) {
    const sale = money(job.sale_amount)
    const lines = costLinesByJob.get(job.id) || []
    const orders = ordersByJob.get(job.id) || []
    if (!jobHasCostData(job, lines, orders)) jobsMissingCostData += 1

    const direct = jobTotalCosts(job, lines, orders)
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
