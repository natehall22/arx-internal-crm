/**
 * The role cards' numbers (lib/dashboard-cards.ts catalog entries whose loader is one of the names below). Every number comes
 * from a source that already exists — a Today queue loader (lib/today.ts), the cost ledger, the time clock reads, the plan
 * schedule helpers, the report runner — and a failed read is a dash, never a false 0. This file only SHAPES them into cards.
 * Called from `loadDashboardCardData` (lib/dashboard-cards-server.ts), one card at a time, so a card that is not on the
 * viewer's list never runs its loader.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import {
  formatCardValue,
  type CardData,
  type DashboardCard,
  type LeaderboardData,
  type ListData,
  type ListRow,
  type TileData,
} from '@/lib/dashboard-cards'
import type { DashboardWindow } from '@/lib/dashboard-cards-server'
import { jobCancellationReasonLabel } from '@/lib/job-status'
import { jobDirectCost, ledgerSummaryFor, loadJobCostLedger } from '@/lib/job-cost-ledger'
import type { OrgFeatures } from '@/lib/org-features'
import { loadLeadsWaitingQueue } from '@/lib/leads-waiting'
import { loadQuickBooksStuckQueue } from '@/lib/quickbooks/activity'
import type { ReportContext, ReportResult } from '@/lib/reporting/run'
import type { ReportSpec } from '@/lib/reporting/report-spec'
import { addDaysYmd, daysBetweenYmd, planPriceOn, planVisitDates, visitPrice, ymdInZone, type ServicePlan } from '@/lib/service-plans'
import { loadCompletedServiceVisits, sortVisits, loadVisits, type PlansLoad, type VisitView } from '@/lib/service-plans-db'
import { loadReadyToBill, type UnpaidServiceInvoice } from '@/lib/service-billing-db'
import { orgDb } from '@/lib/supabase/org-db'
import { loadWorkSecondsByJob, loadWorkSecondsByStop } from '@/lib/time-tracking-db'
import {
  listUnsignedProposals,
  loadCarriedOverVisitsQueue,
  loadCloserQueues,
  loadOpsQueues,
  loadServiceVisitQueues,
  loadSmsInboxQueue,
  loadUnassignedVisitsQueue,
  type Queue,
} from '@/lib/today'

type Viewer = { userId: string; audiences: ReadonlySet<string>; financials: boolean; books?: boolean; ledSubIds: string[] | null }

export type RoleCtx = {
  admin: SupabaseClient
  orgId: string
  profile: { id: string; org_id: string; role: string; team_id?: string | null; region_id?: string | null }
  viewer: Viewer
  features: OrgFeatures | null
  win: DashboardWindow
  now: Date
  /** Visits sitting on today in the company's zone, no access notes, narrowed to the viewer's crews unless they are owner / office. */
  visitsToday: () => Promise<VisitView[]>
  plans: () => Promise<PlansLoad>
  unpaid: () => Promise<{ rows: UnpaidServiceInvoice[]; capped: boolean } | null>
  /** The report runner for this week, with the viewer's own scope. */
  runWeek: (spec: ReportSpec) => Promise<ReportResult>
  runSpec: (spec: ReportSpec) => Promise<ReportResult>
  reportCtx: () => Promise<ReportContext>
}

const ROW_CAP = 8
const MY_DAY_CAP = 40
const usd = (n: number) => formatCardValue('money', n)
const isOwner = (v: Viewer) => v.audiences.has('owner')
const hours1 = (secs: number) => Math.round((secs / 3600) * 10) / 10

function tile(card: DashboardCard, goal: number | null, value: number | null, extra: { sub?: string; unavailable?: string } = {}): TileData {
  return { kind: 'tile', key: card.key, label: card.label, display: card.display as TileData['display'], value, goal, group: card.group, ...(extra.sub ? { sub: extra.sub } : {}), ...(extra.unavailable ? { unavailable: extra.unavailable } : {}) }
}
function listCard(card: DashboardCard, rows: ListRow[], count: number, empty: string, extra: { sub?: string; clock?: boolean } = {}): ListData {
  return { kind: 'list', key: card.key, label: card.label, count, rows, empty, failed: false, group: card.group, ...(extra.sub ? { sub: extra.sub } : {}), ...(extra.clock ? { clock: true } : {}) }
}
const queueRows = (q: Queue | undefined, tone?: 'warn'): ListRow[] => (q?.items ?? []).map((i) => ({ id: `${q?.id}:${i.id}`, title: i.title, detail: i.detail, href: i.href, ...(tone ? { tone } : {}) }))

/** Rows read in pages (never cut off at the 1,000-row default); throws on any read error so a card shows a dash. */
async function readAll<T>(make: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>, max = 5000): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; from < max; from += 1000) {
    const { data, error } = await make(from, from + 999)
    if (error) throw error
    out.push(...((data ?? []) as T[]))
    if ((data ?? []).length < 1000) break
  }
  return out
}

/* ------------------------------------------------------------------------ *
 * Pure helpers (unit-tested)
 * ------------------------------------------------------------------------ */

/**
 * What a plan bills between two days, from the plan's own schedule and price rules (planVisitDates / planPriceOn / visitPrice):
 * per visit = each planned visit's price; per month = the plan price for every month with at least one visit (the invoicing
 * rule); per year = the yearly price once. Per-hour plans and plans with no price are not counted (`counted: false`).
 */
export function planContractValue(p: ServicePlan, from: string, to: string): { value: number; counted: boolean } {
  if (p.billing_basis === 'per_hour') return { value: 0, counted: false }
  const dates = planVisitDates(p, from, to)
  if (p.billing_basis === 'per_visit') {
    const prices = dates.map((d) => visitPrice(p, d))
    return { value: prices.reduce<number>((t, x) => t + (x ?? 0), 0), counted: prices.some((x) => x != null) || dates.length === 0 }
  }
  if (p.billing_basis === 'per_month') {
    const months = Array.from(new Set(dates.map((d) => d.slice(0, 7))))
    const prices = months.map((m) => planPriceOn(p, `${m}-01`))
    return { value: prices.reduce<number>((t, x) => t + (x ?? 0), 0), counted: prices.some((x) => x != null) || months.length === 0 }
  }
  // per_year
  if (dates.length === 0) return { value: 0, counted: true }
  const price = planPriceOn(p, dates[0])
  return { value: price ?? 0, counted: price != null }
}

export const AGING_BUCKETS = [
  { id: 'current', label: 'Not due yet' },
  { id: 'd1', label: '1–30 days late' },
  { id: 'd31', label: '31–60 days late' },
  { id: 'd61', label: '61–90 days late' },
  { id: 'd90', label: 'Over 90 days late' },
] as const

/** Which age bucket an invoice is in: no due date or not yet due = current. Days are the company's calendar days. */
export function agingBucketId(dueAt: string | null, today: string): (typeof AGING_BUCKETS)[number]['id'] {
  if (!dueAt) return 'current'
  const late = daysBetweenYmd(dueAt.slice(0, 10), today)
  if (late <= 0) return 'current'
  if (late <= 30) return 'd1'
  if (late <= 60) return 'd31'
  if (late <= 90) return 'd61'
  return 'd90'
}

/** Plans that ended (or end within 60 days) with no other active plan for the same customer and property. */
export function plansToRenew(plans: readonly ServicePlan[], today: string): ServicePlan[] {
  const from = addDaysYmd(today, -60)
  const to = addDaysYmd(today, 60)
  const active = plans.filter((p) => p.status === 'active')
  return plans
    .filter((p) => !!p.end_date && p.end_date >= from && p.end_date <= to && (p.status === 'ended' || p.status === 'active'))
    .filter((p) => !active.some((a) => a.id !== p.id && a.customer_id === p.customer_id && a.property_id === p.property_id && (!a.end_date || a.end_date > to)))
    .sort((a, b) => (a.end_date ?? '').localeCompare(b.end_date ?? '') || a.id.localeCompare(b.id))
}

/* ------------------------------------------------------------------------ *
 * The loaders
 * ------------------------------------------------------------------------ */

export async function loadRoleCard(ctx: RoleCtx, card: DashboardCard, goal: number | null): Promise<CardData | null> {
  const src = card.source
  if (src.kind !== 'loader') return null
  const m = src.measure
  switch (src.loader) {
    case 'revenuePerCrewHour': return revenuePerCrewHour(ctx, card, goal)
    case 'contractedRecurring': return contractedRecurring(ctx, card, goal)
    case 'cancellations': return cancellations(ctx, card, goal)
    case 'jobHours': return jobHours(ctx, card, goal)
    case 'projects': return projects(ctx, card, goal, m)
    case 'office': return office(ctx, card, m)
    case 'sales': return sales(ctx, card, goal, m)
    case 'crewDay': return crewDay(ctx, card, goal, m)
    case 'billing': return billing(ctx, card, goal, m)
    case 'renewals': return renewals(ctx, card, goal, m)
    default: return null
  }
}

/** Visit prices ÷ clocked hours, this week. Only per-visit-priced visits that have clocked time count in BOTH numbers. */
async function revenuePerCrewHour(ctx: RoleCtx, card: DashboardCard, goal: number | null): Promise<TileData> {
  const { win } = ctx
  const done = await loadCompletedServiceVisits(ctx.admin, ctx.orgId, win.fromIso, new Date(Date.parse(win.toIso) + 1).toISOString())
  const priced = done.filter((v) => v.price != null && v.price > 0)
  const seconds = priced.length ? await loadWorkSecondsByStop(ctx.admin, ctx.orgId, { fromIso: win.fromIso, toIso: win.toIso, workOrderIds: priced.map((v) => v.visitId) }) : new Map<string, number>()
  if (!seconds) return tile(card, goal, null, { unavailable: 'The time clock is not set up yet.' })
  let value = 0
  let secs = 0
  let counted = 0
  for (const v of priced) {
    const s = seconds.get(v.visitId) ?? 0
    if (s <= 0) continue
    value += v.price as number
    secs += s
    counted += 1
  }
  if (secs <= 0) return tile(card, goal, null, { unavailable: 'No clocked hours on priced visits this week yet.' })
  return tile(card, goal, Math.round(value / (secs / 3600)), { sub: `${usd(value)} over ${hours1(secs)} h · ${counted} of ${done.length} finished visits counted (monthly-priced and unclocked visits are not)` })
}

/** Active plans' contracted value over the next 12 months. */
async function contractedRecurring(ctx: RoleCtx, card: DashboardCard, goal: number | null): Promise<TileData> {
  const { ready, plans } = await ctx.plans()
  if (!ready) return tile(card, goal, null)
  const from = ctx.win.today
  const to = addDaysYmd(from, 364)
  let total = 0
  let counted = 0
  let hourly = 0
  let unpriced = 0
  for (const p of plans.filter((x) => x.status === 'active')) {
    if (p.billing_basis === 'per_hour') { hourly += 1; continue }
    const r = planContractValue(p, from, to)
    if (!r.counted) { unpriced += 1; continue }
    total += r.value
    counted += 1
  }
  const notes = [hourly ? `${hourly} per-hour plan${hourly === 1 ? '' : 's'} not counted` : null, unpriced ? `${unpriced} with no price not counted` : null].filter(Boolean)
  return tile(card, goal, Math.round(total), { sub: [`about ${usd(total / 12)} a month · ${counted} plan${counted === 1 ? '' : 's'}`, ...notes].join(' · ') })
}

/** Plans staff ended this month (history rows) + jobs cancelled this month with their recorded reasons. */
async function cancellations(ctx: RoleCtx, card: DashboardCard, goal: number | null): Promise<TileData> {
  const { win } = ctx
  const db = orgDb(ctx.admin, ctx.orgId)
  let plans = 0
  if (ctx.features?.servicePlans !== false) {
    const { data, error } = await db.from('service_plan_changes').select('plan_id').eq('action', 'ended').gte('changed_at', win.monthStartIso).lt('changed_at', win.nextMonthStartIso).limit(5000)
    if (error) throw error
    plans = new Set(((data ?? []) as Array<{ plan_id: string | null }>).map((r) => r.plan_id).filter(Boolean)).size
  }
  const { data: jobs, error: jobsError } = await db.from('production_jobs').select('cancellation_reason').eq('status', 'cancelled').gte('cancelled_at', win.monthStartIso).lt('cancelled_at', win.nextMonthStartIso).limit(5000)
  if (jobsError) throw jobsError
  const by = new Map<string, number>()
  for (const j of (jobs ?? []) as Array<{ cancellation_reason: string | null }>) by.set(jobCancellationReasonLabel(j.cancellation_reason), (by.get(jobCancellationReasonLabel(j.cancellation_reason)) ?? 0) + 1)
  const reasons = Array.from(by.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([why, n]) => `${why} ${n}`).join(' · ')
  const jobCount = ((jobs ?? []) as unknown[]).length
  const parts = [ctx.features?.servicePlans !== false ? `${plans} plan${plans === 1 ? '' : 's'} ended by staff (no reason is recorded)` : null, jobCount ? `${jobCount} job${jobCount === 1 ? '' : 's'} cancelled: ${reasons}` : null].filter(Boolean)
  return tile(card, goal, plans + jobCount, parts.length ? { sub: parts.join(' · ') } : {})
}

type JobRow = { id: string; job_number: string | null; address_text: string | null; sale_amount: number | string | null; dealer_fee_amount?: number | string | null; estimated_hours?: number | string | null }
const num = (v: unknown): number | null => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))

/** Clocked hours on jobs that carry estimated hours (set with hourly billing), against the estimate. */
async function jobHours(ctx: RoleCtx, card: DashboardCard, goal: number | null): Promise<TileData> {
  const db = orgDb(ctx.admin, ctx.orgId)
  const { data, error } = await db.from('production_jobs').select('id, estimated_hours').in('status', ['scheduled', 'in_progress']).not('estimated_hours', 'is', null).limit(500)
  if (error) throw error // a failed read is a dash, never "no estimated hours"
  const jobs = ((data ?? []) as Array<{ id: string; estimated_hours: number | string | null }>).filter((j) => (num(j.estimated_hours) ?? 0) > 0)
  if (jobs.length === 0) return tile(card, goal, null, { unavailable: 'No job in progress has estimated hours yet.' })
  const seconds = await loadWorkSecondsByJob(ctx.admin, ctx.orgId, { fromIso: '2000-01-01T00:00:00.000Z', toIso: new Date(ctx.now.getTime() + 86_400_000).toISOString(), jobIds: jobs.map((j) => j.id) })
  if (!seconds) return tile(card, goal, null, { unavailable: 'The time clock is not set up yet.' })
  const est = jobs.reduce((t, j) => t + (num(j.estimated_hours) ?? 0), 0)
  const actual = jobs.reduce((t, j) => t + (seconds.get(j.id) ?? 0), 0) / 3600
  const over = jobs.filter((j) => (seconds.get(j.id) ?? 0) / 3600 > (num(j.estimated_hours) ?? 0)).length
  return tile(card, goal, Math.round(actual * 10) / 10, { sub: `of ${Math.round(est * 10) / 10} h estimated across ${jobs.length} job${jobs.length === 1 ? '' : 's'}${over ? ` · ${over} over` : ''}` })
}

async function projects(ctx: RoleCtx, card: DashboardCard, goal: number | null, measure: string): Promise<CardData> {
  const db = orgDb(ctx.admin, ctx.orgId)
  if (measure === 'active') {
    const { count, error } = await db.from('production_jobs').select('id', { count: 'exact', head: true }).eq('status', 'in_progress')
    if (error) throw error
    return tile(card, goal, count ?? 0)
  }
  if (measure === 'backlog') {
    const rows = await readAll<{ sale_amount: number | string | null }>((from, to) => db.from('production_jobs').select('sale_amount').in('status', ['sold', 'materials', 'scheduled']).order('id').range(from, to))
    const priced = rows.filter((r) => num(r.sale_amount) != null)
    const total = priced.reduce((t, r) => t + (num(r.sale_amount) ?? 0), 0)
    return tile(card, goal, Math.round(total), { sub: `${rows.length} job${rows.length === 1 ? '' : 's'} sold, not started${rows.length > priced.length ? ` · ${rows.length - priced.length} with no price` : ''}` })
  }
  if (measure === 'changeOrders') {
    const { data, error } = await db.from('job_change_orders').select('id, original_amount, updated_total, job:production_jobs(status)').eq('status', 'completed').gte('signed_at', ctx.win.monthStartIso).lt('signed_at', ctx.win.nextMonthStartIso).limit(5000)
    if (error) throw error
    const rows = ((data ?? []) as unknown as Array<{ original_amount: number | string; updated_total: number | string; job: { status: string } | Array<{ status: string }> | null }>).filter((r) => {
      const j = Array.isArray(r.job) ? r.job[0] : r.job
      return j?.status !== 'cancelled'
    })
    const added = rows.reduce((t, r) => t + ((num(r.updated_total) ?? 0) - (num(r.original_amount) ?? 0)), 0)
    return tile(card, goal, Math.round(added), { sub: `${rows.length} signed this month` })
  }
  // costVsEstimate: jobs in progress, newest first. One ledger read, one budget read, one time read for ALL of them.
  const jobs = await readAll<JobRow>((from, to) => db.from('production_jobs').select('id, job_number, address_text, sale_amount, dealer_fee_amount, estimated_hours').eq('status', 'in_progress').order('updated_at', { ascending: false }).order('id').range(from, Math.min(to, 11)), 12)
  const ids = jobs.map((j) => j.id)
  const lb: LeaderboardData = {
    kind: 'leaderboard', key: card.key, label: card.label, failed: false, group: card.group, empty: 'No jobs in progress.',
    columns: [{ key: 'est', label: 'Est. cost', format: 'money' }, { key: 'cost', label: 'Actual cost', format: 'money' }, { key: 'eh', label: 'Est. hours', format: 'hours' }, { key: 'ah', label: 'Clocked hours', format: 'hours' }, { key: 'margin', label: 'Margin', format: 'percent' }],
    rows: [],
  }
  if (ids.length === 0) return lb
  const [ledger, budgetRes, seconds] = await Promise.all([
    loadJobCostLedger(ctx.admin, ctx.orgId, ids),
    db.from('job_budget_lines').select('job_id, amount').in('job_id', ids),
    ctx.features?.timeTracking === false ? Promise.resolve(null) : loadWorkSecondsByJob(ctx.admin, ctx.orgId, { fromIso: '2000-01-01T00:00:00.000Z', toIso: new Date(ctx.now.getTime() + 86_400_000).toISOString(), jobIds: ids }).catch(() => null),
  ])
  const budget = new Map<string, number>()
  for (const b of ((budgetRes.error ? [] : budgetRes.data) ?? []) as Array<{ job_id: string; amount: number | string }>) budget.set(b.job_id, (budget.get(b.job_id) ?? 0) + (num(b.amount) ?? 0))
  lb.rows = jobs.map((j) => {
    const summary = ledgerSummaryFor(ledger, j.id)
    const fee = num(j.dealer_fee_amount) ?? 0
    // No cost lines at all is "no cost recorded yet", never a $0 cost and a 100% margin.
    const cost = summary.lineCount === 0 && fee <= 0 ? null : jobDirectCost(summary, j.dealer_fee_amount)
    const sale = num(j.sale_amount)
    const margin = cost !== null && sale !== null && sale > 0 ? Math.round(((sale - cost) / sale) * 100) : null
    const secs = seconds ? seconds.get(j.id) ?? 0 : null
    return { id: j.id, name: `Job ${j.job_number ?? ''}${j.address_text ? ` · ${j.address_text}` : ''}`.trim(), values: [budget.has(j.id) ? budget.get(j.id)! : null, cost, num(j.estimated_hours), secs === null ? null : hours1(secs), margin] }
  })
  return lb
}

/* ---------------------------------- office ---------------------------------- */

async function office(ctx: RoleCtx, card: DashboardCard, measure: string): Promise<CardData> {
  if (measure === 'crewsToday') {
    const visits = await ctx.visitsToday()
    const crews = new Map<string, { name: string; left: number; done: number; skipped: number }>()
    for (const v of visits.filter((x) => x.status !== 'cancelled')) {
      const key = v.subId ?? (v.userId ? `u:${v.userId}` : 'none')
      const c = crews.get(key) ?? { name: v.subName ?? v.userName ?? 'No crew assigned', left: 0, done: 0, skipped: 0 }
      if (v.status === 'scheduled') c.left += 1
      else if (v.status === 'completed') c.done += 1
      else if (v.status === 'skipped') c.skipped += 1
      crews.set(key, c)
    }
    return {
      kind: 'leaderboard', key: card.key, label: card.label, failed: false, group: card.group, empty: 'No visits scheduled today.',
      columns: [{ key: 'left', label: 'Left', format: 'count' }, { key: 'done', label: 'Done', format: 'count' }, { key: 'skipped', label: 'Skipped', format: 'count' }],
      rows: Array.from(crews.entries()).sort((a, b) => b[1].left - a[1].left || a[1].name.localeCompare(b[1].name)).map(([id, c]) => ({ id, name: c.name, values: [c.left, c.done, c.skipped] })),
    }
  }
  if (measure === 'carriedOver') {
    const q = await loadCarriedOverVisitsQueue(ctx.admin, ctx.orgId, ctx.now, ROW_CAP)
    return listCard(card, queueRows(q, 'warn'), q.count, q.empty)
  }
  if (measure === 'skipped') {
    const queues = await loadServiceVisitQueues(ctx.admin, ctx.orgId, ctx.now)
    const q = queues.find((x) => x.id === 'skipped-visits')
    return listCard(card, queueRows(q), q?.count ?? 0, 'No visits skipped in the last 7 days.')
  }
  if (measure === 'unassigned') {
    const [visits, ops] = await Promise.all([loadUnassignedVisitsQueue(ctx.admin, ctx.orgId, ctx.now, ROW_CAP), loadOpsQueues(ctx.admin, ctx.orgId)])
    const toSchedule = ops.find((x) => x.id === 'jobs-to-schedule')
    const rows = [...queueRows(visits, 'warn'), ...queueRows(toSchedule)].slice(0, ROW_CAP)
    const features = ctx.features
    const count = (features?.servicePlans === false ? 0 : visits.count) + (toSchedule?.count ?? 0)
    return listCard(card, features?.servicePlans === false ? queueRows(toSchedule) : rows, count, 'Every visit has a crew and every sold job has a date.')
  }
  // callbacks: texts nobody has answered + leads nobody has contacted (org-wide: this is the office's list)
  const [texts, leads] = await Promise.all([loadSmsInboxQueue(ctx.admin, ctx.orgId, ROW_CAP), loadLeadsWaitingQueue(ctx.admin, ctx.orgId, ctx.now, { cap: ROW_CAP })])
  const failed = leads.empty.includes('couldn’t load')
  const out = listCard(card, [...queueRows(texts, 'warn'), ...queueRows(leads, 'warn')].slice(0, ROW_CAP), texts.count + leads.count, 'No texts or new leads are waiting.')
  return failed ? { ...out, failed: true } : out
}

/* ---------------------------------- sales ----------------------------------- */

const daysWaiting = (iso: string, today: string, tz: string): number => Math.max(0, daysBetweenYmd(ymdInZone(new Date(iso), tz), today))

/** The weekly sales goal set for this person (their own settings row, else their team's, else their region's). null = none set. */
export async function resolveWeeklySalesGoal(admin: SupabaseClient, orgId: string, p: { id: string; team_id?: string | null; region_id?: string | null }): Promise<number | null> {
  const db = orgDb(admin, orgId)
  const read = async (q: PromiseLike<{ data: unknown; error: unknown }>): Promise<number | null | undefined> => {
    const { data, error } = await q
    if (error || !data) return undefined
    const rows = (Array.isArray(data) ? data : [data]) as Array<{ settings?: { goals?: { sales?: unknown } } | null }>
    if (rows.length === 0) return undefined
    const g = Number(rows[0].settings?.goals?.sales)
    return Number.isFinite(g) && g > 0 ? g : null
  }
  const mine = await read(db.from('dashboard_settings').select('settings').eq('user_id', p.id).limit(1))
  if (mine !== undefined) return mine
  if (p.team_id) {
    const team = await read(db.from('dashboard_settings').select('settings').eq('team_id', p.team_id).is('user_id', null).limit(1))
    if (team !== undefined) return team
  }
  if (p.region_id) {
    const region = await read(db.from('dashboard_settings').select('settings').eq('region_id', p.region_id).is('team_id', null).is('user_id', null).limit(1))
    if (region !== undefined) return region
  }
  return null
}

async function sales(ctx: RoleCtx, card: DashboardCard, goal: number | null, measure: string): Promise<CardData> {
  const { win, viewer } = ctx
  const owner = isOwner(viewer)
  // A salesperson sees their own quotes and their own prices; an owner sees every quote and amounts only with financials.
  const showMoney = owner ? viewer.financials : true
  if (measure === 'quotesOut') {
    const rows = await listUnsignedProposals(ctx.admin, ctx.orgId, owner ? {} : { createdBy: viewer.userId })
    const total = rows.reduce((t, r) => t + (num(r.total) ?? 0), 0)
    return listCard(
      card,
      rows.slice(0, ROW_CAP).map((r) => {
        const days = daysWaiting(r.sent_at, win.today, win.timeZone)
        return { id: r.id, title: r.customer_name || 'Quote', detail: [r.proposal_number ? `#${r.proposal_number}` : null, showMoney && num(r.total) != null ? usd(num(r.total) as number) : null, `${days} day${days === 1 ? '' : 's'}`].filter(Boolean).join(' · '), href: `/proposals/${r.id}`, ...(days >= 7 ? { tone: 'warn' as const } : {}) }
      }),
      rows.length,
      'Nothing is waiting on a customer.',
      { sub: rows.length && showMoney ? `${usd(total)} waiting in total · oldest first` : rows.length ? 'oldest first' : undefined }
    )
  }
  if (measure === 'followups') {
    const [closer, leads] = await Promise.all([loadCloserQueues(ctx.admin, ctx.orgId, viewer.userId, ctx.now, { money: false }), loadLeadsWaitingQueue(ctx.admin, ctx.orgId, ctx.now, { ownerUserId: viewer.userId, cap: ROW_CAP })])
    const today = closer.find((q) => q.id === 'today-appointments')
    const logs = closer.find((q) => q.id === 'outcomes-to-log')
    const out = listCard(card, [...queueRows(today), ...queueRows(logs, 'warn'), ...queueRows(leads, 'warn')].slice(0, ROW_CAP), (today?.count ?? 0) + (logs?.count ?? 0) + leads.count, 'Nothing to follow up today.')
    return leads.empty.includes('couldn’t load') ? { ...out, failed: true } : out
  }
  if (measure === 'wonLost') {
    const r = await ctx.runSpec({ dataset: 'opportunities', mode: 'summary', groupBy: 'status', metric: { kind: 'count' }, date: { preset: '30d' }, filters: [], sortDesc: true })
    const by = (s: string) => Number(r.rows.find((x) => String(x.group) === s)?.value ?? 0)
    const won = by('won')
    const lost = by('lost')
    const open = r.rows.reduce((t, x) => t + (Number(x.value) || 0), 0) - won - lost
    return tile(card, goal, won, { sub: `${lost} lost · ${open} still open · deals opened in the last 30 days` })
  }
  if (measure === 'goal') {
    const [r, target] = await Promise.all([ctx.runWeek({ dataset: 'sales', mode: 'summary', groupBy: null, metric: { kind: 'count' }, date: { preset: '7d' }, filters: [], sortDesc: true }), resolveWeeklySalesGoal(ctx.admin, ctx.orgId, ctx.profile)])
    return { ...tile(card, target, r.summary?.value ?? 0, target ? {} : { sub: 'No weekly sales goal is set for you yet (Dashboard settings).' }) }
  }
  // quotesSent: counted from the day each quote was sent (proposals.sent_at, stamped when it is first saved as sent)
  let q = orgDb(ctx.admin, ctx.orgId).from('proposals').select('id, total').gte('sent_at', win.fromIso).lte('sent_at', win.toIso).limit(1000)
  if (!owner) q = q.eq('created_by', viewer.userId)
  const { data, error } = await q
  if (error) throw error
  const rows = (data ?? []) as Array<{ total: number | string | null }>
  const total = rows.reduce((t, r) => t + (num(r.total) ?? 0), 0)
  return tile(card, goal, rows.length, rows.length && showMoney ? { sub: `${usd(total)} quoted${rows.length >= 1000 ? ' (first 1,000)' : ''}` } : {})
}

/* ----------------------------------- crew ----------------------------------- */

/** The viewer's crews' stops today in route order, with the same loader the crew phone page and the day sheet read (loadVisits). No money anywhere. */
const myDayRead = new WeakMap<RoleCtx, Promise<VisitView[] | null>>()
/** One read per page for all three My-day cards (stops, stops left, hours): the cards share the context, so they share the read. */
export function myDayVisits(ctx: RoleCtx): Promise<VisitView[] | null> {
  let p = myDayRead.get(ctx)
  if (!p) { p = readMyDayVisits(ctx); myDayRead.set(ctx, p) }
  return p
}

async function readMyDayVisits(ctx: RoleCtx): Promise<VisitView[] | null> {
  const subIds = ctx.viewer.ledSubIds
  if (!subIds || subIds.length === 0) return null
  const per = await Promise.all(subIds.map((subId) => loadVisits(ctx.admin, ctx.orgId, { from: ctx.win.today, to: ctx.win.today, subId, accessNotes: true })))
  return sortVisits(per.flat().filter((v) => v.status !== 'cancelled'))
}

async function crewDay(ctx: RoleCtx, card: DashboardCard, goal: number | null, measure: string): Promise<CardData> {
  const visits = await myDayVisits(ctx)
  const none = 'You are not on a crew yet — ask the office to add you.'
  if (visits === null) return measure === 'stops' ? listCard(card, [], 0, none) : tile(card, goal, null, { unavailable: none })
  const left = visits.filter((v) => v.status === 'scheduled')
  const done = visits.length - left.length
  if (measure === 'left') return tile(card, goal, left.length, { sub: `of ${visits.length} today · ${done} done` })
  if (measure === 'hours') {
    const seconds = await loadWorkSecondsByStop(ctx.admin, ctx.orgId, { fromIso: ctx.win.todayFromIso, toIso: ctx.win.todayToIso, workOrderIds: visits.map((v) => v.id) })
    if (!seconds) return tile(card, goal, null, { unavailable: 'The time clock is not set up yet.' })
    const secs = Array.from(seconds.values()).reduce((t, s) => t + s, 0)
    return tile(card, goal, hours1(secs), { sub: 'hours clocked on today’s stops · visits have no planned time to compare against' })
  }
  const rows: ListRow[] = visits.slice(0, MY_DAY_CAP).map((v, i) => {
    const isDone = v.status !== 'scheduled'
    const what = v.step !== 'service' && v.stepLabel ? `${v.stepLabel} — ${v.planName}` : v.planName
    const first = (v.customerName ?? '').trim().split(/\s+/)[0]
    const detail = [isDone ? (v.status === 'skipped' ? 'Skipped' : 'Done') : null, what, first || null, v.officeNotes, v.accessNotes ? `Gate / access: ${v.accessNotes}` : null].filter(Boolean).join(' · ')
    return { id: v.id, title: `${v.routePosition ?? i + 1}. ${v.address ?? what}`, detail, done: isDone, ...(isDone ? {} : { clockStopId: v.id }) }
  })
  return listCard(card, rows, left.length, 'No stops on your crew’s day.', { sub: `${left.length} left · ${done} done`, clock: ctx.features?.timeTracking === true })
}

/* ---------------------------------- billing --------------------------------- */

async function billing(ctx: RoleCtx, card: DashboardCard, goal: number | null, measure: string): Promise<CardData> {
  if (measure === 'aging') {
    const loaded = await ctx.unpaid()
    if (!loaded) return { kind: 'leaderboard', key: card.key, label: card.label, columns: [], rows: [], empty: '', failed: true, group: card.group }
    const sums = new Map<string, { n: number; cents: number }>(AGING_BUCKETS.map((b) => [b.id, { n: 0, cents: 0 }]))
    for (const r of loaded.rows) {
      const s = sums.get(agingBucketId(r.dueAt, ctx.win.today))!
      s.n += 1
      s.cents += r.balanceCents
    }
    return {
      kind: 'leaderboard', key: card.key, label: loaded.capped ? `${card.label} (oldest checked)` : card.label, failed: false, group: card.group, empty: 'No unpaid invoices.',
      columns: [{ key: 'n', label: 'Invoices', format: 'count' }, { key: 'owed', label: 'Owed', format: 'money' }],
      rows: loaded.rows.length === 0 ? [] : AGING_BUCKETS.map((b) => ({ id: b.id, name: b.label, values: [sums.get(b.id)!.n, sums.get(b.id)!.cents / 100] })),
    }
  }
  if (measure === 'unbilled') {
    const r = await loadReadyToBill(ctx.admin, ctx.orgId, { now: ctx.now })
    if (!r.ready) return tile(card, goal, null)
    const cents = r.units.reduce((t, u) => t + u.amountCents, 0)
    return tile(card, goal, cents / 100, { sub: `${r.units.length} to bill${r.notBillable.length ? ` · ${r.notBillable.length} cannot be billed yet (no price, yearly or hourly)` : ''}` })
  }
  // qb: records the CRM could not send without a person (integration_outbox needs_you)
  const q = await loadQuickBooksStuckQueue(ctx.admin, ctx.orgId)
  return listCard(card, queueRows(q ?? undefined, 'warn'), q?.count ?? 0, 'Everything has reached QuickBooks.')
}

/* --------------------------------- off-season --------------------------------- */

async function renewals(ctx: RoleCtx, card: DashboardCard, goal: number | null, measure: string): Promise<CardData> {
  const { ready, plans } = await ctx.plans()
  if (!ready) return measure === 'renewals' ? { ...listCard(card, [], 0, ''), failed: true } : tile(card, goal, null)
  if (measure === 'nextSeason') {
    const upcoming = plans.filter((p) => p.status === 'active' && p.start_date > ctx.win.today)
    const money = ctx.viewer.financials
    const total = upcoming.reduce((t, p) => t + planContractValue(p, p.start_date, addDaysYmd(p.start_date, 364)).value, 0)
    return tile(card, goal, upcoming.length, upcoming.length && money ? { sub: `${usd(total)} over their first 12 months` } : {})
  }
  const due = plansToRenew(plans, ctx.win.today)
  const ids = Array.from(new Set(due.slice(0, ROW_CAP).map((p) => p.customer_id)))
  const names = new Map<string, string>()
  if (ids.length) {
    const { data } = await orgDb(ctx.admin, ctx.orgId).from('customers').select('id, name').in('id', ids)
    for (const c of (data ?? []) as Array<{ id: string; name: string | null }>) names.set(c.id, c.name || 'Customer')
  }
  return listCard(card, due.slice(0, ROW_CAP).map((p) => ({ id: p.id, title: names.get(p.customer_id) ?? 'Customer', detail: `${p.name} · ${p.status === 'ended' ? 'ended' : 'ends'} ${p.end_date}`, href: `/customers/${p.customer_id}` })), due.length, 'Every ending plan has been renewed.')
}
