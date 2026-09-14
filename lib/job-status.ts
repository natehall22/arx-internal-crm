/**
 * Production job lifecycle status — the one definition.
 *
 * Mirrors the `production_jobs_status_check` CHECK constraint. Before this there
 * were five copies of the union (three of them missing `on_hold`) and four
 * copies of the job → project status mapping, each of which would have shown a
 * cancelled job as "In progress".
 */
export const JOB_STATUSES = [
  'sold',
  'materials',
  'scheduled',
  'in_progress',
  'complete',
  'collected',
  'on_hold',
  'cancelled',
] as const

export type JobStatus = (typeof JOB_STATUSES)[number]

/**
 * A sold job that will never be installed. Written only by
 * `POST /api/ops/jobs/[id]/cancel` (the `cancel_production_job` function), which
 * also voids the sale agreement so it stops counting as a sale everywhere.
 *
 * Any query over `production_jobs` that means "sales" or "work ops has to do"
 * and does not already allowlist statuses must exclude this.
 */
export const CANCELLED_JOB_STATUS = 'cancelled' satisfies JobStatus

/**
 * Why a job was cancelled. Required to cancel, so cancels can be tracked — and
 * credit fails worked again later. Keep in sync with
 * `production_jobs_cancellation_reason_check`.
 */
export const JOB_CANCELLATION_REASONS = {
  credit_fail: 'Credit / financing declined',
  customer_backed_out: 'Customer backed out',
  insurance_denied: 'Insurance claim denied',
  other: 'Other',
} as const

export type JobCancellationReason = keyof typeof JOB_CANCELLATION_REASONS

export function isJobCancellationReason(value: unknown): value is JobCancellationReason {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(JOB_CANCELLATION_REASONS, value)
}

export function jobCancellationReasonLabel(value: string | null | undefined): string {
  return isJobCancellationReason(value) ? JOB_CANCELLATION_REASONS[value] : 'No reason recorded'
}

export type ProjectStatusFromJob = 'in_progress' | 'on_hold' | 'complete' | 'collected' | 'cancelled'

/** The `projects.status` value a job's status implies (the job is the source of truth). */
export function projectStatusForJobStatus(jobStatus: string): ProjectStatusFromJob {
  if (jobStatus === 'collected') return 'collected'
  if (jobStatus === 'complete') return 'complete'
  if (jobStatus === 'on_hold') return 'on_hold'
  if (jobStatus === 'cancelled') return 'cancelled'
  return 'in_progress'
}

/** Lower-case display form of {@link projectStatusForJobStatus} ("on hold"); callers capitalize via CSS. */
export function projectStatusLabelForJobStatus(jobStatus: string): string {
  return projectStatusForJobStatus(jobStatus).replace(/_/g, ' ')
}

/* ------------------------------------------------------------------------ *
 * Display + board helpers
 * ------------------------------------------------------------------------ */

/**
 * The one place a production job status gets its label and colors.
 * `pillClass` is for small badges; `panelClass` is for tinted board columns/strips.
 */
export const JOB_STATUS_CONFIG: Record<
  JobStatus,
  { label: string; color: string; pillClass: string; panelClass: string }
> = {
  sold: { label: 'Sold', color: 'text-blue-700', pillClass: 'bg-blue-100', panelClass: 'bg-blue-50 border-blue-200' },
  materials: { label: 'Material Ordering', color: 'text-amber-700', pillClass: 'bg-amber-100', panelClass: 'bg-amber-50 border-amber-200' },
  scheduled: { label: 'Scheduled', color: 'text-purple-700', pillClass: 'bg-purple-100', panelClass: 'bg-purple-50 border-purple-200' },
  in_progress: { label: 'In Progress', color: 'text-indigo-700', pillClass: 'bg-indigo-100', panelClass: 'bg-indigo-50 border-indigo-200' },
  complete: { label: 'Completed', color: 'text-green-700', pillClass: 'bg-green-100', panelClass: 'bg-green-50 border-green-200' },
  collected: { label: 'Collected', color: 'text-gray-700', pillClass: 'bg-gray-100', panelClass: 'bg-gray-50 border-gray-200' },
  on_hold: { label: 'On Hold', color: 'text-orange-700', pillClass: 'bg-orange-100', panelClass: 'bg-orange-50 border-orange-200' },
  cancelled: { label: 'Cancelled', color: 'text-rose-800', pillClass: 'bg-rose-100', panelClass: 'bg-rose-50 border-rose-200' },
}

/** Unknown/legacy status strings render as themselves in gray — never crash, never mislabel. */
export function jobStatusConfig(status: string | null | undefined) {
  return (
    JOB_STATUS_CONFIG[status as JobStatus] ?? {
      ...JOB_STATUS_CONFIG.collected,
      label: status ? status.replace(/_/g, ' ') : 'Unknown',
    }
  )
}

/** Install date has passed and the job is still open. A paused job is never "overdue". */
export function isJobPastDue(job: { scheduled_date: string | null; status: string }): boolean {
  return (
    !!job.scheduled_date &&
    new Date(job.scheduled_date + 'T23:59:59') < new Date() &&
    job.status !== 'complete' &&
    job.status !== 'collected' &&
    job.status !== 'on_hold' &&
    job.status !== 'cancelled'
  )
}

/**
 * Where a paused job goes when it's resumed. The status before the pause isn't stored,
 * so it's inferred from how far the job actually got: started → In Progress,
 * install date → Scheduled, materials ordered → Material Ordering, otherwise Sold.
 */
export function resumeStatusForJob(
  job: { started_at?: string | null; scheduled_date: string | null; materials_status: string | null }
): Exclude<JobStatus, 'on_hold' | 'complete' | 'collected' | 'cancelled'> {
  if (job.started_at) return 'in_progress'
  if (job.scheduled_date) return 'scheduled'
  if (job.materials_status && job.materials_status !== 'not_ordered') return 'materials'
  return 'sold'
}

export function paymentStatusChip(
  job: { sale_amount: number | null; collected_cents?: number | null }
): { label: string; className: string } | null {
  const saleCents = Math.round((job.sale_amount || 0) * 100)
  if (saleCents <= 0) return null
  const collected = job.collected_cents ?? 0
  if (collected >= saleCents) {
    return { label: 'Paid in full', className: 'bg-emerald-50 text-emerald-800 border border-emerald-200' }
  }
  if (collected > 0) {
    return { label: 'Partially paid', className: 'bg-amber-50 text-amber-800 border border-amber-200' }
  }
  return { label: 'Unpaid', className: 'bg-gray-50 text-gray-700 border border-gray-200' }
}
