/**
 * Where a production job sits on the Sold -> Complete pipeline.
 *
 * Extracted from `app/ops/jobs/[id]/JobDetailClient.tsx` so it can be tested.
 * It shipped with a bug that only showed up by opening the page: the stepper
 * returned the first *incomplete* stage while the UI labelled it "Now:", so it
 * announced the next step as the current state. Since `depositMilestoneMet`
 * returns true for any job whose status is not 'sold', every scheduled job
 * rendered "Now: In Progress" directly under a badge reading "Scheduled" — the
 * page contradicting itself on the two things ops reads first.
 */

export const PIPELINE_STAGES = ['Sold', 'Deposit', 'Scheduled', 'In Progress', 'Complete'] as const

export type PipelineStage = (typeof PIPELINE_STAGES)[number]

/** Only the fields the pipeline actually reads — keeps this usable from anywhere. */
export type JobPipelineInput = {
  status?: string | null
  scheduled_date?: string | null
  started_at?: string | null
  completed_at?: string | null
  sale_amount?: number | null
  deposit?: number | null
  deposit_required_percent?: number | null
}

/**
 * A deposit only gates a job that is still `sold`. Once ops has moved it past
 * that, the milestone is treated as met regardless of what was collected.
 */
export function depositMilestoneMet(job: JobPipelineInput): boolean {
  if (job.status !== 'sold') return true
  const sale = job.sale_amount
  if (!sale || sale <= 0) return true
  const pct = job.deposit_required_percent
  if (pct == null || pct <= 0) return (job.deposit ?? 0) > 0
  const required = sale * (pct / 100)
  return (job.deposit ?? 0) >= required - 0.005
}

/**
 * The stage the job is IN — the furthest one it has actually reached, not the
 * next one it hasn't. Returns an index into {@link PIPELINE_STAGES}.
 */
export function getJobPipelineCurrentIndex(job: JobPipelineInput): number {
  const depositDone = depositMilestoneMet(job)
  const scheduledDone = !!job.scheduled_date
  const startedDone =
    job.status === 'in_progress' ||
    !!job.started_at ||
    job.status === 'complete' ||
    job.status === 'collected'
  const completeDone =
    job.status === 'complete' || job.status === 'collected' || !!job.completed_at

  const done = [true, depositDone, scheduledDone, startedDone, completeDone]
  const firstOpen = done.findIndex((v) => !v)
  // Everything done -> the last stage. Otherwise the stage before the first
  // outstanding one, which is the furthest the job has actually got to.
  return firstOpen === -1 ? done.length - 1 : Math.max(0, firstOpen - 1)
}

export function getJobPipelineCurrentStage(job: JobPipelineInput): PipelineStage {
  return PIPELINE_STAGES[getJobPipelineCurrentIndex(job)]
}
