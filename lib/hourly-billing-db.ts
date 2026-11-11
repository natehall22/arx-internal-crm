/**
 * Hourly (time & materials) billing — the DB side (server only). Rules: lib/hourly-billing.ts (pure). THE writer of
 * approved hours: SQL approve_billed_time (migration 202611120030), one transaction under the same per-company lock as
 * create_service_invoice, so a double tap, two office people or Ready to bill can never bill the same day / visit twice.
 *
 * Reads time_entries (the time clock's own table) and never writes it: payroll keeps the exact minutes.
 * Invoices: a job billed by the hour gets a JOB invoice (job_id; number INV-<YY>-<job>-<seq>); a visit of a plan billed by
 * the hour gets an invoice without a job (the customer's), with every line carrying the visit (work_order_id), exactly
 * as Ready to bill does — so each refuses what the other billed.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { orgTimeZone } from '@/lib/cron-orgs'
import {
  billableLines,
  clockedDays,
  dayBillableHours,
  dayClockedSeconds,
  invoiceLinesForDay,
  jobTarget,
  linesFromEdit,
  linesFromSnapshot,
  approvalLineSnapshot,
  parseDayEdit,
  readHourlyBillingSettings,
  sameLines,
  visitTarget,
  isYmd,
  type BillContext,
  type BillLine,
  type DayClock,
  type HourlyBillingSettings,
  type Rate,
  type TargetKey,
} from '@/lib/hourly-billing'
import { sendCustomerInvoice } from '@/lib/invoice-email'
import { computeCustomerSalesTax, loadOrgSalesTax } from '@/lib/sales-tax-server'
import type { SalesTaxSettings } from '@/lib/sales-tax'
import { chunks, loadAddresses, loadBilled, loadCustomers, type BillingCustomer } from '@/lib/service-billing-db'
import { addDaysYmd, planPriceOn, SERVICE_STEP, SERVICE_VISIT_TYPE, ymdInZone } from '@/lib/service-plans'
import { isMissingColumn, isMissingTable } from '@/lib/supabase/errors'
import { orgDb } from '@/lib/supabase/org-db'
import { TIME_ENTRY_COLUMNS, entryFromRow, localTimeToInstant, type TimeEntry } from '@/lib/time-tracking'
import type { JobInvoice } from '@/lib/types/invoices'

export const HOURLY_BILLING_NOT_READY = 'Hourly billing turns on once the database update for it is applied.'
export const HOURS_LOOKBACK_DAYS = 45
export const MAX_HOURS_LOOKBACK_DAYS = 366
export const MAX_DAYS_PER_APPROVAL = 31

type Fail = { ok: false; status: 400 | 404 | 409 | 503; error: string }

/** The migration is not applied yet (billing_mode / billed_time_days missing). */
export function isHourlyBillingNotReady(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  return isMissingTable(error) || isMissingColumn(error, 'billing_mode') || isMissingColumn(error, 'hourly_rate_item_id') || /billed_time_days|approve_billed_time/.test(String(error.message ?? ''))
}

// ---------------------------------------------------------------------------------------------------------------------
// Company facts
// ---------------------------------------------------------------------------------------------------------------------

export type HourlyOrgFacts = { settings: HourlyBillingSettings; timeZone: string; salesTax: SalesTaxSettings | null }

export async function loadHourlyOrgFacts(admin: SupabaseClient, orgId: string): Promise<HourlyOrgFacts> {
  const { data } = await admin.from('orgs').select('timezone, hb:settings->hourlyBilling').eq('id', orgId).maybeSingle()
  const row = (data ?? {}) as { timezone?: unknown; hb?: unknown }
  return { settings: readHourlyBillingSettings(row.hb ?? {}), timeZone: orgTimeZone(row.timezone), salesTax: await loadOrgSalesTax(admin, orgId) }
}

export type PriceItem = { id: string; name: string; unit: string; unitPrice: number; taxable: boolean; active: boolean; isLabor: boolean }

export async function loadPriceItems(admin: SupabaseClient, orgId: string): Promise<Map<string, PriceItem>> {
  const out = new Map<string, PriceItem>()
  const { data, error } = await orgDb(admin, orgId).from('pricebook_items').select('id, name, unit, unit_price, is_taxable, active, is_labor').limit(3000)
  if (error) throw new Error(`hourly billing: read price book: ${error.message}`)
  for (const r of (data ?? []) as Array<Record<string, unknown>>) {
    out.set(String(r.id), {
      id: String(r.id),
      name: String(r.name ?? 'Item'),
      unit: String(r.unit ?? ''),
      unitPrice: Number(r.unit_price ?? 0) || 0,
      taxable: r.is_taxable !== false,
      active: r.active !== false,
      isLabor: r.is_labor === true,
    })
  }
  return out
}

export const rateOf = (i: PriceItem): Rate => ({ itemId: i.id, name: i.name, rateCents: Math.round(i.unitPrice * 100), taxable: i.taxable })

/** Machines / labor rates: price-book items priced per hour (unit 'hour', migration 202611100090). Active ones only. */
export function hourItems(items: ReadonlyMap<string, PriceItem>): PriceItem[] {
  return Array.from(items.values()).filter((i) => i.unit === 'hour' && i.active).sort((a, b) => a.name.localeCompare(b.name))
}

// ---------------------------------------------------------------------------------------------------------------------
// What is billed by the hour
// ---------------------------------------------------------------------------------------------------------------------

export type HoursTarget = {
  key: TargetKey
  kind: 'job' | 'visit'
  id: string
  /** "Job 26-0041" / the plan's name. */
  title: string
  customerId: string | null
  address: string | null
  labor: Rate | null
  estimatedHours: number | null
  /** Visit: its scheduled day (shown even with no clock time, to type hours). */
  visitDate: string | null
  /** Visit already on a live invoice (Ready to bill or an earlier approval). */
  visitBilled: boolean
}

type JobRow = { id: string; job_number: string | null; customer_id: string | null; address_text: string | null; status: string | null; estimated_hours: number | string | null; hourly_rate_item_id: string | null }

async function loadJobTargets(admin: SupabaseClient, orgId: string, items: ReadonlyMap<string, PriceItem>, onlyId?: string): Promise<HoursTarget[] | null> {
  let q = orgDb(admin, orgId)
    .from('production_jobs')
    .select('id, job_number, customer_id, address_text, status, estimated_hours, hourly_rate_item_id')
    .eq('billing_mode', 'time_materials')
    .neq('status', 'cancelled')
  if (onlyId) q = q.eq('id', onlyId)
  const { data, error } = await q.order('job_number', { ascending: false }).limit(500)
  if (error) {
    if (isHourlyBillingNotReady(error)) return null
    throw new Error(`hourly billing: read jobs: ${error.message}`)
  }
  return ((data ?? []) as JobRow[]).map((j) => {
    const item = j.hourly_rate_item_id ? items.get(j.hourly_rate_item_id) : undefined
    return {
      key: jobTarget(j.id),
      kind: 'job' as const,
      id: j.id,
      title: j.job_number ? `Job ${j.job_number}` : 'Job',
      customerId: j.customer_id,
      address: j.address_text,
      labor: item ? rateOf(item) : null,
      estimatedHours: j.estimated_hours == null ? null : Number(j.estimated_hours),
      visitDate: null,
      visitBilled: false,
    }
  })
}

type PlanRow = { id: string; name: string | null; customer_id: string; property_id: string | null; price: number | string | null; previous_price: number | string | null; price_starts_on: string | null; taxable: boolean | null }

async function loadVisitTargets(admin: SupabaseClient, orgId: string, fromYmd: string, onlyId?: string): Promise<HoursTarget[] | null> {
  const plans = new Map<string, PlanRow>()
  const { data: planRows, error: planError } = await orgDb(admin, orgId)
    .from('service_plans')
    .select('id, name, customer_id, property_id, price, previous_price, price_starts_on, taxable')
    .eq('billing_basis', 'per_hour')
    .limit(2000)
  if (planError) {
    if (isMissingTable(planError)) return []
    throw new Error(`hourly billing: read plans: ${planError.message}`)
  }
  for (const p of (planRows ?? []) as PlanRow[]) plans.set(p.id, p)
  if (plans.size === 0) return []
  const visits: Array<{ id: string; service_plan_id: string; customer_id: string | null; property_id: string | null; scheduled_date: string | null; status: string; visit_step: string | null }> = []
  for (const ids of chunks(Array.from(plans.keys()))) {
    let q = orgDb(admin, orgId)
      .from('work_orders')
      .select('id, service_plan_id, customer_id, property_id, scheduled_date, status, visit_step')
      .eq('work_order_type', SERVICE_VISIT_TYPE)
      .is('job_id', null)
      .in('service_plan_id', ids)
      .not('status', 'in', '(cancelled,skipped)')
    q = onlyId ? q.eq('id', onlyId) : q.gte('scheduled_date', fromYmd)
    const { data, error } = await q.limit(5000)
    if (error) throw new Error(`hourly billing: read visits: ${error.message}`)
    visits.push(...((data ?? []) as typeof visits))
  }
  const live = visits.filter((v) => (v.visit_step || SERVICE_STEP) === SERVICE_STEP)
  const billed = await loadBilled(admin, orgId, live.map((v) => v.id), [])
  const addresses = await loadAddresses(admin, orgId, Array.from(new Set(live.map((v) => v.property_id ?? plans.get(v.service_plan_id)?.property_id ?? '').filter(Boolean))))
  return live.map((v) => {
    const p = plans.get(v.service_plan_id)!
    const day = v.scheduled_date ?? fromYmd
    const price = planPriceOn({ price: p.price == null ? null : Number(p.price), previous_price: p.previous_price == null ? null : Number(p.previous_price), price_starts_on: p.price_starts_on, billing_basis: 'per_hour' }, day)
    const propertyId = v.property_id ?? p.property_id
    return {
      key: visitTarget(v.id),
      kind: 'visit' as const,
      id: v.id,
      title: p.name || 'Visit',
      customerId: v.customer_id ?? p.customer_id,
      address: propertyId ? addresses[propertyId] ?? null : null,
      // The plan's price (as in effect on the visit's day) is the labor rate; plan taxable = the line's tax flag.
      labor: price != null && price > 0 ? { itemId: null, name: p.name || 'Labor', rateCents: Math.round(price * 100), taxable: p.taxable === true } : null,
      estimatedHours: null,
      visitDate: v.scheduled_date,
      visitBilled: billed?.visitIds.has(v.id) ?? false,
    }
  })
}

// ---------------------------------------------------------------------------------------------------------------------
// Clock time + approvals
// ---------------------------------------------------------------------------------------------------------------------

async function loadEntries(admin: SupabaseClient, orgId: string, fromMs: number, toMs: number): Promise<TimeEntry[] | null> {
  const out: TimeEntry[] = []
  const PAGE = 1000
  for (let page = 0; page < 50_000; page += PAGE) {
    const { data, error } = await orgDb(admin, orgId)
      .from('time_entries')
      .select(TIME_ENTRY_COLUMNS)
      .is('removed_at', null)
      .gte('started_at', new Date(fromMs).toISOString())
      .lt('started_at', new Date(toMs).toISOString())
      .order('started_at', { ascending: true })
      .order('id', { ascending: true })
      .range(page, page + PAGE - 1)
    if (error) {
      // No time clock yet (migration 202611110070): typed hours only.
      if (isMissingTable(error)) return []
      throw new Error(`hourly billing: read time: ${error.message}`)
    }
    out.push(...((data ?? []) as Array<Record<string, unknown>>).map(entryFromRow))
    if ((data ?? []).length < PAGE) break
  }
  return out
}

export type Approval = {
  id: string
  target: TargetKey
  date: string
  source: 'clock' | 'typed' | 'edited'
  editReason: string | null
  billableHours: number
  lines: BillLine[]
  invoiceId: string | null
  invoiceNumber: string | null
  invoiceStatus: string | null
  approvedAt: string
}

async function loadApprovals(admin: SupabaseClient, orgId: string, fromYmd: string, only?: TargetKey): Promise<Approval[] | null> {
  let q = orgDb(admin, orgId)
    .from('billed_time_days')
    .select('id, production_job_id, work_order_id, work_date, source, edit_reason, billable_hours, lines, invoice_id, approved_at')
    .eq('status', 'approved')
  if (only?.startsWith('job:')) q = q.eq('production_job_id', only.slice(4))
  else if (only?.startsWith('visit:')) q = q.eq('work_order_id', only.slice(6))
  else q = q.gte('work_date', fromYmd)
  const { data, error } = await q.order('work_date', { ascending: true }).limit(5000)
  if (error) {
    if (isHourlyBillingNotReady(error)) return null
    throw new Error(`hourly billing: read approvals: ${error.message}`)
  }
  const rows = (data ?? []) as Array<Record<string, unknown>>
  const invoices = new Map<string, { number: string; status: string }>()
  const ids = Array.from(new Set(rows.map((r) => r.invoice_id as string | null).filter((x): x is string => !!x)))
  for (const part of chunks(ids)) {
    const { data: inv, error: invError } = await orgDb(admin, orgId).from('job_invoices').select('id, invoice_number, status').in('id', part)
    if (invError) throw new Error(`hourly billing: read invoices: ${invError.message}`)
    for (const r of (inv ?? []) as Array<{ id: string; invoice_number: string; status: string }>) invoices.set(r.id, { number: r.invoice_number, status: r.status })
  }
  return rows.map((r) => {
    const inv = r.invoice_id ? invoices.get(String(r.invoice_id)) : undefined
    return {
      id: String(r.id),
      target: r.production_job_id ? jobTarget(String(r.production_job_id)) : visitTarget(String(r.work_order_id)),
      date: String(r.work_date),
      source: r.source as Approval['source'],
      editReason: (r.edit_reason as string | null) ?? null,
      billableHours: Number(r.billable_hours ?? 0),
      lines: linesFromSnapshot(r.lines),
      invoiceId: (r.invoice_id as string | null) ?? null,
      invoiceNumber: inv?.number ?? null,
      invoiceStatus: inv?.status ?? null,
      approvedAt: String(r.approved_at),
    }
  })
}

// ---------------------------------------------------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------------------------------------------------

export type HoursDayStatus = 'ready' | 'open' | 'no_time' | 'approved' | 'voided'

export type HoursDay = {
  date: string
  status: HoursDayStatus
  /** Labor person-seconds on the clock (0 = typed hours only). */
  clockedSeconds: number
  /** What would be billed (ready / open), or what was billed (approved / voided). */
  lines: BillLine[]
  needsReview: boolean
  approval: Approval | null
}

export type HoursTargetView = HoursTarget & {
  customerName: string
  days: HoursDay[]
  /** Hours approved so far (all time; jobs) — beside the estimate. */
  billedHours: number
}

export type HoursToBill =
  | { ready: false; error: string }
  | {
      ready: true
      today: string
      lookbackDays: number
      timeZone: string
      settings: HourlyBillingSettings
      targets: HoursTargetView[]
      customers: Record<string, BillingCustomer>
      /** Machines the office may add (active price-book items priced per hour). */
      equipment: Rate[]
      trip: Rate | null
      salesTax: SalesTaxSettings | null
      maxDaysPerApproval: number
    }

type Loaded = {
  facts: HourlyOrgFacts
  items: Map<string, PriceItem>
  targets: HoursTarget[]
  clock: Map<TargetKey, Map<string, DayClock>>
  approvals: Approval[]
  today: string
}

function billContext(facts: HourlyOrgFacts, items: ReadonlyMap<string, PriceItem>, labor: Rate | null): BillContext {
  const equipment = new Map<string, Rate>()
  // Every hour item (active or not): time already clocked on a machine since retired still bills at its price.
  for (const i of Array.from(items.values())) if (i.unit === 'hour') equipment.set(i.id, rateOf(i))
  const tripItem = facts.settings.tripChargeItemId ? items.get(facts.settings.tripChargeItemId) : undefined
  return { settings: facts.settings, labor, equipment, trip: tripItem ? rateOf(tripItem) : null }
}

async function loadAll(admin: SupabaseClient, orgId: string, opts: { fromYmd: string; now: Date; only?: { kind: 'job' | 'visit'; id: string } }): Promise<Loaded | { notReady: true }> {
  const facts = await loadHourlyOrgFacts(admin, orgId)
  const items = await loadPriceItems(admin, orgId)
  const jobs = opts.only?.kind === 'visit' ? [] : await loadJobTargets(admin, orgId, items, opts.only?.id)
  if (jobs === null) return { notReady: true }
  const visits = opts.only?.kind === 'job' ? [] : await loadVisitTargets(admin, orgId, opts.fromYmd, opts.only?.id)
  if (visits === null) return { notReady: true }
  const targets = [...jobs, ...visits]
  const only = opts.only ? (opts.only.kind === 'job' ? jobTarget(opts.only.id) : visitTarget(opts.only.id)) : undefined
  const approvals = await loadApprovals(admin, orgId, opts.fromYmd, only)
  if (approvals === null) return { notReady: true }
  const today = ymdInZone(opts.now, facts.timeZone)
  const fromMs = (localTimeToInstant(opts.fromYmd, '00:00', facts.timeZone)?.getTime() ?? opts.now.getTime()) - 86_400_000
  const entries = targets.length ? await loadEntries(admin, orgId, fromMs, opts.now.getTime() + 60_000) : []
  const jobIds = new Set(jobs.map((j) => j.id))
  const visitIds = new Set(visits.map((v) => v.id))
  const targetOf = (e: TimeEntry): TargetKey | null => {
    if (e.workOrderId && visitIds.has(e.workOrderId)) return visitTarget(e.workOrderId)
    if (e.jobId && jobIds.has(e.jobId)) return jobTarget(e.jobId)
    return null
  }
  const clock = clockedDays(entries ?? [], { timeZone: facts.timeZone, targetOf, now: opts.now.getTime() })
  return { facts, items, targets, clock, approvals, today }
}

function daysFor(t: HoursTarget, l: Loaded, fromYmd: string): HoursDay[] {
  const ctx = billContext(l.facts, l.items, t.labor)
  const byDate = new Map<string, HoursDay>()
  for (const [date, d] of Array.from(l.clock.get(t.key)?.entries() ?? [])) {
    if (date < fromYmd) continue
    const lines = billableLines(d, ctx)
    byDate.set(date, { date, status: d.open ? 'open' : 'ready', clockedSeconds: dayClockedSeconds(d), lines, needsReview: d.needsReview, approval: null })
  }
  for (const a of l.approvals) {
    if (a.target !== t.key) continue
    const clocked = byDate.get(a.date)
    byDate.set(a.date, {
      date: a.date,
      status: a.invoiceStatus === 'void' ? 'voided' : 'approved',
      clockedSeconds: clocked?.clockedSeconds ?? 0,
      lines: a.lines,
      needsReview: false,
      approval: a,
    })
  }
  // A visit with no clock time and not billed yet: offer it for typed hours on its own day.
  if (t.kind === 'visit' && t.visitDate && !t.visitBilled && !byDate.has(t.visitDate) && t.visitDate <= l.today && t.visitDate >= fromYmd) {
    byDate.set(t.visitDate, { date: t.visitDate, status: 'no_time', clockedSeconds: 0, lines: [], needsReview: false, approval: null })
  }
  // A visit billed outside this screen (Ready to bill) shows nothing to bill.
  if (t.kind === 'visit' && t.visitBilled) for (const [k, d] of Array.from(byDate.entries())) if (!d.approval) byDate.delete(k)
  return Array.from(byDate.values()).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
}

export async function loadHoursToBill(admin: SupabaseClient, orgId: string, opts: { lookbackDays?: number; now?: Date } = {}): Promise<HoursToBill> {
  const now = opts.now ?? new Date()
  const lookbackDays = Math.min(MAX_HOURS_LOOKBACK_DAYS, Math.max(1, Math.round(opts.lookbackDays ?? HOURS_LOOKBACK_DAYS)))
  const facts0 = await loadHourlyOrgFacts(admin, orgId)
  const fromYmd = addDaysYmd(ymdInZone(now, facts0.timeZone), -lookbackDays)
  const l = await loadAll(admin, orgId, { fromYmd, now })
  if ('notReady' in l) return { ready: false, error: HOURLY_BILLING_NOT_READY }
  const totals = await loadJobBilledHours(admin, orgId, l.targets.filter((t) => t.kind === 'job').map((t) => t.id))
  const targets: HoursTargetView[] = []
  for (const t of l.targets) {
    const days = daysFor(t, l, fromYmd)
    if (days.length === 0 && t.kind === 'visit') continue
    targets.push({ ...t, customerName: '', days, billedHours: totals.get(t.id) ?? 0 })
  }
  const customers = await loadCustomers(admin, orgId, Array.from(new Set(targets.map((t) => t.customerId).filter((x): x is string => !!x))))
  for (const t of targets) t.customerName = (t.customerId && customers[t.customerId]?.name) || 'No customer'
  // Days waiting first, then by the newest day.
  const waiting = (t: HoursTargetView) => t.days.some((d) => d.status === 'ready' || d.status === 'open' || d.status === 'no_time')
  targets.sort((a, b) => Number(waiting(b)) - Number(waiting(a)) || (b.days[0]?.date ?? '').localeCompare(a.days[0]?.date ?? '') || a.title.localeCompare(b.title))
  const ctx = billContext(l.facts, l.items, null)
  return {
    ready: true,
    today: l.today,
    lookbackDays,
    timeZone: l.facts.timeZone,
    settings: l.facts.settings,
    targets,
    customers,
    equipment: hourItems(l.items).map(rateOf),
    trip: ctx.trip,
    salesTax: l.facts.salesTax,
    maxDaysPerApproval: MAX_DAYS_PER_APPROVAL,
  }
}

/** Approved billable hours per job, all time (the estimate's "billed so far"). */
async function loadJobBilledHours(admin: SupabaseClient, orgId: string, jobIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  for (const part of chunks(jobIds)) {
    const { data, error } = await orgDb(admin, orgId).from('billed_time_days').select('production_job_id, billable_hours').eq('status', 'approved').in('production_job_id', part).limit(20000)
    if (error) {
      if (isHourlyBillingNotReady(error)) return out
      throw new Error(`hourly billing: read billed hours: ${error.message}`)
    }
    for (const r of (data ?? []) as Array<{ production_job_id: string; billable_hours: number | string }>)
      out.set(r.production_job_id, Math.round(((out.get(r.production_job_id) ?? 0) + Number(r.billable_hours)) * 100) / 100)
  }
  return out
}

// ---------------------------------------------------------------------------------------------------------------------
// Approve → invoice (THE path); un-approve
// ---------------------------------------------------------------------------------------------------------------------

export type ApproveRequest = {
  target: { kind: 'job' | 'visit'; id: string }
  days: Array<{ date: string; edit?: unknown }>
  /** Email an invoice without a job to the customer now (job invoices are sent from the job). */
  send?: boolean
}

export type ApproveResult = {
  ok: true
  invoiceId: string
  invoiceNumber: string
  totalCents: number
  isJobInvoice: boolean
  sent: boolean
  sendError: string | null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function parseApproveRequest(body: unknown): { req: ApproveRequest } | { error: string } {
  const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  const t = b.target && typeof b.target === 'object' ? (b.target as Record<string, unknown>) : {}
  if ((t.kind !== 'job' && t.kind !== 'visit') || typeof t.id !== 'string' || !UUID_RE.test(t.id)) return { error: 'Pick the job or visit' }
  if (!Array.isArray(b.days) || b.days.length === 0) return { error: 'Pick at least one day' }
  if (b.days.length > MAX_DAYS_PER_APPROVAL) return { error: `At most ${MAX_DAYS_PER_APPROVAL} days at a time` }
  const days: ApproveRequest['days'] = []
  const seen = new Set<string>()
  for (const d of b.days as unknown[]) {
    const x = d && typeof d === 'object' ? (d as Record<string, unknown>) : {}
    if (!isYmd(x.date)) return { error: 'Each day needs a real date' }
    if (seen.has(x.date)) return { error: 'A day is listed twice' }
    seen.add(x.date)
    days.push(x.edit === undefined || x.edit === null ? { date: x.date } : { date: x.date, edit: x.edit })
  }
  return { req: { target: { kind: t.kind, id: t.id }, days, send: b.send === true } }
}

/**
 * Approve days of hours and put them on ONE new draft invoice. Everything is recomputed from the database here; the
 * browser only sends which days and, for an edit or typed hours, kinds / machines / people / hours (never prices).
 */
export async function approveHours(admin: SupabaseClient, orgId: string, userId: string, req: ApproveRequest, now = new Date()): Promise<ApproveResult | Fail> {
  const dates = req.days.map((d) => d.date).sort()
  const facts0 = await loadHourlyOrgFacts(admin, orgId)
  const today = ymdInZone(now, facts0.timeZone)
  if (dates[dates.length - 1] > today) return { ok: false, status: 400, error: 'You can only bill days that have happened' }
  const l = await loadAll(admin, orgId, { fromYmd: addDaysYmd(dates[0], -1), now, only: req.target })
  if ('notReady' in l) return { ok: false, status: 503, error: HOURLY_BILLING_NOT_READY }
  const target = l.targets[0]
  if (!target || target.id !== req.target.id) return { ok: false, status: 404, error: req.target.kind === 'job' ? 'That job is not billed by the hour' : 'That visit is not on a plan billed by the hour' }
  if (target.visitBilled) return { ok: false, status: 409, error: 'This visit is already on an invoice' }
  const ctx = billContext(l.facts, l.items, target.labor)

  const days: Array<{ work_date: string; source: 'clock' | 'typed' | 'edited'; edit_reason: string | null; clocked_seconds: number; billable_hours: number; lines: unknown }> = []
  const invoiceLines: ReturnType<typeof invoiceLinesForDay> = []
  for (const d of [...req.days].sort((a, b) => (a.date < b.date ? -1 : 1))) {
    if (l.approvals.some((a) => a.target === target.key && a.date === d.date)) return { ok: false, status: 409, error: `${d.date} is already billed` }
    const clock = l.clock.get(target.key)?.get(d.date)
    const computed = clock ? billableLines(clock, ctx) : []
    const clocked = clock ? dayClockedSeconds(clock) : 0
    let lines: BillLine[]
    let source: 'clock' | 'typed' | 'edited'
    let reason: string | null = null
    if (d.edit !== undefined) {
      const parsed = parseDayEdit(d.edit)
      if ('error' in parsed) return { ok: false, status: 400, error: parsed.error }
      const built = linesFromEdit(parsed.edit, ctx)
      if ('error' in built) return { ok: false, status: 400, error: built.error }
      lines = built.lines
      const hasClock = !!clock && (clock.people.size > 0 || clock.machines.size > 0)
      if (!hasClock) {
        source = 'typed'
        reason = parsed.edit.reason || null
      } else if (sameLines(lines, computed) && !clock?.open) {
        source = 'clock'
        lines = computed
      } else {
        if (!parsed.edit.reason) return { ok: false, status: 400, error: 'Say why the hours changed' }
        source = 'edited'
        reason = parsed.edit.reason
      }
    } else {
      if (!clock || computed.length === 0) return { ok: false, status: 400, error: `No clock time on ${d.date} — type the hours` }
      if (clock.open) return { ok: false, status: 409, error: `Someone is still clocked in on ${d.date} — wait for them to clock out, or type the hours` }
      lines = computed
      source = 'clock'
    }
    if (lines.some((x) => x.rateCents == null)) {
      return { ok: false, status: 400, error: target.kind === 'job' ? 'Set the labor rate for this job first' : 'Set the plan’s hourly rate first' }
    }
    days.push({ work_date: d.date, source, edit_reason: reason, clocked_seconds: clocked, billable_hours: dayBillableHours(lines), lines: approvalLineSnapshot(lines) })
    invoiceLines.push(...invoiceLinesForDay(d.date, lines))
  }
  if (!invoiceLines.some((x) => x.unit_price_cents > 0)) return { ok: false, status: 400, error: 'Nothing to bill — every line is $0' }

  const tax = await computeCustomerSalesTax(
    admin,
    orgId,
    target.customerId,
    invoiceLines.map((x) => ({ amountCents: Math.round(x.qty * x.unit_price_cents), taxable: x.taxable }))
  )
  const { data, error } = await admin.rpc('approve_billed_time', {
    p_org: orgId,
    p_job: target.kind === 'job' ? target.id : null,
    p_visit: target.kind === 'visit' ? target.id : null,
    p_created_by: userId,
    p_days: days,
    p_lines: invoiceLines,
    p_totals: {
      subtotal_cents: tax.subtotalCents,
      taxable_subtotal_cents: tax.taxableCents,
      tax_cents: tax.taxCents,
      tax_lines: tax.taxLines,
      total_cents: tax.subtotalCents + tax.taxCents,
    },
  })
  if (error) {
    if (isHourlyBillingNotReady(error) || error.code === 'PGRST202' || error.code === '42883') return { ok: false, status: 503, error: HOURLY_BILLING_NOT_READY }
    if (error.code === 'P0002') return { ok: false, status: 404, error: 'Not found' }
    if (error.code === '23505') return { ok: false, status: 409, error: 'Those hours were just billed by someone else' }
    if (error.code === '22023') return { ok: false, status: 400, error: String(error.message ?? 'Could not bill these hours') }
    throw new Error(`hourly billing: approve: ${error.message}`)
  }
  const r = (data ?? {}) as { invoice_id?: string | null; invoice_number?: string | null }
  if (!r.invoice_id) return { ok: false, status: 409, error: 'Those hours are already billed' }

  const { data: inv } = await orgDb(admin, orgId).from('job_invoices').select('*').eq('id', r.invoice_id).maybeSingle()
  let invoice = inv as JobInvoice | null
  let sent = false
  let sendError: string | null = null
  if (req.send && target.kind === 'visit' && invoice) {
    const customers = target.customerId ? await loadCustomers(admin, orgId, [target.customerId]) : {}
    const email = target.customerId ? customers[target.customerId]?.email : null
    if (!email) sendError = 'No email on file — left as a draft'
    else {
      try {
        const s = await sendCustomerInvoice(admin, orgId, invoice, email)
        if (s.ok) {
          sent = true
          invoice = s.invoice
        } else sendError = s.error
      } catch (e) {
        console.error('[hourly billing] send failed', r.invoice_id, e)
        sendError = 'Email failed — left as a draft'
      }
    }
  }
  return {
    ok: true,
    invoiceId: r.invoice_id,
    invoiceNumber: invoice?.invoice_number ?? r.invoice_number ?? '',
    totalCents: invoice?.total_cents ?? tax.subtotalCents + tax.taxCents,
    isJobInvoice: target.kind === 'job',
    sent,
    sendError,
  }
}

/** Un-approve a day: only once the invoice it went on is void (then the day can be billed again), with a reason. */
export async function unapproveHours(admin: SupabaseClient, orgId: string, userId: string, approvalId: string, reason: string): Promise<{ ok: true } | Fail> {
  const why = reason.trim()
  if (!why) return { ok: false, status: 400, error: 'Say why' }
  const { data, error } = await admin.rpc('unapprove_billed_time', { p_org: orgId, p_id: approvalId, p_user: userId, p_reason: why.slice(0, 500) })
  if (error) {
    if (isHourlyBillingNotReady(error) || error.code === 'PGRST202' || error.code === '42883') return { ok: false, status: 503, error: HOURLY_BILLING_NOT_READY }
    if (error.code === '22023') return { ok: false, status: 400, error: String(error.message) }
    throw new Error(`hourly billing: unapprove: ${error.message}`)
  }
  if (data === true) return { ok: true }
  const { data: row } = await orgDb(admin, orgId).from('billed_time_days').select('id, status, invoice_id').eq('id', approvalId).maybeSingle()
  if (!row || (row as { status: string }).status !== 'approved') return { ok: false, status: 404, error: 'Not found' }
  const invId = (row as { invoice_id: string | null }).invoice_id
  const { data: inv } = invId ? await orgDb(admin, orgId).from('job_invoices').select('invoice_number').eq('id', invId).maybeSingle() : { data: null }
  return { ok: false, status: 409, error: `Void invoice ${(inv as { invoice_number?: string } | null)?.invoice_number ?? ''} first, then un-approve`.replace('  ', ' ') }
}

// ---------------------------------------------------------------------------------------------------------------------
// A job's time & materials setup (job page card)
// ---------------------------------------------------------------------------------------------------------------------

export type JobHourlySetup = {
  mode: 'fixed' | 'time_materials'
  estimatedHours: number | null
  rateItemId: string | null
  /** Price-book items priced per hour (labor rates and machines). */
  rateChoices: Array<{ id: string; name: string; rateCents: number; isLabor: boolean }>
  /** From the job's quote: its hourly lines (estimated hours and the labor rate it was sold at). */
  fromQuote: { estimatedHours: number | null; rateItemId: string | null; lines: Array<{ name: string; hours: number }> } | null
  billedHours: number
}

export async function loadJobHourlySetup(admin: SupabaseClient, orgId: string, jobId: string): Promise<JobHourlySetup | Fail> {
  const { data, error } = await orgDb(admin, orgId)
    .from('production_jobs')
    .select('id, billing_mode, estimated_hours, hourly_rate_item_id, linked_proposal_id, accepted_proposal_id, project_id')
    .eq('id', jobId)
    .maybeSingle()
  if (error) {
    if (isHourlyBillingNotReady(error)) return { ok: false, status: 503, error: HOURLY_BILLING_NOT_READY }
    throw new Error(`hourly billing: read job: ${error.message}`)
  }
  if (!data) return { ok: false, status: 404, error: 'Not found' }
  const job = data as { billing_mode: string | null; estimated_hours: number | string | null; hourly_rate_item_id: string | null; linked_proposal_id?: string | null; accepted_proposal_id?: string | null; project_id?: string | null }
  const items = await loadPriceItems(admin, orgId)
  const choices = hourItems(items)
  const fromQuote = await quoteHourLines(admin, orgId, job, items)
  return {
    mode: job.billing_mode === 'time_materials' ? 'time_materials' : 'fixed',
    estimatedHours: job.estimated_hours == null ? null : Number(job.estimated_hours),
    rateItemId: job.hourly_rate_item_id,
    rateChoices: choices.map((i) => ({ id: i.id, name: i.name, rateCents: Math.round(i.unitPrice * 100), isLabor: i.isLabor })),
    fromQuote,
    billedHours: (await loadJobBilledHours(admin, orgId, [jobId])).get(jobId) ?? 0,
  }
}

async function quoteHourLines(
  admin: SupabaseClient,
  orgId: string,
  job: { linked_proposal_id?: string | null; accepted_proposal_id?: string | null; project_id?: string | null },
  items: ReadonlyMap<string, PriceItem>
): Promise<JobHourlySetup['fromQuote']> {
  const { resolveJobProposalId } = await import('@/lib/job-sold-scope')
  const proposalId = await resolveJobProposalId(admin, orgId, job)
  if (!proposalId) return null
  const { data } = await orgDb(admin, orgId).from('proposal_line_items').select('name, unit, quantity, pricebook_item_id').eq('proposal_id', proposalId).eq('unit', 'hour').limit(200)
  const rows = (data ?? []) as Array<{ name: string; quantity: number | string; pricebook_item_id: string | null }>
  if (rows.length === 0) return null
  const labor = rows.filter((r) => r.pricebook_item_id && items.get(r.pricebook_item_id)?.isLabor)
  const pick = labor.length ? labor : rows.slice(0, 1)
  const hours = Math.round(pick.reduce((n, r) => n + (Number(r.quantity) || 0), 0) * 100) / 100
  const rateItem = pick.find((r) => r.pricebook_item_id && items.get(r.pricebook_item_id)?.unit === 'hour')?.pricebook_item_id ?? null
  return { estimatedHours: hours > 0 ? hours : null, rateItemId: rateItem, lines: rows.map((r) => ({ name: r.name, hours: Number(r.quantity) || 0 })) }
}

export type JobHourlyPatch = { mode: 'fixed' | 'time_materials'; estimatedHours: number | null; rateItemId: string | null }

export function parseJobHourlyPatch(body: unknown): { patch: JobHourlyPatch } | { error: string } {
  const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  if (b.mode !== 'fixed' && b.mode !== 'time_materials') return { error: 'Pick how this job is billed' }
  let est: number | null = null
  if (b.estimatedHours != null && b.estimatedHours !== '') {
    const n = Number(b.estimatedHours)
    if (!Number.isFinite(n) || n < 0 || n > 100000 || Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) return { error: 'Estimated hours must be a number like 12.5' }
    est = Math.round(n * 100) / 100
  }
  const rate = b.rateItemId == null || b.rateItemId === '' ? null : b.rateItemId
  if (rate !== null && (typeof rate !== 'string' || !UUID_RE.test(rate))) return { error: 'Pick the labor rate from your price book' }
  return { patch: { mode: b.mode, estimatedHours: est, rateItemId: rate as string | null } }
}

/** Save a job's billing setup. The rate must be this company's price-book item priced per hour. */
export async function saveJobHourlySetup(admin: SupabaseClient, orgId: string, jobId: string, patch: JobHourlyPatch): Promise<{ ok: true } | Fail> {
  if (patch.rateItemId) {
    const items = await loadPriceItems(admin, orgId)
    const item = items.get(patch.rateItemId)
    if (!item || item.unit !== 'hour') return { ok: false, status: 400, error: 'Pick a price-book item priced per hour' }
  }
  const values =
    patch.mode === 'time_materials'
      ? { billing_mode: 'time_materials', estimated_hours: patch.estimatedHours, hourly_rate_item_id: patch.rateItemId }
      : // Back to "as sold": the estimate and rate are kept (switching back restores them). Approved hours stay billed.
        { billing_mode: null }
  const { data, error } = await orgDb(admin, orgId).from('production_jobs').update(values).eq('id', jobId).select('id').maybeSingle()
  if (error) {
    if (isHourlyBillingNotReady(error)) return { ok: false, status: 503, error: HOURLY_BILLING_NOT_READY }
    throw new Error(`hourly billing: save job: ${error.message}`)
  }
  if (!data) return { ok: false, status: 404, error: 'Not found' }
  return { ok: true }
}
