import { DATASETS, columnOf, type DatasetKey } from '@/lib/reporting/catalog'
import type { ReportSpec } from '@/lib/reporting/report-spec'

export type ReportTemplate = {
  key: string
  title: string
  group: 'Sales' | 'Money' | 'Field' | 'Pipeline' | 'Payroll' | 'Jobs'
  blurb: string
  chart: 'bar' | 'line' | 'none'
  /** Finance-only: needs cost, margin or pay. Hidden from everyone else. */
  finance?: boolean
  spec: ReportSpec
}

const base = (dataset: DatasetKey, over: Partial<ReportSpec>): ReportSpec => ({
  dataset, mode: 'summary', groupBy: null, metric: { kind: 'count' }, date: { preset: '90d' }, filters: [], sortDesc: true, ...over,
})

/** True when the spec reads a finance-only dataset or any sensitive (money / cost / margin / pay) column. */
export function specTouchesFinancials(spec: ReportSpec): boolean {
  const ds = DATASETS[spec.dataset]
  if (ds.financeOnly) return true
  const used = [
    spec.groupBy && !spec.groupBy.startsWith('@') ? spec.groupBy : null,
    'column' in spec.metric ? spec.metric.column : null,
    spec.sortBy ?? null,
    ...spec.filters.map((f) => f.column),
  ].filter(Boolean) as string[]
  return used.some((k) => columnOf(ds, k)?.sensitive)
}

const RAW_TEMPLATES: ReportTemplate[] = [
  { key: 'sales-by-closer', title: 'Sales by closer', group: 'Sales', blurb: 'Signed sales per closer.', chart: 'bar',
    spec: base('sales', { groupBy: 'closer', metric: { kind: 'sum', column: 'amount' } }) },
  { key: 'sales-by-setter', title: 'Sales by setter', group: 'Sales', blurb: 'Signed sales per setter.', chart: 'bar',
    spec: base('sales', { groupBy: 'setter', metric: { kind: 'sum', column: 'amount' } }) },
  { key: 'sales-by-month', title: 'Sales by month', group: 'Sales', blurb: 'Signed sales over time.', chart: 'line',
    spec: base('sales', { groupBy: '@month', metric: { kind: 'sum', column: 'amount' }, date: { preset: 'ytd' }, sortDesc: false }) },
  { key: 'sales-by-source', title: 'Sales by lead source', group: 'Sales', blurb: 'Where sold jobs came from.', chart: 'bar',
    spec: base('sales', { groupBy: 'job_source', metric: { kind: 'sum', column: 'amount' } }) },
  { key: 'self-gen-sales', title: 'Self-generated vs set sales', group: 'Sales', blurb: 'Sales the closer found themself vs got from a setter.', chart: 'bar',
    spec: base('sales', { groupBy: 'is_self_generated', metric: { kind: 'sum', column: 'amount' } }) },
  { key: 'sold-rate-by-closer', title: 'Sold % by closer', group: 'Pipeline', blurb: 'Share of inspected homes that sold, per closer.', chart: 'bar',
    spec: base('opportunities', { groupBy: 'closer', metric: { kind: 'rate', column: 'is_sold' } }) },
  { key: 'sold-rate-by-setter', title: 'Close rate by setter', group: 'Pipeline', blurb: 'Share of a setter’s inspected homes that sold.', chart: 'bar',
    spec: base('opportunities', { groupBy: 'setter', metric: { kind: 'rate', column: 'is_sold' } }) },
  { key: 'pipeline-by-stage', title: 'Pipeline by stage', group: 'Pipeline', blurb: 'Opportunities in each stage.', chart: 'bar',
    spec: base('opportunities', { groupBy: 'pipeline_stage', date: { preset: 'all' } }) },
  { key: 'sits-by-closer', title: 'Sits by closer', group: 'Field', blurb: 'Inspections that happened, per closer (same count as the dashboard).', chart: 'bar',
    spec: base('sits', { groupBy: 'closer' }) },
  { key: 'sets-by-setter', title: 'Inspections set by setter', group: 'Field', blurb: 'Inspections booked, per setter (same count as the dashboard).', chart: 'bar',
    spec: base('inspection_sets', { groupBy: 'setter' }) },
  { key: 'completed-rate-by-closer', title: 'Appointments completed % by closer', group: 'Field', blurb: 'Share of appointments marked completed (cancelled ones left out). Not the goals-scorecard sit count.', chart: 'bar',
    spec: base('appointments', { groupBy: 'closer', metric: { kind: 'rate', column: 'was_completed' }, filters: [{ column: 'was_cancelled', op: 'is_false' }] }) },
  { key: 'appointments-by-type', title: 'Appointments by type', group: 'Field', blurb: 'What kinds of appointments are being run.', chart: 'bar',
    spec: base('appointments', { groupBy: 'appointment_type' }) },
  { key: 'doors-by-rep', title: 'Doors knocked by rep', group: 'Field', blurb: 'Doors per canvasser.', chart: 'bar',
    spec: base('canvass_doors', { groupBy: 'rep', date: { preset: '7d' } }) },
  { key: 'doors-by-result', title: 'Door results', group: 'Field', blurb: 'What happened at the door.', chart: 'bar',
    spec: base('canvass_doors', { groupBy: 'disposition', date: { preset: '30d' } }) },
  { key: 'doors-by-week', title: 'Doors by week', group: 'Field', blurb: 'Door volume over time.', chart: 'line',
    spec: base('canvass_doors', { groupBy: '@week', sortDesc: false }) },
  { key: 'leads-by-source', title: 'Leads by source', group: 'Pipeline', blurb: 'Where leads come from.', chart: 'bar',
    spec: base('leads', { groupBy: 'source' }) },
  { key: 'payments-by-month', title: 'Money collected by month', group: 'Money', blurb: 'Payments received (pending ones included).', chart: 'line',
    spec: base('payments', { groupBy: '@month', metric: { kind: 'sum', column: 'amount' }, date: { preset: 'ytd' }, sortDesc: false }) },
  { key: 'ar-aging', title: 'Money owed (aging)', group: 'Money', blurb: 'Unpaid balance on sold jobs by how old the sale is.', chart: 'bar',
    spec: base('jobs', { groupBy: 'aging_bucket', metric: { kind: 'sum', column: 'balance_due' }, date: { preset: 'all' }, filters: [{ column: 'balance_due', op: 'gt', value: 0 }] }) },
  { key: 'jobs-by-status', title: 'Jobs by status', group: 'Jobs', blurb: 'Where every job stands.', chart: 'bar',
    spec: base('jobs', { groupBy: 'status', date: { preset: 'all' } }) },
  { key: 'materials-status', title: 'Materials ordered vs not', group: 'Jobs', blurb: 'Jobs by materials status.', chart: 'bar',
    spec: base('jobs', { groupBy: 'materials_status', date: { preset: 'all' }, filters: [{ column: 'status', op: 'neq', value: 'cancelled' }] }) },
  { key: 'profit-by-job', title: 'Profit by job', group: 'Money', blurb: 'Profit before commission, job by job.', chart: 'bar', finance: true,
    spec: base('jobs', { groupBy: 'job_number', metric: { kind: 'sum', column: 'profit_before_commission' }, date: { preset: '90d' } }) },
  { key: 'profit-by-month', title: 'Profit by month', group: 'Money', blurb: 'Profit before commission over time.', chart: 'line', finance: true,
    spec: base('jobs', { groupBy: '@month', metric: { kind: 'sum', column: 'profit_before_commission' }, date: { preset: 'ytd' }, sortDesc: false }) },
  { key: 'cost-overruns', title: 'Costliest jobs', group: 'Money', blurb: 'Jobs with the highest total cost — spot overruns.', chart: 'none', finance: true,
    spec: base('jobs', { mode: 'rows', sortBy: 'cost_total', date: { preset: '90d' }, limit: 50 }) },
  { key: 'costs-by-type', title: 'Costs by type', group: 'Money', blurb: 'Materials, labor and other costs.', chart: 'bar', finance: true,
    spec: base('job_costs', { groupBy: 'cost_type', metric: { kind: 'sum', column: 'amount' }, date: { preset: '90d' } }) },
  { key: 'payroll-by-week', title: 'Payroll by pay date', group: 'Payroll', blurb: 'Gross pay per pay period.', chart: 'bar', finance: true,
    spec: base('payroll_lines', { groupBy: 'period_label', metric: { kind: 'sum', column: 'gross_amount' }, date: { preset: 'all' } }) },
  { key: 'payroll-by-person', title: 'Pay by person', group: 'Payroll', blurb: 'Gross pay per person.', chart: 'bar', finance: true,
    spec: base('payroll_lines', { groupBy: 'person', metric: { kind: 'sum', column: 'gross_amount' }, date: { preset: 'all' } }) },
  { key: 'referrals-by-partner', title: 'Referrals by partner', group: 'Pipeline', blurb: 'Opportunities each referral partner sent.', chart: 'bar',
    spec: base('referral_partners', { groupBy: 'name', metric: { kind: 'sum', column: 'referred_opportunities' }, date: { preset: 'all' } }) },
]

/** The `finance` flag is DERIVED from what the template reads, so a new template can never forget it. */
export const REPORT_TEMPLATES: ReportTemplate[] = RAW_TEMPLATES.map((t) => ({ ...t, finance: t.finance || specTouchesFinancials(t.spec) }))

export function templateByKey(key: string): ReportTemplate | undefined {
  return REPORT_TEMPLATES.find((t) => t.key === key)
}
