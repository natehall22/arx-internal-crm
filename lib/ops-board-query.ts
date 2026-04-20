/**
 * Columns for /ops board + GET /api/ops/jobs — excludes photo arrays and other large blobs on production_jobs.
 */
export const OPS_BOARD_JOB_COLUMNS = `
  id,
  org_id,
  project_id,
  customer_id,
  job_number,
  status,
  job_type,
  address_text,
  sale_amount,
  sale_date,
  salesperson_id,
  materials_status,
  materials_ordered_at,
  scheduled_date,
  scheduled_time_start,
  estimated_duration_hours,
  assigned_crew_id,
  assigned_sub_id,
  permit_status,
  started_at,
  completed_at,
  labor_cost,
  material_cost,
  dealer_fee_amount,
  priority,
  payroll_sent_at,
  created_at,
  updated_at
`

/** Nested project fields for handoff preview + OperationsSnapshotCard modal. */
export const OPS_BOARD_PROJECT_COLUMNS = `
  id,
  scope_of_work,
  product_summary,
  ops_notes,
  permits_status,
  install_date,
  project_review,
  customers(id, name, phone),
  leads(id, homeowner_name, phone)
`

/** Full `.select()` body for ops board list queries (production_jobs + joins). */
export function opsBoardJobsSelectEmbedded(): string {
  return `
    ${OPS_BOARD_JOB_COLUMNS.trim().replace(/\s+/g, ' ')},
    assigned_crew:crews(id, name, color),
    assigned_sub:sub_contractors(id, company_name),
    customer:customers(id, name, phone),
    salesperson:users!production_jobs_salesperson_id_fkey(id, full_name),
    project:projects(${OPS_BOARD_PROJECT_COLUMNS.trim().replace(/\s+/g, ' ')})
  `.trim()
}
