import { buildCommissionPayrollSnapshot } from '@/lib/commission-payroll'
import { roundMoney } from '@/lib/money'

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

export type JobCostLineRow = {
  job_id: string
  amount: number | string | null
  cost_type: string | null
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

function jobHasCostData(job: JobEconomicsRow, costLines: JobCostLineRow[]): boolean {
  if (hasMoney(job.labor_cost) || hasMoney(job.material_cost)) return true
  return costLines.some((line) => money(line.amount) > 0)
}

function jobDirectCosts(job: JobEconomicsRow, costLines: JobCostLineRow[]): number {
  const materialFromJob = hasMoney(job.material_cost) ? money(job.material_cost) : null
  const laborFromJob = hasMoney(job.labor_cost) ? money(job.labor_cost) : null

  const materialLines = costLines
    .filter((line) => line.cost_type === 'material')
    .reduce((sum, line) => sum + money(line.amount), 0)
  const laborLines = costLines
    .filter((line) => line.cost_type === 'labor' || line.cost_type === 'subcontractor')
    .reduce((sum, line) => sum + money(line.amount), 0)
  const misc = costLines
    .filter((line) => !['material', 'labor', 'subcontractor'].includes(String(line.cost_type || '')))
    .reduce((sum, line) => sum + money(line.amount), 0)

  const materials = materialFromJob ?? materialLines
  const labor = laborFromJob ?? laborLines
  return roundMoney(materials + labor + misc)
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
  costLinesByJob: Map<string, JobCostLineRow[]>
): JobEconomicsSummary {
  let totalSale = 0
  let totalCosts = 0
  let totalCommissions = 0
  let jobsMissingCostData = 0

  for (const job of jobs) {
    const sale = money(job.sale_amount)
    const lines = costLinesByJob.get(job.id) || []
    if (!jobHasCostData(job, lines)) jobsMissingCostData += 1

    const direct = jobDirectCosts(job, lines)
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
