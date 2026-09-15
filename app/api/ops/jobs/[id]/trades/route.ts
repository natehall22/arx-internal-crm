import { NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { resolveOpsAccess } from '@/lib/ops-access'
import { removeInstallFromCalendar } from '@/lib/install-calendar'
import { loadTradeWithJob } from '@/lib/job-trade-calendar'
import { missingRequiredPhotoTags } from '@/lib/final-photo-tags'
import { JOB_TRADE_COLUMNS, crewLinkUrl, installDaysOrDefault, isTrade, sortTrades, type JobTradeRow } from '@/lib/job-trades'
import { addManualTrade, ensureJobTrades, syncJobScheduleFromTrades } from '@/lib/job-trades-db'

type AuthCtx = { authUser: { id: string }; profile: { id: string; org_id: string; role: string; custom_role_id?: string | null } }

async function authorize(): Promise<AuthCtx | null> {
  try {
    const ctx = await requireAuthApi()
    return { authUser: ctx.authUser, profile: ctx.profile as AuthCtx['profile'] }
  } catch {
    return null
  }
}

/**
 * GET /api/ops/jobs/[id]/trades
 *
 * The job's crews, one row per trade, with the sub, schedule, completion state,
 * how many of the 4 required photos are in, and the crew photo link. Creates
 * the job's automatic trades first (idempotent — see `ensureJobTrades`).
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const ctx = await authorize()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createServiceClient()
  const { canJobBoard, canEditJobs } = await resolveOpsAccess(admin, ctx.authUser.id, ctx.profile)
  if (!canJobBoard) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const orgId = ctx.profile.org_id
  const { data: job } = await admin
    .from('production_jobs')
    .select('id')
    .eq('id', params.id)
    .eq('org_id', orgId)
    .maybeSingle()
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  // Adoption copies the job's own sub/date onto its primary trade, so the
  // job-level columns already agree — no status write on a read.
  await ensureJobTrades(admin, orgId, [job.id])

  const { data: tradesData, error } = await admin
    .from('work_orders')
    .select(JOB_TRADE_COLUMNS)
    .eq('org_id', orgId)
    .eq('job_id', job.id)
    .not('trade', 'is', null)
    .neq('status', 'cancelled')
  if (error) {
    console.error('[job trades GET]', error)
    return NextResponse.json({ error: 'Failed to load trades' }, { status: 500 })
  }
  const trades = sortTrades((tradesData || []) as JobTradeRow[])

  const subIds = Array.from(new Set(trades.map((t) => t.assigned_sub_id).filter(Boolean))) as string[]
  const tradeIds = trades.map((t) => t.id)
  const [{ data: subs }, { data: photos }] = await Promise.all([
    subIds.length
      ? admin
          .from('sub_contractors')
          .select('id, company_name, phone, scheduling_email')
          .eq('org_id', orgId)
          .in('id', subIds)
      : Promise.resolve({ data: [] }),
    tradeIds.length
      ? admin
          .from('photos')
          .select('work_order_id, photo_tag')
          .eq('org_id', orgId)
          .eq('job_id', job.id)
          .in('work_order_id', tradeIds)
          .is('deleted_at', null)
      : Promise.resolve({ data: [] }),
  ])
  const subById = new Map(
    ((subs || []) as { id: string; company_name: string; phone: string | null; scheduling_email: string | null }[]).map(
      (s) => [s.id, s]
    )
  )
  const tagsByTrade = new Map<string, string[]>()
  for (const p of (photos || []) as { work_order_id: string; photo_tag: string | null }[]) {
    const list = tagsByTrade.get(p.work_order_id) ?? []
    if (p.photo_tag) list.push(p.photo_tag)
    tagsByTrade.set(p.work_order_id, list)
  }

  return NextResponse.json({
    canEdit: canEditJobs,
    trades: trades.map((t) => {
      const tags = tagsByTrade.get(t.id) ?? []
      const sub = t.assigned_sub_id ? subById.get(t.assigned_sub_id) ?? null : null
      return {
        id: t.id,
        work_order_number: t.work_order_number,
        trade: t.trade,
        trade_source: t.trade_source,
        status: t.status,
        scheduled_date: t.scheduled_date,
        scheduled_time_start: t.scheduled_time_start,
        install_days: t.scheduled_date ? installDaysOrDefault(t.install_days) : null,
        completed_at: t.completed_at,
        sub: sub
          ? { id: sub.id, company_name: sub.company_name, phone: sub.phone, has_scheduling_email: Boolean(sub.scheduling_email) }
          : null,
        calendar_sync_error: t.install_sync_failed_at ? t.install_sync_error : null,
        has_calendar_event: Boolean(t.install_google_event_id),
        missing_photo_tags: missingRequiredPhotoTags(tags),
        photo_count: tags.length,
        crew_link_url: t.crew_link_token ? crewLinkUrl(t.crew_link_token) : null,
      }
    }),
  })
}

/** POST /api/ops/jobs/[id]/trades — body: { trade } — add a trade by hand. */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const ctx = await authorize()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createServiceClient()
  const { canEditJobs } = await resolveOpsAccess(admin, ctx.authUser.id, ctx.profile)
  if (!canEditJobs) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = (await request.json().catch(() => null)) as { trade?: unknown } | null
  const trade = body?.trade
  if (!isTrade(trade)) {
    return NextResponse.json({ error: 'trade must be roofing, gutters, siding, windows or other' }, { status: 400 })
  }

  const result = await addManualTrade(admin, ctx.profile.org_id, params.id, trade, ctx.profile.id)
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ trade: result.trade })
}

/**
 * PATCH /api/ops/jobs/[id]/trades
 * body: { workOrderId, action: 'complete' | 'reopen' | 'remove', override? }
 *
 * - complete: the crew's portion is done. Needs the 4 required photos for THIS
 *   trade unless `override: true` (ops vouches for it). Never completes the JOB —
 *   that stays a manual step because 'complete' starts payroll.
 * - reopen: undo a completion.
 * - remove: take the trade off the job — cancels its invite and link. Kept as a
 *   cancelled row so an automatic trade isn't re-created on the next load.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const ctx = await authorize()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createServiceClient()
  const { canEditJobs } = await resolveOpsAccess(admin, ctx.authUser.id, ctx.profile)
  if (!canEditJobs) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = (await request.json().catch(() => null)) as
    | { workOrderId?: unknown; action?: unknown; override?: unknown }
    | null
  if (typeof body?.workOrderId !== 'string' || !body.workOrderId) {
    return NextResponse.json({ error: 'workOrderId is required' }, { status: 400 })
  }
  const action = body.action
  if (action !== 'complete' && action !== 'reopen' && action !== 'remove') {
    return NextResponse.json({ error: 'action must be complete, reopen or remove' }, { status: 400 })
  }

  const orgId = ctx.profile.org_id
  const loaded = await loadTradeWithJob(admin, orgId, body.workOrderId)
  if (!loaded || loaded.job.id !== params.id) {
    return NextResponse.json({ error: 'Trade not found' }, { status: 404 })
  }
  const { trade, job } = loaded
  if (trade.status === 'cancelled') {
    return NextResponse.json({ error: 'This trade was removed' }, { status: 400 })
  }

  let update: Record<string, unknown>
  let calendarWarning: string | null = null

  if (action === 'complete') {
    if (trade.status === 'completed') return NextResponse.json({ ok: true })
    if (body.override !== true) {
      const { data: photos } = await admin
        .from('photos')
        .select('photo_tag')
        .eq('org_id', orgId)
        .eq('job_id', job.id)
        .eq('work_order_id', trade.id)
        .is('deleted_at', null)
      const missing = missingRequiredPhotoTags(((photos || []) as { photo_tag: string | null }[]).map((p) => p.photo_tag))
      if (missing.length > 0) {
        return NextResponse.json(
          { error: 'Required photos are missing for this trade', missingPhotoTags: missing },
          { status: 409 }
        )
      }
    }
    update = { status: 'completed', completed_at: new Date().toISOString(), completed_by: ctx.profile.id }
  } else if (action === 'reopen') {
    if (trade.status !== 'completed') return NextResponse.json({ ok: true })
    update = {
      status: trade.scheduled_date && trade.assigned_sub_id ? 'scheduled' : 'pending',
      completed_at: null,
      completed_by: null,
    }
  } else {
    if (trade.status === 'completed') {
      return NextResponse.json({ error: 'Reopen a completed trade before removing it' }, { status: 400 })
    }
    update = {
      status: 'cancelled',
      scheduled_date: null,
      install_days: null,
      assigned_sub_id: null,
      crew_link_token: null,
    }
  }

  const { error } = await admin.from('work_orders').update(update).eq('id', trade.id).eq('org_id', orgId)
  if (error) {
    console.error('[job trades PATCH]', action, error)
    return NextResponse.json({ error: 'Failed to update trade' }, { status: 500 })
  }

  // Only after the trade is actually off the job: the sub is emailed a
  // cancellation here, which must never happen for a trade that still stands.
  // `trade` was read before the update, so it still carries the event ids.
  if (action === 'remove') {
    const removal = await removeInstallFromCalendar(admin, { trade, schedulingUserId: ctx.authUser.id })
    calendarWarning = removal.warning ?? null
  }

  const derived = await syncJobScheduleFromTrades(admin, orgId, job.id, {
    revertToMaterials: action === 'remove',
  })
  return NextResponse.json({ ok: true, jobStatus: derived?.status ?? job.status, calendarWarning })
}
