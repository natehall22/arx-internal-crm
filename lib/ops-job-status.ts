import type { JobStatus, OpsBoardJob } from '@/lib/ops-board-types'

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
export function isJobPastDue(job: Pick<OpsBoardJob, 'scheduled_date' | 'status'>): boolean {
  return (
    !!job.scheduled_date &&
    new Date(job.scheduled_date + 'T23:59:59') < new Date() &&
    job.status !== 'complete' &&
    job.status !== 'collected' &&
    job.status !== 'on_hold'
  )
}

/**
 * Where a paused job goes when it's resumed. The status before the pause isn't stored,
 * so it's inferred from how far the job actually got: started → In Progress,
 * install date → Scheduled, materials ordered → Material Ordering, otherwise Sold.
 */
export function resumeStatusForJob(
  job: Pick<OpsBoardJob, 'started_at' | 'scheduled_date' | 'materials_status'>
): Exclude<JobStatus, 'on_hold' | 'complete' | 'collected'> {
  if (job.started_at) return 'in_progress'
  if (job.scheduled_date) return 'scheduled'
  if (job.materials_status && job.materials_status !== 'not_ordered') return 'materials'
  return 'sold'
}

export function paymentStatusChip(
  job: Pick<OpsBoardJob, 'sale_amount' | 'collected_cents'>
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
