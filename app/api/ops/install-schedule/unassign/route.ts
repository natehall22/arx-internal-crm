import { NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { resolveOpsAccess } from '@/lib/ops-access'
import { removeInstallFromCalendar } from '@/lib/install-calendar'
import { loadTradeWithJob } from '@/lib/job-trade-calendar'
import { JOB_TRADE_COLUMNS } from '@/lib/job-trades'
import { syncJobScheduleFromTrades } from '@/lib/job-trades-db'

/**
 * POST /api/ops/install-schedule/unassign
 * body: { workOrderId }
 *
 * Pulls ONE trade back off the schedule: clears its date, length and sub, sets
 * it back to 'pending', kills its crew photo link, and removes its Google event
 * best-effort (a Google failure never blocks this write). The job-level columns
 * and status are then re-derived from the job's remaining trades — the job only
 * drops back to 'materials' when no trade is still booked.
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

  const { workOrderId } = (body ?? {}) as { workOrderId?: unknown }
  if (typeof workOrderId !== 'string' || !workOrderId) {
    return NextResponse.json({ error: 'workOrderId is required' }, { status: 400 })
  }

  const orgId = profile.org_id
  const loaded = await loadTradeWithJob(adminClient, orgId, workOrderId)
  if (!loaded) {
    return NextResponse.json({ error: 'Trade not found' }, { status: 404 })
  }
  const { trade, job } = loaded
  if (trade.status === 'completed') {
    return NextResponse.json({ error: 'This trade is already complete — reopen it first' }, { status: 400 })
  }

  const { data: updated, error: updateError } = await adminClient
    .from('work_orders')
    .update({
      scheduled_date: null,
      install_days: null,
      assigned_sub_id: null,
      crew_link_token: null,
      ...(trade.status === 'cancelled' ? {} : { status: 'pending' }),
    })
    .eq('id', trade.id)
    .eq('org_id', orgId)
    .select(JOB_TRADE_COLUMNS)
    .single()

  if (updateError || !updated) {
    console.error('[install-schedule unassign] update failed:', updateError)
    return NextResponse.json({ error: 'Failed to unassign install' }, { status: 500 })
  }

  await syncJobScheduleFromTrades(adminClient, orgId, job.id, { revertToMaterials: true })

  // `trade` was read before the update, so it still carries the event ids to remove.
  const removal = await removeInstallFromCalendar(adminClient, {
    trade,
    schedulingUserId: authUser.id,
  })

  return NextResponse.json({
    trade: { ...updated, install_google_event_id: null, install_calendar_id: null },
    calendarWarning: removal.warning ?? null,
  })
}
