import { NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { resolveOpsAccess } from '@/lib/ops-access'
import { removeInstallFromCalendar, type InstallSyncJobRow } from '@/lib/install-calendar'

/**
 * POST /api/ops/install-schedule/unassign
 * body: { jobId }
 *
 * Pulls a job back off the install schedule: clears scheduled_date,
 * install_days, assigned_sub_id, and reverts status to 'materials' only if
 * the job is currently 'scheduled' (never touches in_progress/complete/
 * collected/on_hold). Removes the Google Calendar event best-effort — see
 * `lib/install-calendar.ts` for the failure contract; a Google failure never
 * blocks this database write.
 */
export async function POST(request: Request) {
  let authUser: { id: string }
  let profile: { id: string; org_id: string; role: string; custom_role_id?: string | null }
  try {
    const ctx = await requireAuthApi()
    authUser = ctx.authUser
    profile = ctx.profile as typeof profile
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

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

  const { jobId } = (body ?? {}) as { jobId?: unknown }
  if (typeof jobId !== 'string' || !jobId) {
    return NextResponse.json({ error: 'jobId is required' }, { status: 400 })
  }

  const orgId = profile.org_id

  const { data: job, error: jobError } = await adminClient
    .from('production_jobs')
    .select(
      'id, org_id, job_number, address_text, status, scheduled_date, install_days, install_google_event_id, install_calendar_id'
    )
    .eq('id', jobId)
    .eq('org_id', orgId)
    .maybeSingle()

  if (jobError || !job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  const nextStatus = job.status === 'scheduled' ? 'materials' : job.status

  const { data: updatedJob, error: updateError } = await adminClient
    .from('production_jobs')
    .update({
      scheduled_date: null,
      install_days: null,
      assigned_sub_id: null,
      ...(nextStatus !== job.status ? { status: nextStatus } : {}),
    })
    .eq('id', jobId)
    .eq('org_id', orgId)
    .select('id, job_number, status, job_type, address_text, scheduled_date, install_days, assigned_sub_id')
    .single()

  if (updateError || !updatedJob) {
    console.error('[install-schedule unassign] update failed:', updateError)
    return NextResponse.json({ error: 'Failed to unassign install' }, { status: 500 })
  }

  // Capture the pre-clear event/calendar ids to remove — the DB row we just
  // wrote no longer carries them here, but `job` (read before the update) does.
  const removalJobRow: InstallSyncJobRow = {
    id: job.id,
    org_id: job.org_id,
    job_number: job.job_number,
    address_text: job.address_text,
    scheduled_date: job.scheduled_date,
    install_days: job.install_days,
    install_google_event_id: job.install_google_event_id,
    install_calendar_id: job.install_calendar_id,
  }

  const removal = await removeInstallFromCalendar(adminClient, {
    job: removalJobRow,
    schedulingUserId: authUser.id,
  })

  return NextResponse.json({
    job: updatedJob,
    calendarWarning: removal.warning ?? null,
  })
}
