import type { SupabaseClient } from '@supabase/supabase-js'

import { CANCELLED_JOB_STATUS, jobCancellationReasonLabel } from '@/lib/job-status'

/**
 * Bring a cancelled job back when the customer signs a new sale agreement
 * (a different lender, or cash after a financing decline).
 *
 * Cancelling (`cancel_production_job`) voided the old agreement and set the
 * project cancelled. The new signature is already a completed agreement, so it
 * counts as a sale again on its own; this puts the job and project back in line
 * with it. (An admin undoing a mistaken cancel uses `uncancel_production_job`
 * instead, which keeps the original sale date.) Without it the job would
 * stay cancelled — off the ops board and out of payroll — while dashboards
 * counted the sale.
 *
 * The sale is re-dated to today and re-priced from the new agreement: the deal
 * that exists now is the one just signed, not the one that fell through.
 *
 * No-op (returns false) unless the job is currently cancelled.
 */
export async function reinstateCancelledJob(
  supabase: SupabaseClient,
  args: {
    orgId: string
    jobId: string
    projectId: string
    userId: string | null
    saleAmount: number | null
  }
): Promise<boolean> {
  const { data: job } = await supabase
    .from('production_jobs')
    .select('id, status, cancellation_reason, cancellation_notes')
    .eq('id', args.jobId)
    .eq('org_id', args.orgId)
    .maybeSingle()

  if (!job || job.status !== CANCELLED_JOB_STATUS) return false

  const { error: jobError } = await supabase
    .from('production_jobs')
    .update({
      status: 'sold',
      sale_date: new Date().toISOString().split('T')[0],
      ...(args.saleAmount != null ? { sale_amount: args.saleAmount } : {}),
      cancelled_at: null,
      cancelled_by_user_id: null,
      cancellation_reason: null,
      cancellation_notes: null,
    })
    .eq('id', args.jobId)
    .eq('org_id', args.orgId)
    .eq('status', CANCELLED_JOB_STATUS)

  if (jobError) {
    console.error('[reinstateCancelledJob] job update failed:', jobError)
    return false
  }

  await supabase
    .from('projects')
    .update({ status: 'in_progress' })
    .eq('id', args.projectId)
    .eq('org_id', args.orgId)
    .eq('status', 'cancelled')

  // The reason was cleared from the job row; keep it in the job's history.
  if (args.userId) {
    await supabase.from('production_job_notes').insert({
      job_id: args.jobId,
      user_id: args.userId,
      note: `Job reinstated by a new signed agreement (was cancelled: ${jobCancellationReasonLabel(job.cancellation_reason)}${job.cancellation_notes ? ` — ${job.cancellation_notes}` : ''})`,
      is_internal: true,
    })
  }

  return true
}
