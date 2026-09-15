import { NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { resolveOpsAccess } from '@/lib/ops-access'
import { loadTradeWithJob, syncTradeCalendar } from '@/lib/job-trade-calendar'
import { syncJobScheduleFromTrades } from '@/lib/job-trades-db'
import { JOB_TRADE_COLUMNS, newCrewLinkToken, parseInstallDays, type JobTradeRow } from '@/lib/job-trades'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/

/**
 * POST /api/ops/install-schedule/assign
 * body: { workOrderId, subId, scheduledDate?, installDays?, scheduledTimeStart? }
 *
 * Puts ONE trade of a job (roofing, gutters, siding, …) on a sub's calendar,
 * then best-effort syncs that trade's own Google event — see
 * `lib/install-calendar.ts` for the sync/failure contract. The database write
 * always stands regardless of whether the calendar sync succeeds.
 *
 * This is the ONE write path for scheduling a crew. The schedule board and the
 * job page's trades card both come through here. The job-level columns
 * (`production_jobs.scheduled_date` / `assigned_sub_id` / status) are then
 * re-derived from all of the job's trades by `syncJobScheduleFromTrades`.
 *
 * `installDays` is ½, 1, 1½ or 2 (ops-selected). `scheduledDate` is optional so
 * a pure reassignment (same day, different sub) can post without one; that path
 * re-syncs the event so the new sub is invited and the old one is dropped.
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

  const { workOrderId, subId, scheduledDate, installDays: installDaysRaw, scheduledTimeStart } = (body ?? {}) as {
    workOrderId?: unknown
    subId?: unknown
    scheduledDate?: unknown
    installDays?: unknown
    scheduledTimeStart?: unknown
  }

  if (typeof workOrderId !== 'string' || !workOrderId) {
    return NextResponse.json({ error: 'workOrderId is required' }, { status: 400 })
  }
  if (typeof subId !== 'string' || !subId) {
    return NextResponse.json({ error: 'subId is required' }, { status: 400 })
  }
  const hasDate = scheduledDate !== undefined && scheduledDate !== null
  if (hasDate && (typeof scheduledDate !== 'string' || !DATE_RE.test(scheduledDate))) {
    return NextResponse.json({ error: 'scheduledDate must be YYYY-MM-DD' }, { status: 400 })
  }
  const hasTime = scheduledTimeStart !== undefined && scheduledTimeStart !== null
  if (hasTime && (typeof scheduledTimeStart !== 'string' || !TIME_RE.test(scheduledTimeStart))) {
    return NextResponse.json({ error: 'scheduledTimeStart must be HH:MM' }, { status: 400 })
  }
  const installDaysProvided = installDaysRaw !== undefined && installDaysRaw !== null
  const installDays = parseInstallDays(installDaysRaw)
  if (installDaysProvided && installDays === null) {
    return NextResponse.json({ error: 'installDays must be 0.5, 1, 1.5 or 2' }, { status: 400 })
  }

  const orgId = profile.org_id

  const loaded = await loadTradeWithJob(adminClient, orgId, workOrderId)
  if (!loaded) {
    return NextResponse.json({ error: 'Trade not found' }, { status: 404 })
  }
  const { trade, job } = loaded
  if (job.cancelled_at) {
    return NextResponse.json({ error: 'This job is cancelled' }, { status: 400 })
  }
  if (trade.status === 'completed' || trade.status === 'cancelled') {
    return NextResponse.json(
      { error: `This trade is ${trade.status} — reopen it before scheduling` },
      { status: 400 }
    )
  }

  const { data: sub } = await adminClient
    .from('sub_contractors')
    .select('id')
    .eq('id', subId)
    .eq('org_id', orgId)
    .maybeSingle()
  if (!sub) {
    return NextResponse.json({ error: 'Subcontractor not found' }, { status: 404 })
  }

  // A reassignment posts no date and keeps the one already on the trade.
  const effectiveDate = hasDate ? (scheduledDate as string) : trade.scheduled_date
  if (!effectiveDate) {
    return NextResponse.json(
      { error: 'scheduledDate is required — this trade has no date to reassign against' },
      { status: 400 }
    )
  }

  const updatePayload: Record<string, unknown> = {
    scheduled_date: effectiveDate,
    // A reassignment that says nothing about length must not silently change it.
    install_days: installDays ?? parseInstallDays(trade.install_days) ?? 1,
    assigned_sub_id: subId,
    assigned_user_id: null, // work_order_single_assignee
    status: 'scheduled',
  }
  if (hasTime) {
    updatePayload.scheduled_time_start = scheduledTimeStart
  } else if (updatePayload.install_days === 0.5 && !trade.scheduled_time_start) {
    // A ½-day block is a timed event; store the start the invite will use.
    updatePayload.scheduled_time_start = '08:00'
  }
  // A new crew gets a new photo link, so the previous crew's link stops working.
  if (trade.assigned_sub_id !== subId || !trade.crew_link_token) {
    updatePayload.crew_link_token = newCrewLinkToken()
  }

  const { data: updated, error: updateError } = await adminClient
    .from('work_orders')
    .update(updatePayload)
    .eq('id', trade.id)
    .eq('org_id', orgId)
    .select(JOB_TRADE_COLUMNS)
    .single()

  if (updateError || !updated) {
    console.error('[install-schedule assign] update failed:', updateError)
    return NextResponse.json({ error: 'Failed to assign install' }, { status: 500 })
  }

  await syncJobScheduleFromTrades(adminClient, orgId, job.id)

  const sync = await syncTradeCalendar(adminClient, {
    trade: updated as JobTradeRow,
    job,
    schedulingUserId: authUser.id,
  })

  return NextResponse.json({
    trade: {
      ...(updated as JobTradeRow),
      install_google_event_id: sync.eventId,
      install_calendar_id: sync.calendarId,
    },
    calendar: sync.outcome,
    calendarError: sync.error ?? null,
    subNotified: sync.subNotified,
    subHasSchedulingEmail: sync.subHasSchedulingEmail,
  })
}
