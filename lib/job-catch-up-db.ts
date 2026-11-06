/**
 * Database side of job catch-up (lib/job-catch-up.ts is the rule). Server only.
 *
 * Batched for the board: a fixed number of queries whatever the job count (no per-job query) —
 * `lib/__tests__/job-catch-up-db.test.ts` counts them. Every thread row goes through `visibleActivities`
 * (the service client skips RLS), so catch-up never shows a note the viewer can't already read.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { loadDataHealth, shapeNeedsYou, type HealthProblem } from '@/lib/data-health'
import { deriveMaterialsState } from '@/lib/job-materials-state'
import { paymentStatusChip } from '@/lib/job-status'
import { sumCollectedCents } from '@/lib/job-collection'
import { ACTIVITY_WINDOW_DAYS, readJobCatchUpSettings, type JobCatchUpSettings } from '@/lib/job-catch-up-settings'
import {
  buildJobCatchUp,
  type CatchUpEvent,
  type CatchUpJob,
  type CatchUpNote,
  type CatchUpTrade,
  type JobCatchUpResult,
} from '@/lib/job-catch-up'
import { selectAll, selectIn } from '@/lib/supabase/paged-select'
import { effectiveOrigin } from '@/lib/threads/get-thread'
import { visibleActivities } from '@/lib/threads/legacy-feed'
import { looksLikePricing, type Audience } from '@/lib/threads/visibility'
import type { ViewerProfile } from '@/lib/threads/viewer'

export async function loadJobCatchUpSettings(admin: SupabaseClient, orgId: string): Promise<JobCatchUpSettings> {
  const { data } = await admin.from('orgs').select('settings').eq('id', orgId).maybeSingle()
  return readJobCatchUpSettings((data as { settings?: unknown } | null)?.settings)
}

const JOB_COLUMNS =
  'id, status, project_id, customer_id, scheduled_date, materials_status, permit_required, permit_status, sale_date, materials_ordered_at, started_at, completed_at, cancelled_at, created_at, updated_at, sale_amount, allow_close_with_balance, close_balance_by'

type JobRow = CatchUpJob & {
  project_id: string | null
  customer_id: string | null
  materials_status: string | null
  sale_amount: number | null
  allow_close_with_balance: boolean | null
  close_balance_by: string | null
}

type ActivityRow = {
  id: string
  opportunity_id: string | null
  user_id: string | null
  type: string
  body: string | null
  created_at: string
  audience: Audience | null
  restricted_pricing: boolean | null
  origin: string | null
  deleted_at: string | null
  users?: { full_name: string | null } | { full_name: string | null }[] | null
}

function groupBy<T>(rows: T[], key: (r: T) => string | null | undefined): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const r of rows) {
    const k = key(r)
    if (!k) continue
    const list = m.get(k) ?? []
    list.push(r)
    m.set(k, list)
  }
  return m
}

/**
 * Catch-up for each job id the caller already decided the viewer may see (board / job page gate). `showPayment` is
 * true only where the viewer already sees "Paid / Unpaid" today (board chip; job page billing).
 */
export async function loadJobCatchUps(
  admin: SupabaseClient,
  orgId: string,
  viewer: ViewerProfile,
  jobIds: string[],
  opts: { stuckDays: number; showPayment: boolean; now?: Date }
): Promise<Map<string, JobCatchUpResult>> {
  const out = new Map<string, JobCatchUpResult>()
  const ids = Array.from(new Set(jobIds.filter(Boolean)))
  if (ids.length === 0) return out
  const now = opts.now ?? new Date()

  const jobs = await selectIn<JobRow>(ids, (chunk) => admin.from('production_jobs').select(JOB_COLUMNS).eq('org_id', orgId).in('id', chunk))
  if (jobs.length === 0) return out
  const jobIdsFound = jobs.map((j) => j.id)
  const projectIds = Array.from(new Set(jobs.map((j) => j.project_id).filter((v): v is string => !!v)))

  const [health, trades, projects, supplierOrders, payments] = await Promise.all([
    loadDataHealth(admin, orgId, { jobIds: jobIdsFound, includeAppointments: false, now }),
    selectIn<CatchUpTrade & { job_id: string; assigned_sub?: { company_name: string | null } | { company_name: string | null }[] | null }>(jobIdsFound, (chunk) =>
      admin
        .from('work_orders')
        .select('job_id, trade, status, scheduled_date, install_days, created_at, updated_at, completed_at, assigned_sub:sub_contractors(company_name)')
        .eq('org_id', orgId)
        .not('trade', 'is', null)
        .in('job_id', chunk)
    ),
    selectIn<{ id: string; opportunity_id: string | null }>(projectIds, (chunk) => admin.from('projects').select('id, opportunity_id').eq('org_id', orgId).in('id', chunk)),
    selectIn<{ job_id: string; status: string; last_sent_at: string | null; received_at: string | null }>(jobIdsFound, (chunk) =>
      admin.from('supplier_orders').select('job_id, status, last_sent_at, received_at').eq('org_id', orgId).in('job_id', chunk)
    ),
    selectIn<{ job_id: string; amount_cents: number; funding_status: string | null; created_at: string | null }>(jobIdsFound, (chunk) =>
      admin.from('job_payments').select('job_id, amount_cents, funding_status, created_at').in('job_id', chunk)
    ),
  ])

  // Needs-you, ops view: the same rows an ops person sees on the dashboard — none carries a dollar amount.
  const shaped = shapeNeedsYou(health, 'ops')
  const problemsByJob = new Map<string, HealthProblem[]>((shaped?.jobs ?? []).map((j) => [j.jobId, j.problems]))

  const oppByProject = new Map(projects.map((p) => [p.id, p.opportunity_id]))
  const dealIds = Array.from(new Set(Array.from(oppByProject.values()).filter((v): v is string => !!v)))
  const sinceIso = new Date(now.getTime() - ACTIVITY_WINDOW_DAYS * 86_400_000).toISOString()
  const rawActivities: ActivityRow[] = []
  for (let i = 0; i < dealIds.length; i += 200) {
    const chunk = dealIds.slice(i, i + 200)
    rawActivities.push(
      ...(await selectAll<ActivityRow>((from, to) =>
        admin
          .from('activities')
          .select('id, opportunity_id, user_id, type, body, created_at, audience, restricted_pricing, origin, deleted_at, users(full_name)')
          .eq('org_id', orgId)
          .in('opportunity_id', chunk)
          .is('deleted_at', null)
          .gte('created_at', sinceIso)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .range(from, to)
      ))
    )
  }
  // The thread's own rule for who reads what. Sales talk stays out of catch-up (ops sees it only behind "Sales history").
  const visible = (await visibleActivities(admin, viewer, rawActivities)).filter((r) => r.audience !== 'sales')
  const notesByDeal = groupBy(visible, (r) => r.opportunity_id)

  const tradesByJob = groupBy(trades, (t) => t.job_id)
  const ordersByJob = groupBy(supplierOrders, (o) => o.job_id)
  const paymentsByJob = groupBy(payments, (p) => p.job_id)

  for (const job of jobs) {
    const dealId = job.project_id ? oppByProject.get(job.project_id) ?? null : null
    const jobTrades: CatchUpTrade[] = (tradesByJob.get(job.id) ?? []).map((t) => {
      const sub = Array.isArray(t.assigned_sub) ? t.assigned_sub[0] : t.assigned_sub
      return { trade: t.trade, status: t.status, scheduled_date: t.scheduled_date, install_days: t.install_days, sub_name: sub?.company_name ?? null, created_at: t.created_at, updated_at: t.updated_at, completed_at: t.completed_at }
    })
    const jobPayments = paymentsByJob.get(job.id) ?? []
    const events: CatchUpEvent[] = []
    for (const o of ordersByJob.get(job.id) ?? []) {
      if (o.last_sent_at) events.push({ at: o.last_sent_at, what: 'Supplier order sent' })
      if (o.received_at) events.push({ at: o.received_at, what: 'Materials received' })
    }
    for (const p of jobPayments) if (p.created_at) events.push({ at: p.created_at, what: 'Payment recorded' })

    const notes: CatchUpNote[] = (dealId ? notesByDeal.get(dealId) ?? [] : []).map((r) => {
      const u = Array.isArray(r.users) ? r.users[0] : r.users
      const body = r.body ?? ''
      return {
        id: r.id,
        at: r.created_at,
        who: u?.full_name ?? null,
        type: r.type,
        // No dollar amounts in catch-up: a pricing-flagged or pricing-looking note is named, never quoted.
        text: r.restricted_pricing || looksLikePricing(body) ? null : body,
        human: effectiveOrigin({ origin: r.origin, type: r.type, user_id: r.user_id }) === 'human',
      }
    })

    const chip = opts.showPayment
      ? paymentStatusChip({ sale_amount: job.sale_amount, collected_cents: sumCollectedCents(jobPayments), allow_close_with_balance: job.allow_close_with_balance, close_balance_by: job.close_balance_by })
      : null

    const catchUp = buildJobCatchUp({
      job,
      trades: jobTrades,
      materials: deriveMaterialsState({ stored: job.materials_status }),
      payment: chip?.label ?? null,
      problems: problemsByJob.get(job.id) ?? [],
      events,
      notes,
      stuckDays: opts.stuckDays,
      now,
    })
    out.set(job.id, { ...catchUp, jobId: job.id, threadHref: dealId && job.customer_id ? `/c/${job.customer_id}/d/${dealId}/notes` : null })
  }
  return out
}

/**
 * Board + GET /api/ops/jobs: when the org has catch-up on, attach `catch_up` to each OPEN job (collected / cancelled
 * are history). When it is off this reads one settings row and changes nothing, so the board renders exactly as before.
 */
export async function attachBoardCatchUps<T extends { id: string; status?: unknown }>(
  admin: SupabaseClient,
  orgId: string,
  viewer: ViewerProfile,
  jobs: T[],
  now?: Date
): Promise<{ enabled: boolean; stuckDays: number; failed: boolean }> {
  const settings = await loadJobCatchUpSettings(admin, orgId)
  if (!settings.enabled) return { ...settings, failed: false }
  const open = jobs.filter((j) => j.status !== 'collected' && j.status !== 'cancelled')
  try {
    // The board already shows the Paid / Unpaid chip to everyone who can open it, so the words add nothing new.
    const byJob = await loadJobCatchUps(admin, orgId, viewer, open.map((j) => j.id), { stuckDays: settings.stuckDays, showPayment: true, now })
    for (const j of open) {
      const c = byJob.get(j.id)
      if (c) (j as T & { catch_up?: JobCatchUpResult }).catch_up = c
    }
    return { ...settings, failed: false }
  } catch (error) {
    // Never take the board down for a summary line; the board says it couldn't load instead of looking "all clear".
    console.error('[job-catch-up] board load failed', error)
    return { ...settings, failed: true }
  }
}
