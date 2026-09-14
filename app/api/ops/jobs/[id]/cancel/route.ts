import { NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { resolveOpsAccess } from '@/lib/ops-access'
import { removeInstallFromCalendar } from '@/lib/install-calendar'
import { isJobCancellationReason } from '@/lib/job-status'

const MAX_NOTES_LENGTH = 500

type CancelResult = {
  job_id: string
  job_number: string
  previous_status: string
  contracts_voided: number
  address_text: string
  scheduled_date: string | null
  install_days: number | null
  install_google_event_id: string | null
  install_calendar_id: string | null
}

type AuthContext = {
  authUser: { id: string }
  profile: { id: string; org_id: string; role: string; custom_role_id?: string | null }
}

async function authenticate(): Promise<AuthContext | null> {
  try {
    const ctx = await requireAuthApi()
    return { authUser: ctx.authUser, profile: ctx.profile as AuthContext['profile'] }
  } catch {
    return null
  }
}

/** Map a guard raised inside the cancel/uncancel SQL functions to an HTTP response. */
function rpcErrorResponse(error: { code?: string; message: string }, fallback: string) {
  if (error.code === 'P0002') {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }
  // P0001 = a guard refused (already cancelled, installed, already in payroll,
  // missing reason). Its message is written for ops to read.
  if (error.code === 'P0001') {
    return NextResponse.json({ error: error.message }, { status: 409 })
  }
  console.error(`[jobs cancel] ${fallback}:`, error)
  return NextResponse.json({ error: fallback }, { status: 500 })
}

/**
 * POST /api/ops/jobs/[id]/cancel
 * body: { reason: JobCancellationReason, notes?: string }
 *
 * Cancels a sold job that will never be installed. Every database write —
 * job → cancelled (with the required reason), project → cancelled, sale
 * agreement → voided (which is what removes it from every sales count), plus a
 * job note — happens atomically in `cancel_production_job`, which also refuses
 * installed jobs and jobs whose commission has already gone to payroll. The
 * opportunity is left alone.
 *
 * A scheduled install's Google invite is then removed best-effort, the same way
 * `/api/ops/install-schedule/unassign` does it; a Google failure is returned as
 * a warning and never undoes the cancel.
 *
 * PERMISSION REVIEW DUE 2026-11-14: anyone who can edit ops jobs can cancel
 * (Nathan, 2026-09-14 — "anyone with ops level for now"). If ARX has ops
 * management by then, that becomes the floor.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const ctx = await authenticate()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { authUser, profile } = ctx

  const adminClient = createServiceClient()
  const { canEditJobs } = await resolveOpsAccess(adminClient, authUser.id, profile)
  if (!canEditJobs) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { reason, notes: rawNotes } = (body ?? {}) as { reason?: unknown; notes?: unknown }
  if (!isJobCancellationReason(reason)) {
    return NextResponse.json({ error: 'Pick a cancellation reason' }, { status: 400 })
  }
  const notes = typeof rawNotes === 'string' ? rawNotes.trim() : ''
  if (reason === 'other' && !notes) {
    return NextResponse.json({ error: 'Describe the reason when it is "Other"' }, { status: 400 })
  }
  if (notes.length > MAX_NOTES_LENGTH) {
    return NextResponse.json(
      { error: `Keep the notes under ${MAX_NOTES_LENGTH} characters` },
      { status: 400 }
    )
  }

  const { data, error } = await adminClient.rpc('cancel_production_job', {
    p_org_id: profile.org_id,
    p_job_id: params.id,
    p_user_id: profile.id,
    p_reason: reason,
    p_notes: notes || null,
  })
  if (error) return rpcErrorResponse(error, 'Failed to cancel job')

  const result = data as CancelResult

  const removal = await removeInstallFromCalendar(adminClient, {
    job: {
      id: result.job_id,
      org_id: profile.org_id,
      job_number: result.job_number,
      address_text: result.address_text,
      scheduled_date: result.scheduled_date,
      install_days: result.install_days,
      install_google_event_id: result.install_google_event_id,
      install_calendar_id: result.install_calendar_id,
    },
    schedulingUserId: authUser.id,
  })

  return NextResponse.json({
    jobId: result.job_id,
    contractsVoided: result.contracts_voided,
    calendarWarning: removal.warning ?? null,
  })
}

/**
 * DELETE /api/ops/jobs/[id]/cancel — undo a cancel made by mistake.
 *
 * Admin/owner only (the same gate as deleting a job), deliberately higher than
 * the ops level that can cancel. `uncancel_production_job` returns the job to
 * `sold` and restores the agreement(s) that cancel voided. The install schedule
 * cleared by the cancel is not restored; ops reschedules it.
 */
export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const ctx = await authenticate()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { authUser, profile } = ctx

  const adminClient = createServiceClient()
  const { canDeleteProductionJob } = await resolveOpsAccess(adminClient, authUser.id, profile)
  if (!canDeleteProductionJob) {
    return NextResponse.json({ error: 'Only an admin or owner can undo a cancellation' }, { status: 403 })
  }

  const { data, error } = await adminClient.rpc('uncancel_production_job', {
    p_org_id: profile.org_id,
    p_job_id: params.id,
    p_user_id: profile.id,
  })
  if (error) return rpcErrorResponse(error, 'Failed to undo cancellation')

  const result = data as { job_id: string; contracts_restored: number }
  return NextResponse.json({ jobId: result.job_id, contractsRestored: result.contracts_restored })
}
