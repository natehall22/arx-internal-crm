/**
 * The ONE writer that puts a trade work order on a crew's day (assign / reassign / move). The assign route and the one-tap
 * "Not ready — roll" (lib/work-order-roll.ts) both come through here, so a roll keeps the job's derived schedule, the materials
 * roll-up and the Google / Outlook invite exactly as a manual reschedule does. When an already-scheduled order lands on a
 * different day, the move is logged and counted (lib/work-order-moves-db.ts).
 *
 * Returns the route's own response shape: `{ status, body }`.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { loadTradeWithJob, syncTradeCalendar } from '@/lib/job-trade-calendar'
import { JOB_TRADE_COLUMNS, newCrewLinkToken, parseInstallDays, type JobTradeRow } from '@/lib/job-trades'
import { syncJobScheduleFromTrades } from '@/lib/job-trades-db'
import { markMaterialsOrdered } from '@/lib/job-status-events'
import { refreshMaterialsOrderedFromSuppliers } from '@/lib/supplier-orders'
import { recordWorkOrderMoves } from '@/lib/work-order-moves-db'
import type { MoveKind, RollReason } from '@/lib/work-order-rolls'

export type AssignInput = {
  workOrderId: string
  subId: string
  /** YYYY-MM-DD; absent = keep the trade's day (a reassignment). */
  scheduledDate?: string | null
  installDays?: number | null
  scheduledTimeStart?: string | null
  /** For the move log when the day changes. */
  reason?: RollReason | null
  kind?: MoveKind
}

export type AssignCtx = {
  orgId: string
  /** Whose Google / Outlook connection the invite falls back to (the org's nominated account is preferred). '' = none. */
  schedulingUserId: string
  /** Who moved it: a staff user, or a crew (phone link). */
  by?: { userId: string | null; subId: string | null }
}

export type AssignResult = { status: number; body: Record<string, unknown> }

export async function assignInstallTrade(adminClient: SupabaseClient, ctx: AssignCtx, input: AssignInput): Promise<AssignResult> {
  const { orgId } = ctx
  const { workOrderId, subId } = input
  const hasDate = input.scheduledDate !== undefined && input.scheduledDate !== null
  const hasTime = input.scheduledTimeStart !== undefined && input.scheduledTimeStart !== null
  const installDays = input.installDays === undefined || input.installDays === null ? null : parseInstallDays(input.installDays)

  const loaded = await loadTradeWithJob(adminClient, orgId, workOrderId)
  if (!loaded) return { status: 404, body: { error: 'Trade not found' } }
  const { trade, job } = loaded
  if (job.cancelled_at) return { status: 400, body: { error: 'This job is cancelled' } }
  if (trade.status === 'completed' || trade.status === 'cancelled') {
    return { status: 400, body: { error: `This trade is ${trade.status} — reopen it before scheduling` } }
  }

  const { data: sub } = await adminClient.from('sub_contractors').select('id').eq('id', subId).eq('org_id', orgId).maybeSingle()
  if (!sub) return { status: 404, body: { error: 'Subcontractor not found' } }

  // A reassignment posts no date and keeps the one already on the trade.
  const effectiveDate = hasDate ? (input.scheduledDate as string) : trade.scheduled_date
  if (!effectiveDate) {
    return { status: 400, body: { error: 'scheduledDate is required — this trade has no date to reassign against' } }
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
    updatePayload.scheduled_time_start = input.scheduledTimeStart
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
    return { status: 500, body: { error: 'Failed to assign install' } }
  }

  // An already-scheduled order that lands on another day is a move: log it and count the roll.
  if (trade.scheduled_date && trade.scheduled_date !== effectiveDate) {
    await recordWorkOrderMoves(adminClient, orgId, [
      { workOrderId: trade.id, from: trade.scheduled_date, to: effectiveDate, reason: input.reason ?? null, kind: input.kind ?? 'move', userId: ctx.by?.userId ?? null, subId: ctx.by?.subId ?? null },
    ])
  }

  await syncJobScheduleFromTrades(adminClient, orgId, job.id)

  // An installer-supplied trade counts as covered once its crew is scheduled; if that completes
  // the job's materials, record it. Records a status only — never sends anything to a supplier.
  try {
    await refreshMaterialsOrderedFromSuppliers(adminClient, orgId, job.id, ({ orgId: o, jobId }) =>
      markMaterialsOrdered(adminClient, { orgId: o, jobId, source: 'board' })
    )
  } catch (e) {
    console.error('[install-schedule assign] materials roll-up failed', e)
  }

  const sync = await syncTradeCalendar(adminClient, {
    trade: updated as JobTradeRow,
    job,
    schedulingUserId: ctx.schedulingUserId,
  })

  return {
    status: 200,
    body: {
      trade: {
        ...(updated as JobTradeRow),
        install_google_event_id: sync.eventId,
        install_calendar_id: sync.calendarId,
      },
      calendar: sync.outcome,
      calendarError: sync.error ?? null,
      subNotified: sync.subNotified,
      subHasSchedulingEmail: sync.subHasSchedulingEmail,
    },
  }
}
