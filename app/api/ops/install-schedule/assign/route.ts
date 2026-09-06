import { NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { resolveOpsAccess } from '@/lib/ops-access'
import { syncInstallToCalendar, type InstallSyncJobRow } from '@/lib/install-calendar'
import {
  enrichOpsJobsWithMeasureSoldSquaresFallback,
  enrichOpsJobsWithSoldSquares,
} from '@/lib/ops-board-sold-squares'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Statuses that assigning an install is allowed to auto-advance to 'scheduled'. Never downgrades a job past this. */
const STATUSES_ADVANCEABLE_TO_SCHEDULED = new Set(['sold', 'materials'])

const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/

/**
 * POST /api/ops/install-schedule/assign
 * body: { jobId, subId, scheduledDate?, installDays?, scheduledTimeStart?, estimatedDurationHours? }
 *
 * Assigns a roof install to a subcontractor on a given date (1-2 all-day
 * calendar days), then best-effort syncs the assignment to Google Calendar —
 * see `lib/install-calendar.ts` for the sync/failure contract. The database
 * write always stands regardless of whether the calendar sync succeeds.
 *
 * This is the ONE write path for scheduling an install. The schedule board and
 * `ScheduleJobModal` both come through here rather than the generic job PATCH,
 * which touches the same columns but has no calendar sync and no status guard —
 * two ways to schedule a job is the bug CLAUDE.md's Tesla Algorithm forbids.
 *
 * `scheduledDate` is optional so a pure reassignment (same day, different sub)
 * can post without one. That path matters: it re-syncs the calendar event so the
 * new sub is invited and the old one is dropped, which the generic PATCH never did.
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

  const {
    jobId,
    subId,
    scheduledDate,
    installDays: installDaysRaw,
    scheduledTimeStart,
    estimatedDurationHours,
  } = (body ?? {}) as {
    jobId?: unknown
    subId?: unknown
    scheduledDate?: unknown
    installDays?: unknown
    scheduledTimeStart?: unknown
    estimatedDurationHours?: unknown
  }

  if (typeof jobId !== 'string' || !jobId) {
    return NextResponse.json({ error: 'jobId is required' }, { status: 400 })
  }
  if (typeof subId !== 'string' || !subId) {
    return NextResponse.json({ error: 'subId is required' }, { status: 400 })
  }
  const hasDate = scheduledDate !== undefined && scheduledDate !== null
  if (hasDate && (typeof scheduledDate !== 'string' || !DATE_RE.test(scheduledDate))) {
    return NextResponse.json({ error: 'scheduledDate must be YYYY-MM-DD' }, { status: 400 })
  }
  if (
    scheduledTimeStart !== undefined &&
    scheduledTimeStart !== null &&
    (typeof scheduledTimeStart !== 'string' || !TIME_RE.test(scheduledTimeStart))
  ) {
    return NextResponse.json({ error: 'scheduledTimeStart must be HH:MM' }, { status: 400 })
  }
  let durationHours: number | null = null
  if (estimatedDurationHours !== undefined && estimatedDurationHours !== null) {
    const n = Number(estimatedDurationHours)
    if (!Number.isFinite(n) || n <= 0 || n > 24) {
      return NextResponse.json(
        { error: 'estimatedDurationHours must be between 0 and 24' },
        { status: 400 }
      )
    }
    durationHours = n
  }

  const installDaysProvided = installDaysRaw !== undefined && installDaysRaw !== null
  let installDays = 1
  if (installDaysProvided) {
    const n = Number(installDaysRaw)
    if (n !== 1 && n !== 2) {
      return NextResponse.json({ error: 'installDays must be 1 or 2' }, { status: 400 })
    }
    installDays = n
  }

  const orgId = profile.org_id

  const [{ data: job, error: jobError }, { data: sub, error: subError }] = await Promise.all([
    adminClient
      .from('production_jobs')
      .select(
        'id, org_id, job_number, address_text, status, scheduled_date, install_days, install_google_event_id, install_calendar_id, project_id, accepted_proposal_id, linked_proposal_id, job_type, customer:customers(id, name), project:projects(sold_roof_squares, opportunity_id)'
      )
      .eq('id', jobId)
      .eq('org_id', orgId)
      .maybeSingle(),
    adminClient
      .from('sub_contractors')
      .select('id, company_name, scheduling_email, active')
      .eq('id', subId)
      .eq('org_id', orgId)
      .maybeSingle(),
  ])

  if (jobError || !job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }
  if (subError || !sub) {
    return NextResponse.json({ error: 'Subcontractor not found' }, { status: 404 })
  }

  // A reassignment posts no date and keeps the one already on the job.
  const effectiveDate = hasDate ? (scheduledDate as string) : job.scheduled_date
  if (!effectiveDate) {
    return NextResponse.json(
      { error: 'scheduledDate is required — this job has no date to reassign against' },
      { status: 400 }
    )
  }

  const nextStatus = STATUSES_ADVANCEABLE_TO_SCHEDULED.has(String(job.status))
    ? 'scheduled'
    : job.status

  const updatePayload: Record<string, unknown> = {
    scheduled_date: effectiveDate,
    // A reassignment that says nothing about length must not silently shrink a
    // 2-day install back to 1 day.
    install_days: installDaysProvided ? installDays : (job.install_days ?? 1),
    assigned_sub_id: subId,
    assigned_crew_id: null, // in-house crew path retired — subs only (see CLAUDE.md)
  }
  if (nextStatus !== job.status) {
    updatePayload.status = nextStatus
  }
  if (typeof scheduledTimeStart === 'string') {
    updatePayload.scheduled_time_start = scheduledTimeStart
  }
  if (durationHours != null) {
    updatePayload.estimated_duration_hours = durationHours
  }

  const { data: updatedJob, error: updateError } = await adminClient
    .from('production_jobs')
    .update(updatePayload)
    .eq('id', jobId)
    .eq('org_id', orgId)
    .select(
      'id, job_number, status, job_type, address_text, scheduled_date, install_days, assigned_sub_id, install_google_event_id, install_calendar_id'
    )
    .single()

  if (updateError || !updatedJob) {
    console.error('[install-schedule assign] update failed:', updateError)
    return NextResponse.json({ error: 'Failed to assign install' }, { status: 500 })
  }

  const customer = Array.isArray(job.customer) ? job.customer[0] : job.customer
  const customerName = customer?.name ?? 'Customer'

  // Reuse the existing squares resolver rather than re-deriving squares here.
  const squaresCarrier: Record<string, unknown> = {
    project_id: job.project_id,
    accepted_proposal_id: job.accepted_proposal_id,
    linked_proposal_id: job.linked_proposal_id,
    job_type: job.job_type,
    project: job.project,
  }
  await enrichOpsJobsWithSoldSquares(adminClient, orgId, [squaresCarrier])
  await enrichOpsJobsWithMeasureSoldSquaresFallback(adminClient, orgId, [squaresCarrier])
  const totalSquares = (squaresCarrier.sold_squares as number | null | undefined) ?? null

  const syncJobRow: InstallSyncJobRow = {
    id: updatedJob.id,
    org_id: orgId,
    job_number: updatedJob.job_number,
    address_text: updatedJob.address_text,
    scheduled_date: updatedJob.scheduled_date,
    install_days: updatedJob.install_days,
    install_google_event_id: updatedJob.install_google_event_id,
    install_calendar_id: updatedJob.install_calendar_id,
  }

  const syncResult = await syncInstallToCalendar(adminClient, {
    job: syncJobRow,
    customerName,
    totalSquares,
    schedulingEmail: sub.scheduling_email,
    schedulingUserId: authUser.id,
  })

  return NextResponse.json({
    job: {
      ...updatedJob,
      install_google_event_id: syncResult.eventId,
      install_calendar_id: syncResult.calendarId,
    },
    calendar: syncResult.outcome,
    calendarError: syncResult.error ?? null,
  })
}
