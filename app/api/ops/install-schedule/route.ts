import { NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { resolveOpsAccess } from '@/lib/ops-access'
import {
  enrichOpsJobsWithMeasureSoldSquaresFallback,
  enrichOpsJobsWithSoldSquares,
} from '@/lib/ops-board-sold-squares'

/** Board window cap — matches the "cap at 90 days" instruction; keeps the query bounded on a live table. */
const MAX_WINDOW_DAYS = 90

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function isValidDateString(value: unknown): value is string {
  return typeof value === 'string' && DATE_RE.test(value)
}

/** Inclusive day count between two `YYYY-MM-DD` strings, computed on the date parts only (no `Date`/TZ round-trip). */
function daysBetweenDateOnly(startStr: string, endStr: string): number {
  const [sy, sm, sd] = startStr.split('-').map(Number)
  const [ey, em, ed] = endStr.split('-').map(Number)
  // UTC constructors here are safe: both sides are built the same way purely to diff two
  // calendar dates, and the result is discarded as soon as we have a day count — no calendar
  // date is ever read back out of these Date objects.
  const startUtc = Date.UTC(sy, (sm || 1) - 1, sd || 1)
  const endUtc = Date.UTC(ey, (em || 1) - 1, ed || 1)
  return Math.round((endUtc - startUtc) / 86_400_000)
}

/** Job columns the install-schedule board needs, plus what `enrichOpsJobsWith*SoldSquares` require to resolve squares. */
const INSTALL_SCHEDULE_JOB_COLUMNS = `
  id,
  job_number,
  status,
  job_type,
  address_text,
  scheduled_date,
  install_days,
  assigned_sub_id,
  sale_date,
  created_at,
  project_id,
  accepted_proposal_id,
  linked_proposal_id,
  customer:customers(id, name),
  project:projects(sold_roof_squares, opportunity_id)
`

type InstallScheduleJobRow = {
  id: string
  job_number: string
  status: string
  job_type: string
  address_text: string | null
  scheduled_date: string | null
  install_days: number | null
  assigned_sub_id: string | null
  sale_date: string | null
  created_at: string
  project_id: string | null
  accepted_proposal_id?: string | null
  linked_proposal_id?: string | null
  customer?: { id: string; name: string | null } | { id: string; name: string | null }[] | null
  project?: { sold_roof_squares?: number | null; opportunity_id?: string | null } | { sold_roof_squares?: number | null; opportunity_id?: string | null }[] | null
  sold_squares?: number | null
}

function customerName(row: InstallScheduleJobRow): string | null {
  const c = row.customer
  const one = Array.isArray(c) ? c[0] : c
  return one?.name ?? null
}

/**
 * GET /api/ops/install-schedule?start=YYYY-MM-DD&end=YYYY-MM-DD
 *
 * Everything the install-schedule board needs in one call: active subs (the
 * assignment options), jobs already scheduled inside the window, and the
 * unscheduled holding queue (sold/materials jobs with no scheduled_date yet,
 * oldest first) so ops can drag them onto the board.
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

  const { searchParams } = new URL(request.url)
  const start = searchParams.get('start')
  const end = searchParams.get('end')

  if (!isValidDateString(start) || !isValidDateString(end)) {
    return NextResponse.json(
      { error: 'start and end are required as YYYY-MM-DD' },
      { status: 400 }
    )
  }
  if (end < start) {
    return NextResponse.json({ error: 'end must not be before start' }, { status: 400 })
  }
  const windowDays = daysBetweenDateOnly(start, end)
  if (windowDays > MAX_WINDOW_DAYS) {
    return NextResponse.json(
      { error: `Window too large — max ${MAX_WINDOW_DAYS} days` },
      { status: 400 }
    )
  }

  const orgId = profile.org_id

  const [subsRes, scheduledRes, unscheduledRes] = await Promise.all([
    adminClient
      .from('sub_contractors')
      .select('id, company_name, services, scheduling_email, phone')
      .eq('org_id', orgId)
      .eq('active', true)
      .order('company_name'),
    adminClient
      .from('production_jobs')
      .select(INSTALL_SCHEDULE_JOB_COLUMNS)
      .eq('org_id', orgId)
      .not('scheduled_date', 'is', null)
      .not('assigned_sub_id', 'is', null)
      .gte('scheduled_date', start)
      .lte('scheduled_date', end)
      .order('scheduled_date', { ascending: true }),
    adminClient
      .from('production_jobs')
      .select(INSTALL_SCHEDULE_JOB_COLUMNS)
      .eq('org_id', orgId)
      .in('status', ['sold', 'materials'])
      .is('scheduled_date', null)
      .order('sale_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true }),
  ])

  if (subsRes.error) {
    console.error('[install-schedule GET] subs:', subsRes.error)
    return NextResponse.json({ error: 'Failed to load subcontractors' }, { status: 500 })
  }
  if (scheduledRes.error) {
    console.error('[install-schedule GET] scheduled:', scheduledRes.error)
    return NextResponse.json({ error: 'Failed to load scheduled jobs' }, { status: 500 })
  }
  if (unscheduledRes.error) {
    console.error('[install-schedule GET] unscheduled:', unscheduledRes.error)
    return NextResponse.json({ error: 'Failed to load unscheduled jobs' }, { status: 500 })
  }

  const scheduledJobs = (scheduledRes.data || []) as InstallScheduleJobRow[]
  const unscheduledJobs = (unscheduledRes.data || []) as InstallScheduleJobRow[]

  // Reuse the board's existing squares resolution instead of re-deriving it here
  // (lib/ops-board-sold-squares.ts — see CLAUDE.md Tesla Algorithm: don't rebuild
  // something that already exists).
  await enrichOpsJobsWithSoldSquares(adminClient, orgId, scheduledJobs)
  await enrichOpsJobsWithMeasureSoldSquaresFallback(adminClient, orgId, scheduledJobs)
  await enrichOpsJobsWithSoldSquares(adminClient, orgId, unscheduledJobs)
  await enrichOpsJobsWithMeasureSoldSquaresFallback(adminClient, orgId, unscheduledJobs)

  return NextResponse.json({
    subs: subsRes.data ?? [],
    scheduled: scheduledJobs.map((row) => ({
      id: row.id,
      job_number: row.job_number,
      customer_name: customerName(row),
      address_text: row.address_text,
      scheduled_date: row.scheduled_date,
      install_days: row.install_days,
      assigned_sub_id: row.assigned_sub_id,
      status: row.status,
      job_type: row.job_type,
      total_squares: row.sold_squares ?? null,
    })),
    unscheduled: unscheduledJobs.map((row) => ({
      id: row.id,
      job_number: row.job_number,
      customer_name: customerName(row),
      address_text: row.address_text,
      status: row.status,
      job_type: row.job_type,
      total_squares: row.sold_squares ?? null,
      sold_at: row.sale_date ?? row.created_at,
    })),
  })
}
