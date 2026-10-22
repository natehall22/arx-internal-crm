import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { isSuperAdmin } from '@/lib/super-admin'
import { getJobPaymentSummary } from '@/lib/job-payments'
import { projectStatusForJobStatus } from '@/lib/job-status'

const MAX_REASON_LENGTH = 500

/**
 * Super admin: treat a job as paid in full even though recorded payments are short by more
 * than $0.05 (lib/job-collection.ts). A reason is required. Who/when/why is stored on the
 * job and appended to payroll_override_audit as 'force_paid_in_full'.
 *
 * POST   { reason, mark_collected? } — set the override (and move a complete job to collected).
 * DELETE { reason }                  — remove it. The job's status is left alone.
 */
type AuthResult =
  | { error: NextResponse; profile?: undefined }
  | { error?: undefined; profile: Awaited<ReturnType<typeof requireAuthApi>>['profile'] }

async function authorize(): Promise<AuthResult> {
  try {
    const ctx = await requireAuthApi()
    if (!isSuperAdmin(ctx.profile as { is_super_admin?: boolean | null; active?: boolean | null })) {
      return { error: NextResponse.json({ error: 'Only an owner can do this.' }, { status: 403 }) }
    }
    return { profile: ctx.profile }
  } catch {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
}

async function readReason(request: Request): Promise<{ reason: string; markCollected: boolean } | null> {
  const body = (await request.json().catch(() => ({}))) as { reason?: unknown; mark_collected?: unknown }
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  if (!reason) return null
  return { reason: reason.slice(0, MAX_REASON_LENGTH), markCollected: body.mark_collected === true }
}

type JobRow = {
  id: string
  org_id: string
  project_id: string | null
  status: string
  allow_close_with_balance: boolean | null
  close_balance_reason: string | null
  close_balance_by: string | null
  close_balance_at: string | null
}

async function loadJob(admin: ReturnType<typeof createServiceClient>, jobId: string, orgId: string) {
  const { data } = await admin
    .from('production_jobs')
    .select('id, org_id, project_id, status, allow_close_with_balance, close_balance_reason, close_balance_by, close_balance_at')
    .eq('id', jobId)
    .eq('org_id', orgId)
    .maybeSingle()
  return (data as JobRow | null) ?? null
}

function overrideSnapshot(job: JobRow) {
  return {
    allow_close_with_balance: job.allow_close_with_balance ?? false,
    close_balance_reason: job.close_balance_reason ?? null,
    close_balance_by: job.close_balance_by ?? null,
    close_balance_at: job.close_balance_at ?? null,
    status: job.status,
  }
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const auth = await authorize()
  if (auth.error) return auth.error
  const { profile } = auth

  const input = await readReason(request)
  if (!input) {
    return NextResponse.json({ error: 'A reason is required to close a job with a balance.' }, { status: 400 })
  }

  const admin = createServiceClient()
  const job = await loadJob(admin, params.id, profile.org_id)
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  if (job.status === 'cancelled') {
    return NextResponse.json({ error: 'This job is cancelled.' }, { status: 409 })
  }

  const summary = await getJobPaymentSummary(admin, job.id)
  if (!summary) return NextResponse.json({ error: 'Could not read payments for this job' }, { status: 500 })
  if (summary.sale_amount_cents <= 0) {
    return NextResponse.json({ error: 'This job has no sale amount yet.' }, { status: 400 })
  }

  const now = new Date().toISOString()
  const update: Record<string, unknown> = {
    allow_close_with_balance: true,
    close_balance_reason: input.reason,
    close_balance_by: profile.id,
    close_balance_at: now,
  }
  if (input.markCollected && job.status === 'complete') update.status = 'collected'

  const { error: updateError } = await admin
    .from('production_jobs')
    .update(update)
    .eq('id', job.id)
    .eq('org_id', profile.org_id)
  if (updateError) {
    console.error('force-paid update failed', updateError)
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
  }

  const { error: auditError } = await admin.from('payroll_override_audit').insert({
    org_id: profile.org_id,
    override_type: 'force_paid_in_full',
    job_id: job.id,
    actor_user_id: profile.id,
    reason: input.reason,
    before_value: overrideSnapshot(job),
    after_value: {
      ...update,
      status: update.status ?? job.status,
      collected_cents: summary.collected_cents,
      sale_amount_cents: summary.sale_amount_cents,
      remaining_cents: summary.remaining_cents,
    },
  })
  if (auditError) {
    // Never leave a money override standing without its audit row.
    console.error('force-paid audit failed — reverting', auditError)
    await admin
      .from('production_jobs')
      .update({
        allow_close_with_balance: job.allow_close_with_balance ?? false,
        close_balance_reason: job.close_balance_reason,
        close_balance_by: job.close_balance_by,
        close_balance_at: job.close_balance_at,
        status: job.status,
      })
      .eq('id', job.id)
      .eq('org_id', profile.org_id)
    return NextResponse.json({ error: 'Could not record the reason. Nothing was changed.' }, { status: 500 })
  }

  if (update.status === 'collected' && job.project_id) {
    await admin
      .from('projects')
      .update({ status: projectStatusForJobStatus('collected') })
      .eq('id', job.project_id)
      .eq('org_id', profile.org_id)
  }

  return NextResponse.json({ success: true, status: update.status ?? job.status })
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  const auth = await authorize()
  if (auth.error) return auth.error
  const { profile } = auth

  const input = await readReason(request)
  if (!input) return NextResponse.json({ error: 'A reason is required.' }, { status: 400 })

  const admin = createServiceClient()
  const job = await loadJob(admin, params.id, profile.org_id)
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  const cleared = {
    allow_close_with_balance: false,
    close_balance_reason: null,
    close_balance_by: null,
    close_balance_at: null,
  }
  const { error: updateError } = await admin
    .from('production_jobs')
    .update(cleared)
    .eq('id', job.id)
    .eq('org_id', profile.org_id)
  if (updateError) return NextResponse.json({ error: 'Failed to save' }, { status: 500 })

  const { error: auditError } = await admin.from('payroll_override_audit').insert({
    org_id: profile.org_id,
    override_type: 'force_paid_in_full',
    job_id: job.id,
    actor_user_id: profile.id,
    reason: input.reason,
    before_value: overrideSnapshot(job),
    after_value: { ...cleared, status: job.status, removed: true },
  })
  if (auditError) {
    console.error('force-paid removal audit failed — reverting', auditError)
    await admin
      .from('production_jobs')
      .update({
        allow_close_with_balance: job.allow_close_with_balance ?? false,
        close_balance_reason: job.close_balance_reason,
        close_balance_by: job.close_balance_by,
        close_balance_at: job.close_balance_at,
      })
      .eq('id', job.id)
      .eq('org_id', profile.org_id)
    return NextResponse.json({ error: 'Could not record the reason. Nothing was changed.' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
