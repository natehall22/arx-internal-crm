import { NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { resolveOpsAccess } from '@/lib/ops-access'
import { assignInstallTrade } from '@/lib/install-schedule-assign'
import { parseInstallDays } from '@/lib/job-trades'
import { parseRollReason } from '@/lib/work-order-rolls'

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

  const { workOrderId, subId, scheduledDate, installDays: installDaysRaw, scheduledTimeStart, reason: reasonRaw } = (body ?? {}) as {
    reason?: unknown
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

  const reason = parseRollReason(reasonRaw)
  if (reason && typeof reason === 'object') return NextResponse.json(reason, { status: 400 })

  const res = await assignInstallTrade(
    adminClient,
    { orgId: profile.org_id, schedulingUserId: authUser.id, by: { userId: authUser.id, subId: null } },
    {
      workOrderId,
      subId,
      scheduledDate: hasDate ? (scheduledDate as string) : null,
      installDays: installDays ?? null,
      scheduledTimeStart: hasTime ? (scheduledTimeStart as string) : null,
      reason,
    }
  )
  return NextResponse.json(res.body, { status: res.status })
}
