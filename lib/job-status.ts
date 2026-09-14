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
