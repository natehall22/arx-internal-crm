import type { SupabaseClient } from '@supabase/supabase-js'

const MAX_REASON = 500

export type UnsettleResult =
  | { ok: true }
  | { ok: false; status: number; error: string }

/**
 * Owner action: bring a job that was settled outside the CRM back into CRM payroll. The job becomes eligible again and
 * would be paid IN FULL by the next payroll run, so a reason is required and the change is audited
 * (payroll_override_audit 'unsettle_externally', before/after). If the audit cannot be written the change is undone.
 */
export async function unsettleJob(admin: SupabaseClient, input: { orgId: string; actorUserId: string; jobId: string; reason: string }): Promise<UnsettleResult> {
  const reason = input.reason.trim().slice(0, MAX_REASON)
  if (!reason) return { ok: false, status: 400, error: 'Say why this job is coming back into CRM payroll.' }

  const { data: job } = await admin
    .from('production_jobs')
    .select('id, job_number, status, payroll_settled_externally_at, settled_externally_reason')
    .eq('id', input.jobId)
    .eq('org_id', input.orgId)
    .maybeSingle()
  if (!job) return { ok: false, status: 404, error: 'Job not found' }
  if (!job.payroll_settled_externally_at) return { ok: false, status: 409, error: 'This job is not marked as settled outside the CRM.' }

  // A job the CRM already paid (a snapshot in a locked/paid week) can't be unsettled: the DB double-pay guards would just
  // skip it every run. Nothing to bring back.
  const { data: snaps } = await admin.from('payroll_job_snapshots').select('payroll_period_id').eq('job_id', input.jobId)
  const periodIds = Array.from(new Set((snaps ?? []).map((r) => r.payroll_period_id as string)))
  if (periodIds.length) {
    const { data: periods } = await admin.from('payroll_periods').select('id, status').in('id', periodIds)
    if ((periods ?? []).some((p) => p.status === 'locked' || p.status === 'paid')) {
      return { ok: false, status: 409, error: 'The CRM already paid this job in an approved week, so there is nothing to bring back.' }
    }
  }

  const before = { payroll_settled_externally_at: job.payroll_settled_externally_at, settled_externally_reason: job.settled_externally_reason }
  // Audit FIRST (the job stays settled until the audit row exists), then clear; if clearing fails the audit row is removed.
  const { data: audit, error: auditError } = await admin
    .from('payroll_override_audit')
    .insert({
      org_id: input.orgId,
      override_type: 'unsettle_externally',
      job_id: input.jobId,
      actor_user_id: input.actorUserId,
      reason,
      before_value: before,
      after_value: { payroll_settled_externally_at: null, settled_externally_reason: null, job_status: job.status },
    })
    .select('id')
    .single()
  if (auditError || !audit) {
    console.error('unsettle audit failed', auditError)
    return { ok: false, status: 500, error: 'Could not save (audit failed). Nothing changed.' }
  }
  const { data: cleared, error } = await admin
    .from('production_jobs')
    .update({ payroll_settled_externally_at: null, settled_externally_reason: null })
    .eq('id', input.jobId)
    .eq('org_id', input.orgId)
    .not('payroll_settled_externally_at', 'is', null)
    .select('id')
    .maybeSingle()
  if (error || !cleared) {
    await admin.from('payroll_override_audit').delete().eq('id', audit.id)
    return error ? { ok: false, status: 500, error: 'Could not save' } : { ok: false, status: 409, error: 'Someone already changed this job.' }
  }
  return { ok: true }
}
