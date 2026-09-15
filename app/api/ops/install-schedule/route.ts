import { NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { resolveOpsAccess } from '@/lib/ops-access'
import { parseScheduleWindow } from '@/lib/schedule-window'
import { addDaysToDateOnly } from '@/lib/install-calendar'
import { installDaysOrDefault, sortTrades, type Trade } from '@/lib/job-trades'
import { ensureJobTrades } from '@/lib/job-trades-db'
import {
  enrichOpsJobsWithMeasureSoldSquaresFallback,
  enrichOpsJobsWithSoldSquares,
} from '@/lib/ops-board-sold-squares'

/** Job columns the board needs, plus what `enrichOpsJobsWith*SoldSquares` require to resolve squares. */
const BOARD_JOB_COLUMNS = `
  id,
  job_number,
  status,
  job_type,
  address_text,
  sale_date,
  created_at,
  cancelled_at,
  project_id,
  accepted_proposal_id,
  linked_proposal_id,
  customer:customers(id, name),
  project:projects(sold_roof_squares, opportunity_id)
`

type BoardJobRow = {
  id: string
  job_number: string
  status: string
  job_type: string
  address_text: string | null
  sale_date: string | null
  created_at: string
  cancelled_at: string | null
  project_id: string | null
  accepted_proposal_id?: string | null
  linked_proposal_id?: string | null
  customer?: { id: string; name: string | null } | { id: string; name: string | null }[] | null
  project?: unknown
  sold_squares?: number | null
}

type BoardTradeRow = {
  id: string
  job_id: string
  trade: Trade
  status: string
  assigned_sub_id: string | null
  scheduled_date: string | null
  scheduled_time_start: string | null
  install_days: number | string | null
  created_at: string
}

const BOARD_TRADE_COLUMNS =
  'id, job_id, trade, status, assigned_sub_id, scheduled_date, scheduled_time_start, install_days, created_at'

/** Jobs whose crews still need scheduling. */
const OPEN_JOB_STATUSES = ['sold', 'materials', 'scheduled', 'in_progress']

function customerName(row: BoardJobRow): string | null {
  const c = row.customer
  const one = Array.isArray(c) ? c[0] : c
  return one?.name ?? null
}

/**
 * GET /api/ops/install-schedule?start=YYYY-MM-DD&end=YYYY-MM-DD
 *
 * Everything the install-schedule board needs in one call: active subs (the
 * rows), TRADES already scheduled inside the window (one chip per crew — a job
 * with roofing, gutters and siding is three chips), and the holding queue of
 * trades on open jobs that have no date yet, oldest sale first.
 */
export async function GET(request: Request) {
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
  const { canJobBoard } = await resolveOpsAccess(adminClient, authUser.id, profile)
  if (!canJobBoard) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const parsed = parseScheduleWindow(new URL(request.url).searchParams)
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }
  const { start, end } = parsed.window
  // A 2-day crew that started the day before the window still occupies its first column.
  const lookbackStart = addDaysToDateOnly(start, -1)

  const orgId = profile.org_id

  // Trades are created lazily from each job's current assignment (see
  // ensureJobTrades) — do it for every job the board could show before reading.
  const [{ data: openJobs }, { data: windowJobs }] = await Promise.all([
    adminClient
      .from('production_jobs')
      .select('id')
      .eq('org_id', orgId)
      .in('status', OPEN_JOB_STATUSES)
      .is('cancelled_at', null),
    adminClient
      .from('production_jobs')
      .select('id')
      .eq('org_id', orgId)
      .gte('scheduled_date', lookbackStart)
      .lte('scheduled_date', end),
  ])
  await ensureJobTrades(
    adminClient,
    orgId,
    [...(openJobs || []), ...(windowJobs || [])].map((j: { id: string }) => j.id)
  )

  const [subsRes, scheduledRes, openTradesRes] = await Promise.all([
    adminClient
      .from('sub_contractors')
      .select('id, company_name, services, scheduling_email, phone')
      .eq('org_id', orgId)
      .eq('active', true)
      .order('company_name'),
    adminClient
      .from('work_orders')
      .select(BOARD_TRADE_COLUMNS)
      .eq('org_id', orgId)
      .not('trade', 'is', null)
      .not('job_id', 'is', null)
      .not('assigned_sub_id', 'is', null)
      .neq('status', 'cancelled')
      .gte('scheduled_date', lookbackStart)
      .lte('scheduled_date', end),
    adminClient
      .from('work_orders')
      .select(BOARD_TRADE_COLUMNS)
      .eq('org_id', orgId)
      .not('trade', 'is', null)
      .not('job_id', 'is', null)
      .eq('status', 'pending')
      .is('scheduled_date', null),
  ])

  if (subsRes.error) {
    console.error('[install-schedule GET] subs:', subsRes.error)
    return NextResponse.json({ error: 'Failed to load subcontractors' }, { status: 500 })
  }
  if (scheduledRes.error || openTradesRes.error) {
    console.error('[install-schedule GET] trades:', scheduledRes.error || openTradesRes.error)
    return NextResponse.json({ error: 'Failed to load scheduled trades' }, { status: 500 })
  }

  const scheduledTrades = ((scheduledRes.data || []) as BoardTradeRow[]).filter(
    // The lookback only exists for 2-calendar-day crews.
    (t) => (t.scheduled_date as string) >= start || installDaysOrDefault(t.install_days) > 1
  )
  const pendingTrades = (openTradesRes.data || []) as BoardTradeRow[]

  const jobIds = Array.from(new Set([...scheduledTrades, ...pendingTrades].map((t) => t.job_id)))
  const { data: jobsData, error: jobsError } = jobIds.length
    ? await adminClient.from('production_jobs').select(BOARD_JOB_COLUMNS).eq('org_id', orgId).in('id', jobIds)
    : { data: [], error: null }
  if (jobsError) {
    console.error('[install-schedule GET] jobs:', jobsError)
    return NextResponse.json({ error: 'Failed to load jobs' }, { status: 500 })
  }
  const jobs = (jobsData || []) as BoardJobRow[]

  // Reuse the board's existing squares resolution instead of re-deriving it here.
  await enrichOpsJobsWithSoldSquares(adminClient, orgId, jobs)
  await enrichOpsJobsWithMeasureSoldSquaresFallback(adminClient, orgId, jobs)
  const jobById = new Map(jobs.map((j) => [j.id, j]))

  const scheduled = scheduledTrades.flatMap((t) => {
    const job = jobById.get(t.job_id)
    if (!job || job.cancelled_at) return []
    return [
      {
        id: t.id,
        job_id: job.id,
        job_number: job.job_number,
        trade: t.trade,
        customer_name: customerName(job),
        address_text: job.address_text,
        scheduled_date: t.scheduled_date,
        scheduled_time_start: t.scheduled_time_start,
        install_days: installDaysOrDefault(t.install_days),
        assigned_sub_id: t.assigned_sub_id,
        status: t.status,
        job_status: job.status,
        total_squares: t.trade === 'roofing' ? job.sold_squares ?? null : null,
      },
    ]
  })

  const unscheduled = sortTrades(pendingTrades).flatMap((t) => {
    const job = jobById.get(t.job_id)
    if (!job || job.cancelled_at || !OPEN_JOB_STATUSES.includes(job.status)) return []
    return [
      {
        id: t.id,
        job_id: job.id,
        job_number: job.job_number,
        trade: t.trade,
        customer_name: customerName(job),
        address_text: job.address_text,
        job_status: job.status,
        total_squares: t.trade === 'roofing' ? job.sold_squares ?? null : null,
        sold_at: job.sale_date ?? job.created_at,
      },
    ]
  })

  return NextResponse.json({ subs: subsRes.data ?? [], scheduled, unscheduled })
}
