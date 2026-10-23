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

  const before = { payroll_settled_externally_at: job.payroll_settled_externally_at, settled_externally_reason: job.settled_externally_reason }
  const { data: cleared, error } = await admin
    .from('production_jobs')
    .update({ payroll_settled_externally_at: null, settled_externally_reason: null })
    .eq('id', input.jobId)
    .eq('org_id', input.orgId)
    .not('payroll_settled_externally_at', 'is', null)
    .select('id')
    .maybeSingle()
  if (error) return { ok: false, status: 500, error: 'Could not save' }
  if (!cleared) return { ok: false, status: 409, error: 'Someone already changed this job.' }

  const { error: auditError } = await admin.from('payroll_override_audit').insert({
    org_id: input.orgId,
    override_type: 'unsettle_externally',
    job_id: input.jobId,
    actor_user_id: input.actorUserId,
    reason,
    before_value: before,
    after_value: { payroll_settled_externally_at: null, settled_externally_reason: null, job_status: job.status },
  })
  if (auditError) {
    // Never leave a payroll override standing without its audit row.
    console.error('unsettle audit failed — reverting', auditError)
    await admin.from('production_jobs').update(before).eq('id', input.jobId).eq('org_id', input.orgId)
    return { ok: false, status: 500, error: 'Could not save (audit failed). Nothing changed.' }
  }
  return { ok: true }
}
