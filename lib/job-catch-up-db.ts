/**
 * Database side of job catch-up (lib/job-catch-up.ts is the rule). Server only.
 *
 * Batched for the board: a fixed number of queries whatever the job count — except each pre-install job's materials
 * answer, read exactly as its Materials tab reads it — `lib/__tests__/job-catch-up-db.test.ts` counts them. Every thread row goes through `visibleActivities`
 * (the service client skips RLS), so catch-up never shows a note the viewer can't already read.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { isMissingColumn } from '@/lib/supabase/errors'

import { loadDataHealthWithRows, shapeNeedsYou, type HealthProblem } from '@/lib/data-health'
import { deriveMaterialsState, type MaterialsState } from '@/lib/job-materials-state'
import { paymentStatusChip } from '@/lib/job-status'
import { sumCollectedCents } from '@/lib/job-collection'
import { collectionInvoiceFields, type JobInvoiceFacts } from '@/lib/job-invoice-tax'
import { ACTIVITY_WINDOW_DAYS, readJobCatchUpSettings, type JobCatchUpSettings } from '@/lib/job-catch-up-settings'
import {
  CUSTOMER_CONTACT_TYPES,
  buildJobCatchUp,
  type CatchUpEvent,
  type CatchUpJob,
  type CatchUpNote,
  type CatchUpTrade,
  type JobCatchUpResult,
} from '@/lib/job-catch-up'
import { loadOrgTrades, tradeLabel } from '@/lib/org-trades'
import { fetchSupabaseAllPages, selectIn } from '@/lib/supabase-fetch-all-pages'
import { effectiveOrigin } from '@/lib/threads/get-thread'
import { visibleActivities } from '@/lib/threads/legacy-feed'
import { looksLikePricing, type Audience } from '@/lib/threads/visibility'
import type { ViewerProfile } from '@/lib/threads/viewer'

export async function loadJobCatchUpSettings(admin: SupabaseClient, orgId: string): Promise<JobCatchUpSettings> {
  const { data } = await admin.from('orgs').select('settings').eq('id', orgId).maybeSingle()
  return readJobCatchUpSettings((data as { settings?: unknown } | null)?.settings)
}

/** Statuses whose next step can be "order materials" — only these need the supplier-plan answer. */
const MATERIALS_STEP_STATUSES = new Set(['sold', 'materials', 'scheduled'])
/** Supplier-plan loads run this many at a time. */
const MATERIALS_CONCURRENCY = 4
/** Most jobs that get the Materials tab's full answer per board load; beyond this the recorded status is used. */
const MATERIALS_MAX_JOBS = 25

/**
 * Seams. `materialsState` is the Materials tab's own answer (lib/supplier-orders.ts `loadJobMaterialsState`), loaded
 * lazily so this module doesn't pull the supplier PDF code into every importer.
 */
export const jobCatchUpDeps = {
  materialsState: async (admin: SupabaseClient, orgId: string, jobId: string, stored: string | null): Promise<MaterialsState> =>
    (await import('@/lib/supplier-orders')).loadJobMaterialsState(admin, orgId, jobId, stored),
}

const BASE_JOB_COLUMNS =
  'id, status, project_id, customer_id, scheduled_date, materials_status, permit_required, permit_status, sale_date, materials_ordered_at, finance_submitted_at, started_at, completed_at, close_balance_at, cancelled_at, created_at, updated_at, sale_amount, allow_close_with_balance, close_balance_by'
/** Added by migration 202611060020 (applied after merge); until then the column is missing and treated as null. */
export const JOB_OWNER_COLUMN = 'owner_user_id'

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

/** The owner column isn't there yet (migration not applied). One home: lib/supabase/errors.ts. */
export { isMissingColumn }

/**
 * Read jobs with their explicit owner. Before the owner migration is applied the column doesn't exist: read again
 * without it and `owner_user_id` is UNDEFINED (unknown — no "No owner" flag), never an error.
 */
export async function selectJobsWithOwner<T extends { id: string }>(
  admin: SupabaseClient,
  orgId: string,
  ids: string[],
  columns: string
): Promise<Array<T & { owner_user_id?: string | null }>> {
  try {
    return await selectIn<T & { owner_user_id?: string | null }>(ids, (chunk) =>
      admin.from('production_jobs').select(`${columns}, ${JOB_OWNER_COLUMN}`).eq('org_id', orgId).in('id', chunk)
    )
  } catch (error) {
    if (!isMissingColumn(error as { code?: string; message?: string }, JOB_OWNER_COLUMN)) throw error
    const rows = await selectIn<T>(ids, (chunk) => admin.from('production_jobs').select(columns).eq('org_id', orgId).in('id', chunk))
    return rows.map((r) => ({ ...r, owner_user_id: undefined }))
  }
}

/** Who wrote a thread row, as catch-up tells it apart. */
export function noteSource(r: Pick<ActivityRow, 'origin' | 'type' | 'user_id'>): CatchUpNote['from'] {
  if (CUSTOMER_CONTACT_TYPES.has(r.type)) {
    if (r.user_id) return 'person'
    return r.origin === 'system' ? 'automated' : 'customer'
  }
  return effectiveOrigin(r) === 'human' && !!r.user_id ? 'person' : 'automated'
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

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null)

/**
 * Catch-up for each job id the caller already decided the viewer may see (board / job page gate). `showPayment` is
 * true only where the viewer already sees "Paid / Unpaid" today (board chip; job page billing) — payment words AND
 * "Payment recorded" events both depend on it.
 *
 * Query count is fixed whatever the job count, except the materials answer: a job in sold / materials / scheduled reads
 * its supplier plan exactly as the Materials tab does (that answer needs the job's own order lines, which only the
 * run sheet builds; batching it would be a second run-sheet implementation).
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
  const sinceIso = new Date(now.getTime() - ACTIVITY_WINDOW_DAYS * 86_400_000).toISOString()

  const jobs = await selectJobsWithOwner<JobRow>(admin, orgId, ids, BASE_JOB_COLUMNS)
  if (jobs.length === 0) return out
  const jobIdsFound = jobs.map((j) => j.id)
  const projectIds = Array.from(new Set(jobs.map((j) => j.project_id).filter((v): v is string => !!v)))
  const ownerIds = Array.from(new Set(jobs.map((j) => j.owner_user_id).filter((v): v is string => !!v)))

  // Crews, payments and signed change orders come back from data health — read once, not twice.
  const [health, projects, supplierOrders, photos, owners, orgTrades] = await Promise.all([
    loadDataHealthWithRows(admin, orgId, { jobIds: jobIdsFound, includeAppointments: false, now }),
    selectIn<{ id: string; opportunity_id: string | null }>(projectIds, (chunk) => admin.from('projects').select('id, opportunity_id').eq('org_id', orgId).in('id', chunk)),
    // Materials orders only: a general purchase order to a vendor is not "the materials step" (kind column; missing = all materials).
    selectIn<{ job_id: string; status: string; last_sent_at: string | null; received_at: string | null; kind?: string | null }>(jobIdsFound, (chunk) =>
      admin.from('supplier_orders').select('*').eq('org_id', orgId).in('job_id', chunk)
    ).then((rows) => rows.filter((r) => (r.kind ?? 'materials') === 'materials')),
    selectIn<{ job_id: string; created_at: string | null }>(jobIdsFound, (chunk) =>
      admin.from('photos').select('job_id, created_at').eq('org_id', orgId).is('deleted_at', null).gte('created_at', sinceIso).in('job_id', chunk)
    ),
    selectIn<{ id: string; full_name: string | null }>(ownerIds, (chunk) => admin.from('users').select('id, full_name').eq('org_id', orgId).in('id', chunk)),
    loadOrgTrades(admin, orgId),
  ])
  const ownerName = new Map(owners.map((u) => [u.id, u.full_name]))

  // Needs-you, ops view: the same rows an ops person sees on the dashboard — none carries a dollar amount.
  const shaped = shapeNeedsYou(health.report, 'ops')
  const problemsByJob = new Map<string, HealthProblem[]>((shaped?.jobs ?? []).map((j) => [j.jobId, j.problems]))

  const oppByProject = new Map(projects.map((p) => [p.id, p.opportunity_id]))
  const dealIds = Array.from(new Set(Array.from(oppByProject.values()).filter((v): v is string => !!v)))
  const rawActivities: ActivityRow[] = []
  for (let i = 0; i < dealIds.length; i += 200) {
    const chunk = dealIds.slice(i, i + 200)
    rawActivities.push(
      ...(await fetchSupabaseAllPages<ActivityRow>((from, to) =>
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

  // The Materials tab's answer for the jobs whose next step can be about materials (a few at a time).
  const materialsByJob = new Map<string, MaterialsState>()
  // Capped: each one is the full Materials tab load. Beyond the cap the recorded status answers (Known Redundancy #26).
  const needMaterials = jobs.filter((j) => MATERIALS_STEP_STATUSES.has(j.status)).slice(0, MATERIALS_MAX_JOBS)
  for (let i = 0; i < needMaterials.length; i += MATERIALS_CONCURRENCY) {
    await Promise.all(
      needMaterials.slice(i, i + MATERIALS_CONCURRENCY).map(async (j) => {
        try {
          materialsByJob.set(j.id, await jobCatchUpDeps.materialsState(admin, orgId, j.id, j.materials_status))
        } catch (error) {
          console.error('[job-catch-up] materials state failed; using the recorded status', j.id, error)
        }
      })
    )
  }

  const tradesByJob = groupBy(health.rows.trades, (t) => t.job_id)
  const paymentsByJob = groupBy(health.rows.payments, (p) => p.job_id)
  // Invoice sales tax / time & materials billing (lib/job-invoice-tax.ts): data health already read it for the same jobs.
  const invoiceTaxByJob = opts.showPayment ? health.rows.invoiceFacts : new Map<string, JobInvoiceFacts>()
  const cosByJob = groupBy(health.rows.changeOrders, (c) => c.job_id)
  const ordersByJob = groupBy(supplierOrders, (o) => o.job_id)
  const photosByJob = groupBy(photos, (p) => p.job_id)

  for (const job of jobs) {
    const dealId = job.project_id ? oppByProject.get(job.project_id) ?? null : null
    const jobTrades: CatchUpTrade[] = (tradesByJob.get(job.id) ?? []).map((t) => ({
      trade: t.trade,
      label: tradeLabel(t.trade, orgTrades),
      status: t.status,
      scheduled_date: t.scheduled_date,
      install_days: t.install_days,
      sub_name: one(t.assigned_sub)?.company_name ?? null,
      created_at: t.created_at,
      updated_at: t.updated_at,
      completed_at: t.completed_at,
      install_sync_failed_at: t.install_sync_failed_at ?? null,
    }))
    const jobPayments = paymentsByJob.get(job.id) ?? []
    const events: CatchUpEvent[] = []
    for (const o of ordersByJob.get(job.id) ?? []) {
      if (o.last_sent_at) events.push({ at: o.last_sent_at, what: 'Supplier order sent' })
      if (o.received_at) events.push({ at: o.received_at, what: 'Materials received' })
    }
    // A payment is movement only for someone who already sees payment status (otherwise it would leak that money came in).
    if (opts.showPayment) for (const p of jobPayments) if (p.created_at) events.push({ at: p.created_at, what: 'Payment recorded' })
    for (const co of cosByJob.get(job.id) ?? []) {
      const at = co.customer_signed_at ?? co.signed_at
      if (at) events.push({ at, what: co.co_number != null ? `Change order ${co.co_number} signed` : 'Change order signed' })
    }
    const jobPhotos = (photosByJob.get(job.id) ?? []).filter((p) => !!p.created_at).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    if (jobPhotos[0]) events.push({ at: jobPhotos[0].created_at as string, what: jobPhotos.length === 1 ? 'Photo added' : `${jobPhotos.length} photos added` })

    const notes: CatchUpNote[] = (dealId ? notesByDeal.get(dealId) ?? [] : []).map((r) => {
      const u = one(r.users)
      const body = r.body ?? ''
      return {
        id: r.id,
        at: r.created_at,
        who: u?.full_name ?? null,
        type: r.type,
        // No dollar amounts in catch-up: a pricing-flagged or pricing-looking note is named, never quoted.
        text: r.restricted_pricing || looksLikePricing(body) ? null : body,
        from: noteSource(r),
      }
    })

    const chip = opts.showPayment
      ? paymentStatusChip({ sale_amount: job.sale_amount, collected_cents: sumCollectedCents(jobPayments), allow_close_with_balance: job.allow_close_with_balance, close_balance_by: job.close_balance_by, invoice_tax_cents: invoiceTaxByJob.get(job.id)?.taxCents ?? 0, tm_invoiced_cents: collectionInvoiceFields(invoiceTaxByJob.get(job.id)).timeAndMaterialsInvoicedCents, tm_pending: collectionInvoiceFields(invoiceTaxByJob.get(job.id)).timeAndMaterialsPending })
      : null

    const catchUp = buildJobCatchUp({
      job: { ...job, owner_name: job.owner_user_id ? ownerName.get(job.owner_user_id) ?? null : null },
      trades: jobTrades,
      materials: materialsByJob.get(job.id) ?? deriveMaterialsState({ stored: job.materials_status }),
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
