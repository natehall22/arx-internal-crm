/**
 * Loading a trade with everything its calendar invite needs, and syncing it.
 *
 * Shared by every route that changes a trade's schedule (assign, unassign,
 * remove) so none of them rebuilds the customer name / squares / org phone /
 * sub email lookup on its own.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import {
  enrichOpsJobsWithMeasureSoldSquaresFallback,
  enrichOpsJobsWithSoldSquares,
} from '@/lib/ops-board-sold-squares'
import {
  syncInstallToCalendar,
  type InstallCalendarSyncResult,
  type InstallSyncTradeRow,
} from '@/lib/install-calendar'
import { JOB_TRADE_COLUMNS, type JobTradeRow } from '@/lib/job-trades'

const TRADE_JOB_COLUMNS =
  'id, org_id, job_number, address_text, status, cancelled_at, project_id, accepted_proposal_id, linked_proposal_id, job_type, customer:customers(id, name), project:projects(sold_roof_squares, opportunity_id)'

export type TradeJobRow = {
  id: string
  org_id: string
  job_number: string
  address_text: string | null
  status: string
  cancelled_at: string | null
  project_id: string | null
  accepted_proposal_id: string | null
  linked_proposal_id: string | null
  job_type: string | null
  customer?: { id: string; name: string | null } | { id: string; name: string | null }[] | null
  project?: unknown
}

export async function loadTradeWithJob(
  admin: SupabaseClient,
  orgId: string,
  workOrderId: string
): Promise<{ trade: JobTradeRow; job: TradeJobRow } | null> {
  const { data: trade } = await admin
    .from('work_orders')
    .select(JOB_TRADE_COLUMNS)
    .eq('id', workOrderId)
    .eq('org_id', orgId)
    .not('trade', 'is', null)
    .not('job_id', 'is', null)
    .maybeSingle()
  if (!trade) return null

  const { data: job } = await admin
    .from('production_jobs')
    .select(TRADE_JOB_COLUMNS)
    .eq('id', (trade as JobTradeRow).job_id)
    .eq('org_id', orgId)
    .maybeSingle()
  if (!job) return null

  return { trade: trade as JobTradeRow, job: job as TradeJobRow }
}

function customerNameOf(job: TradeJobRow): string {
  const c = Array.isArray(job.customer) ? job.customer[0] : job.customer
  return c?.name ?? 'Customer'
}

function toSyncRow(trade: JobTradeRow, job: TradeJobRow): InstallSyncTradeRow {
  return {
    id: trade.id,
    org_id: trade.org_id,
    job_id: job.id,
    job_number: job.job_number,
    trade: trade.trade,
    address_text: job.address_text,
    scheduled_date: trade.scheduled_date,
    scheduled_time_start: trade.scheduled_time_start,
    install_days: trade.install_days,
    install_google_event_id: trade.install_google_event_id,
    install_calendar_id: trade.install_calendar_id,
    crew_link_token: trade.crew_link_token,
  }
}

/** Create/patch the trade's Google event. Returns whether the sub is actually a guest on it. */
export async function syncTradeCalendar(
  admin: SupabaseClient,
  params: { trade: JobTradeRow; job: TradeJobRow; schedulingUserId: string }
): Promise<InstallCalendarSyncResult & { subNotified: boolean; subHasSchedulingEmail: boolean }> {
  const { trade, job } = params
  const orgId = trade.org_id

  const [{ data: sub }, { data: org }] = await Promise.all([
    trade.assigned_sub_id
      ? admin
          .from('sub_contractors')
          .select('scheduling_email')
          .eq('id', trade.assigned_sub_id)
          .eq('org_id', orgId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    // The crew gets this number in the invite so they have someone to call from
    // the job site. Non-fatal: a missing phone just drops that line.
    admin.from('orgs').select('phone').eq('id', orgId).maybeSingle(),
  ])

  let totalSquares: number | null = null
  if (trade.trade === 'roofing') {
    // Reuse the board's squares resolver rather than re-deriving squares here.
    const carrier: Record<string, unknown> = {
      project_id: job.project_id,
      accepted_proposal_id: job.accepted_proposal_id,
      linked_proposal_id: job.linked_proposal_id,
      job_type: job.job_type,
      project: job.project,
    }
    await enrichOpsJobsWithSoldSquares(admin, orgId, [carrier])
    await enrichOpsJobsWithMeasureSoldSquaresFallback(admin, orgId, [carrier])
    totalSquares = (carrier.sold_squares as number | null | undefined) ?? null
  }

  const schedulingEmail = (sub as { scheduling_email?: string | null } | null)?.scheduling_email ?? null
  const result = await syncInstallToCalendar(admin, {
    trade: toSyncRow(trade, job),
    customerName: customerNameOf(job),
    totalSquares,
    schedulingEmail,
    orgPhone: (org as { phone?: string | null } | null)?.phone ?? null,
    schedulingUserId: params.schedulingUserId,
  })

  return {
    ...result,
    /**
     * Whether the SUB was actually told. A synced event with no attendee on it
     * notifies nobody — Google only emails guests, and a sub with no
     * `scheduling_email` on file is not a guest.
     */
    subNotified: result.outcome === 'synced' && Boolean(schedulingEmail),
    subHasSchedulingEmail: Boolean(schedulingEmail),
  }
}
