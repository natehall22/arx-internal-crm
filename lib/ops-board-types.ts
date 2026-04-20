export type JobStatus = 'sold' | 'materials' | 'scheduled' | 'in_progress' | 'complete' | 'collected'

/** Shape used by /ops board + list (subset of production_jobs + joins). */
export interface OpsBoardJob {
  id: string
  project_id: string
  job_number: string
  status: JobStatus
  job_type: string
  address_text: string
  sale_amount: number | null
  dealer_fee_amount?: number | null
  labor_cost?: number | null
  material_cost?: number | null
  sale_date: string | null
  scheduled_date: string | null
  materials_status: string
  permit_status: string
  priority: string
  assigned_crew?: { id: string; name: string; color: string } | null
  assigned_sub?: { id: string; company_name: string } | null
  customer?: { id: string; name: string; phone: string } | null
  salesperson?: { id: string; full_name: string } | null
  project?: {
    id: string
    scope_of_work: string | null
    product_summary: string | null
    ops_notes?: string | null
    permits_status?: string | null
    install_date?: string | null
    project_review?: unknown
    customers?: unknown
    leads?: unknown
  } | null
  collected_cents?: number
  /** When set, ops marked this job as sent to payroll */
  payroll_sent_at?: string | null
}
