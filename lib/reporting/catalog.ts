/**
 * What can be reported on. Every dataset is a SQL view (supabase/migrations/202610220010_reporting_views.sql) —
 * the view is where a metric is DEFINED; this file only names it for people and says who may see it.
 * Plain names for the owner, not table names.
 */
export type ColumnType = 'text' | 'number' | 'money' | 'date' | 'bool'

export type DatasetColumn = {
  key: string
  label: string
  type: ColumnType
  /** Margin / pay / cost: finance roles only. Hidden from everyone else, in rows, filters, grouping and exports. */
  sensitive?: boolean
}

export type Dataset = {
  key: DatasetKey
  label: string
  description: string
  view: string
  columns: DatasetColumn[]
  /** Date used by the date-range filter and by "by month/week" grouping. */
  dateColumn: string
  /** Column holding the user a row "belongs to"; used to scope own/team/region viewers. null = company-level data. */
  ownerColumn: string | null
  /** Unique id column; keeps paging stable. */
  idColumn: string
  /** Whole dataset is finance-only (pay, costs). */
  financeOnly?: boolean
}

export const DATASET_KEYS = [
  'jobs', 'sales', 'payments', 'job_costs', 'payroll_lines', 'canvass_doors', 'appointments', 'leads',
  'opportunities', 'referral_partners', 'inspection_sets', 'sits',
] as const
export type DatasetKey = (typeof DATASET_KEYS)[number]

const c = (key: string, label: string, type: ColumnType = 'text', sensitive = false): DatasetColumn => ({ key, label, type, ...(sensitive ? { sensitive } : {}) })

export const DATASETS: Record<DatasetKey, Dataset> = {
  jobs: {
    idColumn: 'job_id', key: 'jobs', label: 'Jobs', description: 'Every sold job with its cost, money collected and profit.',
    view: 'rpt_jobs', dateColumn: 'sale_date', ownerColumn: 'salesperson_id',
    columns: [
      c('job_number', 'Job #'), c('status', 'Status'), c('job_type', 'Job type'), c('address', 'Address'),
      c('job_source', 'Lead source'), c('sale_date', 'Sale date', 'date'), c('completed_at', 'Completed', 'date'),
      c('scheduled_date', 'Install date', 'date'), c('materials_status', 'Materials'), c('permit_status', 'Permit'),
      c('salesperson', 'Salesperson'), c('sale_amount', 'Sale amount', 'money'), c('collected', 'Collected', 'money'),
      c('balance_due', 'Balance due', 'money'), c('aging_bucket', 'How old (unpaid)'), c('days_since_sale', 'Days since sale', 'number'),
      c('dealer_fee', 'Lender fee', 'money', true), c('cost_total', 'Total cost', 'money', true),
      c('profit_before_commission', 'Profit before commission', 'money', true),
    ],
  },
  sales: {
    idColumn: 'contract_id', key: 'sales', label: 'Sales', description: 'Signed sale agreements, credited to the closer and setter.',
    view: 'rpt_sales', dateColumn: 'signed_at', ownerColumn: 'closer_user_id',
    columns: [
      c('signed_at', 'Signed', 'date'), c('address', 'Address'), c('amount', 'Sale amount', 'money'), c('agreement_type', 'Type'),
      c('payment_method', 'Payment method'), c('closer', 'Closer'), c('setter', 'Setter'), c('job_source', 'Lead source'),
      c('is_self_generated', 'Self-generated', 'bool'),
    ],
  },
  payments: {
    idColumn: 'payment_id', key: 'payments', label: 'Payments', description: 'Money received on jobs.',
    view: 'rpt_payments', dateColumn: 'paid_at', ownerColumn: null,
    columns: [
      c('job_number', 'Job #'), c('paid_at', 'Paid', 'date'), c('amount', 'Amount', 'money'), c('payment_type', 'Type'),
      c('method', 'Method'), c('funding_status', 'Funding'),
    ],
  },
  job_costs: {
    idColumn: 'cost_line_id', key: 'job_costs', label: 'Job costs', description: 'Every cost line on every job.',
    view: 'rpt_job_costs', dateColumn: 'incurred_on', ownerColumn: null, financeOnly: true,
    columns: [
      c('job_number', 'Job #'), c('description', 'Description'), c('cost_type', 'Cost type'), c('amount', 'Amount', 'money'),
      c('incurred_on', 'Date', 'date'), c('vendor', 'Vendor'), c('approved', 'Approved', 'bool'), c('source', 'Entered how'),
    ],
  },
  payroll_lines: {
    idColumn: 'payout_line_id', key: 'payroll_lines', label: 'Payroll lines', description: 'What each person is paid on each job.',
    view: 'rpt_payroll_lines', dateColumn: 'scheduled_pay_date', ownerColumn: null, financeOnly: true,
    columns: [
      c('period_label', 'Pay period'), c('period_status', 'Period status'), c('scheduled_pay_date', 'Pay date', 'date'),
      c('person', 'Person'), c('participant_role', 'Role on the job'), c('job_number', 'Job #'),
      c('gross_amount', 'Gross', 'money'), c('net_amount', 'Net', 'money'),
    ],
  },
  canvass_doors: {
    idColumn: 'knock_id', key: 'canvass_doors', label: 'Canvass doors', description: 'Every door knocked.',
    view: 'rpt_canvass_doors', dateColumn: 'knocked_at', ownerColumn: 'user_id',
    columns: [c('knocked_at', 'Knocked', 'date'), c('rep', 'Rep'), c('disposition', 'Result'), c('source', 'Source')],
  },
  appointments: {
    idColumn: 'appointment_id', key: 'appointments', label: 'Appointments', description: 'Inspections and other appointments.',
    view: 'rpt_appointments', dateColumn: 'scheduled_for', ownerColumn: 'closer_user_id',
    columns: [
      c('scheduled_for', 'When', 'date'), c('appointment_type', 'Type'), c('status', 'Status'), c('closer', 'Closer'),
      c('setter', 'Setter'), c('was_completed', 'Completed', 'bool'), c('was_cancelled', 'Cancelled', 'bool'),
    ],
  },
  leads: {
    idColumn: 'lead_id', key: 'leads', label: 'Leads', description: 'Leads and pins (bulk solar import excluded).',
    view: 'rpt_leads', dateColumn: 'created_at', ownerColumn: 'owner_user_id',
    columns: [c('created_at', 'Created', 'date'), c('status', 'Status'), c('source', 'Source'), c('canvass_disposition', 'Door result'), c('owner', 'Owner')],
  },
  opportunities: {
    idColumn: 'opportunity_id', key: 'opportunities', label: 'Opportunities', description: 'Inspected homes in the pipeline, and whether they sold.',
    view: 'rpt_opportunities', dateColumn: 'created_at', ownerColumn: 'closer_user_id',
    columns: [
      c('created_at', 'Created', 'date'), c('status', 'Status'), c('pipeline_stage', 'Stage'), c('inspection_outcome', 'Inspection result'),
      c('job_source', 'Lead source'), c('closer', 'Closer'), c('setter', 'Setter'), c('estimated_value', 'Estimated value', 'money'), c('is_sold', 'Sold', 'bool'),
    ],
  },
  inspection_sets: {
    idColumn: 'appointment_id', key: 'inspection_sets', label: 'Inspections set', description: 'Inspections booked (not cancelled) — the count the dashboard and goals use.',
    view: 'rpt_inspection_sets', dateColumn: 'set_at', ownerColumn: 'setter_user_id',
    columns: [c('set_at', 'Booked', 'date'), c('scheduled_for', 'Inspection date', 'date'), c('setter', 'Setter'), c('closer', 'Closer')],
  },
  sits: {
    idColumn: 'opportunity_id', key: 'sits', label: 'Sits', description: 'Inspections that happened (latest outcome counts as a sit) — the count the dashboard and goals use.',
    view: 'rpt_sits', dateColumn: 'sat_at', ownerColumn: 'closer_user_id',
    columns: [c('sat_at', 'Sat', 'date'), c('outcome', 'Result'), c('closer', 'Closer'), c('setter', 'Setter')],
  },
  referral_partners: {
    idColumn: 'partner_id', key: 'referral_partners', label: 'Referral partners', description: 'Partners, who owns them, and what they referred.',
    view: 'rpt_referral_partners', dateColumn: 'assigned_at', ownerColumn: 'owner_user_id',
    columns: [
      c('name', 'Partner'), c('company', 'Company'), c('status', 'Status'), c('owner', 'Owner'), c('assigned_at', 'Assigned', 'date'),
      c('last_touched_at', 'Last touched', 'date'), c('referred_opportunities', 'Referrals', 'number'),
    ],
  },
}

export function columnOf(dataset: Dataset, key: string): DatasetColumn | undefined {
  return dataset.columns.find((col) => col.key === key)
}
