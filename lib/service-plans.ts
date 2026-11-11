/**
 * Service plans — the pure rules (client-safe, no I/O). A plan is recurring work at one property (weekly mowing April–
 * October, every 2 weeks in the shoulder months, monthly in winter). Its visits are `work_orders` rows
 * (`work_order_type = 'service_visit'`), created ONLY by `ensureServiceVisits` in lib/service-plans-db.ts from
 * `planVisitDates` here. Schema: supabase/migrations/202611110030_service_plans.sql.
 *
 * Dates are bare calendar days (`YYYY-MM-DD`): a visit is "on Tuesday", not at an instant, so all arithmetic is on
 * UTC-noon dates and daylight saving can never move a visit. The only clock input is "today", which the caller works out
 * in the company's own time zone (`ymdInZone`).
 */
import { HEALTH_RESULTS, HEALTH_RESULT_STYLE } from '@/lib/health-result'

export const SERVICE_FREQUENCIES = ['weekly', 'every_2_weeks', 'every_4_weeks', 'monthly', 'none'] as const
export type ServiceFrequency = (typeof SERVICE_FREQUENCIES)[number]
export const SERVICE_FREQUENCY_LABELS: Record<ServiceFrequency, string> = {
  weekly: 'Every week',
  every_2_weeks: 'Every 2 weeks',
  every_4_weeks: 'Every 4 weeks',
  monthly: 'Once a month',
  none: 'No visits',
}

export const SERVICE_PLAN_STATUSES = ['active', 'paused', 'ended'] as const
export type ServicePlanStatus = (typeof SERVICE_PLAN_STATUSES)[number]

export const BILLING_BASES = ['per_visit', 'per_month', 'per_year'] as const
export type BillingBasis = (typeof BILLING_BASES)[number]
export const BILLING_BASIS_LABELS: Record<BillingBasis, string> = { per_visit: 'per visit', per_month: 'per month', per_year: 'per year' }

/** The plan's own visit. Follow-on steps (a plan's `steps`) carry their own key instead. */
export const SERVICE_STEP = 'service'

export const SKIP_REASONS = ['rain', 'customer', 'holiday', 'other'] as const
export type SkipReason = (typeof SKIP_REASONS)[number]
export const SKIP_REASON_LABELS: Record<SkipReason, string> = {
  rain: 'Rain / weather',
  customer: 'Customer asked',
  holiday: 'Holiday',
  other: 'Other',
}

export const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const

/** The work order type every visit carries. Other readers of work_orders exclude it by this constant. */
export const SERVICE_VISIT_TYPE = 'service_visit'

/** How far ahead visits exist (days, today included). Lazy: the morning cron and page loads top it up. */
export const VISIT_HORIZON_DAYS = 42

/** Visit statuses as stored on work_orders.status, and the plain word people see. */
export const VISIT_STATUSES = ['scheduled', 'completed', 'skipped', 'cancelled'] as const
export type VisitStatus = (typeof VISIT_STATUSES)[number]
export const VISIT_STATUS_LABELS: Record<VisitStatus, string> = { scheduled: 'Scheduled', completed: 'Done', skipped: 'Skipped', cancelled: 'Cancelled' }

export type Season = { from: string; to: string; frequency: ServiceFrequency }

export type ServicePlanSchedule = {
  status: ServicePlanStatus
  start_date: string
  end_date: string | null
  paused_until: string | null
  seasons: Season[]
  preferred_weekday: number | null
}

export type ServicePlan = ServicePlanSchedule & {
  id: string
  org_id: string
  customer_id: string
  property_id: string
  trade: string
  name: string
  description: string | null
  price: number | null
  billing_basis: BillingBasis
  taxable: boolean
  /** Price rules copied from the template at sale; the answers for this home; the tier they matched (null = custom). */
  pricing: PlanPricing
  pricing_inputs: Record<string, number>
  tier_key: string | null
  /** Follow-on steps copied from the template at sale (cleaning → inspection …). */
  steps: PlanStep[]
  template_id: string | null
  template_version: number | null
  default_sub_id: string | null
  route_position: number | null
  created_by: string
  created_at: string
  updated_at: string
}

export const SERVICE_PLAN_COLUMNS =
  'id, org_id, customer_id, property_id, template_id, template_version, trade, name, description, price, billing_basis, taxable, pricing, pricing_inputs, tier_key, steps, status, start_date, end_date, paused_until, seasons, preferred_weekday, default_sub_id, route_position, created_by, created_at, updated_at'

// ---------------------------------------------------------------------------------------------------------------------
// Calendar-day arithmetic
// ---------------------------------------------------------------------------------------------------------------------

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const MD_RE = /^(\d{2})-(\d{2})$/
const DAY_MS = 86_400_000

export function isYmd(v: unknown): v is string {
  if (typeof v !== 'string') return false
  const m = YMD_RE.exec(v)
  if (!m) return false
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12))
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]
}

function toUtcNoon(ymd: string): number {
  const m = YMD_RE.exec(ymd)
  if (!m) throw new Error(`not a date: ${ymd}`)
  return Date.UTC(+m[1], +m[2] - 1, +m[3], 12)
}

function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

export function addDaysYmd(ymd: string, days: number): string {
  return fromUtc(toUtcNoon(ymd) + days * DAY_MS)
}

/** Whole days from a to b (b − a). */
export function daysBetweenYmd(a: string, b: string): number {
  return Math.round((toUtcNoon(b) - toUtcNoon(a)) / DAY_MS)
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOfYmd(ymd: string): number {
  return new Date(toUtcNoon(ymd)).getUTCDay()
}

/** Today's calendar day in a time zone (the company's `orgs.timezone`). */
export function ymdInZone(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

// ---------------------------------------------------------------------------------------------------------------------
// Seasons
// ---------------------------------------------------------------------------------------------------------------------

/** Valid month-day in a leap year (so 02-29 is allowed; in other years it simply never matches). */
export function isMonthDay(v: unknown): v is string {
  return typeof v === 'string' && MD_RE.test(v) && isYmd(`2024-${v}`)
}

/** Does a season (inclusive; may wrap the new year, e.g. 12-01 → 02-28) contain this date? */
export function seasonContains(s: Pick<Season, 'from' | 'to'>, ymd: string): boolean {
  const md = ymd.slice(5)
  return s.from <= s.to ? md >= s.from && md <= s.to : md >= s.from || md <= s.to
}

/** The season a date falls in (first match), or null = no visits that day. */
export function seasonFor(seasons: Season[], ymd: string): Season | null {
  return seasons.find((s) => seasonContains(s, ymd)) ?? null
}

/** Pure: seasons from a request body → clean list, or why not. Overlapping seasons are refused (which one wins?). */
export function cleanSeasons(raw: unknown): { ok: true; value: Season[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: 'Add at least one season' }
  if (raw.length === 0) return { ok: false, error: 'Add at least one season' }
  if (raw.length > 12) return { ok: false, error: 'At most 12 seasons' }
  const out: Season[] = []
  for (const r of raw) {
    const o = r && typeof r === 'object' ? (r as Record<string, unknown>) : {}
    if (!isMonthDay(o.from) || !isMonthDay(o.to)) return { ok: false, error: 'Each season needs a start and end day' }
    if (!(SERVICE_FREQUENCIES as readonly unknown[]).includes(o.frequency)) return { ok: false, error: 'Pick how often for each season' }
    out.push({ from: o.from, to: o.to, frequency: o.frequency as ServiceFrequency })
  }
  // Every day of a leap year may sit in at most one season.
  for (let ms = Date.UTC(2024, 0, 1, 12); ms < Date.UTC(2025, 0, 1, 12); ms += DAY_MS) {
    const ymd = fromUtc(ms)
    if (out.filter((s) => seasonContains(s, ymd)).length > 1) {
      return { ok: false, error: `Seasons overlap on ${monthDayLabel(ymd.slice(5))} — each day can be in one season only` }
    }
  }
  return { ok: true, value: out }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export function monthDayLabel(md: string): string {
  const m = MD_RE.exec(md)
  return m ? `${MONTHS[+m[1] - 1]} ${+m[2]}` : md
}

/** "Every week, Apr 1 – Oct 31" */
export function seasonLabel(s: Season): string {
  return `${SERVICE_FREQUENCY_LABELS[s.frequency]}, ${monthDayLabel(s.from)} – ${monthDayLabel(s.to)}`
}

// ---------------------------------------------------------------------------------------------------------------------
// The schedule
// ---------------------------------------------------------------------------------------------------------------------

/** The weekday visits fall on: the plan's preferred weekday, else the start date's weekday. */
export function planWeekday(p: Pick<ServicePlanSchedule, 'preferred_weekday' | 'start_date'>): number {
  return p.preferred_weekday != null && p.preferred_weekday >= 0 && p.preferred_weekday <= 6 ? p.preferred_weekday : weekdayOfYmd(p.start_date)
}

/** The first visit-weekday on or after the start date. Every-2/every-4 weeks count from here, so the rhythm never drifts. */
export function planAnchor(p: Pick<ServicePlanSchedule, 'preferred_weekday' | 'start_date'>): string {
  const shift = (planWeekday(p) - weekdayOfYmd(p.start_date) + 7) % 7
  return addDaysYmd(p.start_date, shift)
}

/** Does the frequency put a visit on this date (already known to be the plan's weekday, on/after the anchor)? */
function frequencyHits(freq: ServiceFrequency, anchor: string, ymd: string): boolean {
  switch (freq) {
    case 'weekly':
      return true
    case 'every_2_weeks':
      return (daysBetweenYmd(anchor, ymd) / 7) % 2 === 0
    case 'every_4_weeks':
      return (daysBetweenYmd(anchor, ymd) / 7) % 4 === 0
    case 'monthly':
      // The first <weekday> of the month ("first Tuesday").
      return Number(ymd.slice(8)) <= 7
    case 'none':
      return false
  }
}

/**
 * The first day the plan may have a visit, or null = none at all: an ended plan, or a paused plan with no resume date.
 * A paused plan with a resume date runs again from that date.
 */
export function planRunsFrom(p: ServicePlanSchedule): string | null {
  if (p.status === 'ended') return null
  if (p.status === 'paused') return p.paused_until && isYmd(p.paused_until) ? (p.paused_until > p.start_date ? p.paused_until : p.start_date) : null
  return p.start_date
}

/**
 * Pure: every planned visit date in [from, to] (inclusive), oldest first. Deterministic for a given plan whatever the
 * window, so the generator can run any number of times and always agrees with itself.
 */
export function planVisitDates(p: ServicePlanSchedule, from: string, to: string): string[] {
  const runsFrom = planRunsFrom(p)
  if (!runsFrom) return []
  const anchor = planAnchor(p)
  let start = from > runsFrom ? from : runsFrom
  if (start < anchor) start = anchor
  const end = p.end_date && p.end_date < to ? p.end_date : to
  if (start > end) return []
  // Step to the first visit-weekday on/after `start`, then walk week by week.
  let d = addDaysYmd(start, (planWeekday(p) - weekdayOfYmd(start) + 7) % 7)
  const out: string[] = []
  for (; d <= end; d = addDaysYmd(d, 7)) {
    const season = seasonFor(p.seasons, d)
    if (season && frequencyHits(season.frequency, anchor, d)) out.push(d)
  }
  return out
}

/** The window the generator fills: today through VISIT_HORIZON_DAYS − 1 days ahead. */
export function visitHorizon(todayYmd: string): { from: string; to: string } {
  return { from: todayYmd, to: addDaysYmd(todayYmd, VISIT_HORIZON_DAYS - 1) }
}

/** What a visit row is worth when it is planned: the plan price for per-visit plans, nothing for monthly / yearly ones. */
export function visitPrice(p: Pick<ServicePlan, 'price' | 'billing_basis'>): number | null {
  return p.billing_basis === 'per_visit' && p.price != null ? p.price : null
}

// ---------------------------------------------------------------------------------------------------------------------
// Plan input
// ---------------------------------------------------------------------------------------------------------------------

export type ServicePlanInput = {
  property_id: string
  trade: string
  name: string
  description: string | null
  price: number | null
  billing_basis: BillingBasis
  taxable: boolean
  pricing: PlanPricing
  pricing_inputs: Record<string, number>
  tier_key: string | null
  steps: PlanStep[]
  start_date: string
  end_date: string | null
  seasons: Season[]
  preferred_weekday: number | null
  default_sub_id: string | null
  route_position: number | null
}

const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)

/** Pure: a create/edit body → clean values, or why not. `partial` = edit: only keys present are checked and returned. */
export function cleanPlanInput(
  body: unknown,
  partial = false
): { ok: true; value: Partial<ServicePlanInput> } | { ok: false; error: string } {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {}
  const has = (k: string) => !partial || k in b
  const out: Partial<ServicePlanInput> = {}

  if (has('property_id')) {
    if (typeof b.property_id !== 'string' || !b.property_id) return { ok: false, error: 'Pick the property' }
    out.property_id = b.property_id
  }
  if (has('trade')) {
    if (typeof b.trade !== 'string' || !/^[a-z0-9_]{1,40}$/.test(b.trade)) return { ok: false, error: 'Pick the service type' }
    out.trade = b.trade
  }
  if (has('name')) {
    const name = str(b.name, 120)
    if (!name) return { ok: false, error: 'Give the plan a name' }
    out.name = name
  }
  if ('description' in b) out.description = str(b.description, 2000)
  if (has('price')) {
    if (b.price === null || b.price === undefined || b.price === '') out.price = null
    else {
      const n = typeof b.price === 'number' ? b.price : typeof b.price === 'string' ? Number(b.price.replace(/[$,\s]/g, '')) : NaN
      if (!Number.isFinite(n) || n < 0 || n > 1_000_000) return { ok: false, error: 'Price must be a dollar amount' }
      out.price = Math.round(n * 100) / 100
    }
  }
  if (has('billing_basis')) {
    const bb = b.billing_basis ?? 'per_visit'
    if (!(BILLING_BASES as readonly unknown[]).includes(bb)) return { ok: false, error: 'Bill per visit, per month or per year' }
    out.billing_basis = bb as BillingBasis
  }
  if (has('taxable')) out.taxable = b.taxable === true
  if (has('pricing')) {
    const r = cleanPricing(b.pricing ?? {})
    if (!r.ok) return r
    out.pricing = r.value
  }
  if (has('pricing_inputs')) {
    const r = cleanPricingInputs(b.pricing_inputs ?? {})
    if (!r.ok) return r
    out.pricing_inputs = r.value
  }
  if (has('tier_key')) out.tier_key = typeof b.tier_key === 'string' && b.tier_key ? b.tier_key.slice(0, 40) : null
  if (has('steps')) {
    const r = cleanSteps(b.steps ?? [])
    if (!r.ok) return r
    out.steps = r.value
  }
  if (has('start_date')) {
    if (!isYmd(b.start_date)) return { ok: false, error: 'Pick a start date' }
    out.start_date = b.start_date
  }
  if (has('end_date')) {
    if (b.end_date === null || b.end_date === undefined || b.end_date === '') out.end_date = null
    else if (!isYmd(b.end_date)) return { ok: false, error: 'End date is not a date' }
    else out.end_date = b.end_date
  }
  if (out.start_date && out.end_date && out.end_date < out.start_date) return { ok: false, error: 'End date is before the start date' }
  if (has('seasons')) {
    const s = cleanSeasons(b.seasons)
    if (!s.ok) return s
    out.seasons = s.value
  }
  if (has('preferred_weekday')) {
    const w = b.preferred_weekday
    if (w === null || w === undefined || w === '') out.preferred_weekday = null
    else {
      const n = typeof w === 'number' ? w : Number(w)
      if (!Number.isInteger(n) || n < 0 || n > 6) return { ok: false, error: 'Pick a weekday' }
      out.preferred_weekday = n
    }
  }
  if (has('default_sub_id')) out.default_sub_id = typeof b.default_sub_id === 'string' && b.default_sub_id ? b.default_sub_id : null
  if (has('route_position')) {
    const r = b.route_position
    if (r === null || r === undefined || r === '') out.route_position = null
    else {
      const n = typeof r === 'number' ? r : Number(r)
      if (!Number.isInteger(n) || n < 1 || n > 999) return { ok: false, error: 'Stop number is 1 to 999' }
      out.route_position = n
    }
  }
  return { ok: true, value: out }
}

/** Pause / resume / end from the plan card. */
export type PlanStatusChange =
  | { action: 'pause'; until: string | null }
  | { action: 'resume' }
  | { action: 'end'; on: string | null }

export function parsePlanStatusChange(body: unknown, todayYmd: string): PlanStatusChange | { error: string } | null {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {}
  switch (b.action) {
    case undefined:
      return null
    case 'pause':
      if (b.until === null || b.until === undefined || b.until === '') return { action: 'pause', until: null }
      if (!isYmd(b.until)) return { error: 'Resume date is not a date' }
      if (b.until <= todayYmd) return { error: 'Pick a resume date after today' }
      return { action: 'pause', until: b.until }
    case 'resume':
      return { action: 'resume' }
    case 'end':
      if (b.on === null || b.on === undefined || b.on === '') return { action: 'end', on: null }
      if (!isYmd(b.on)) return { error: 'End date is not a date' }
      return { action: 'end', on: b.on }
    default:
      return { error: 'Unknown action' }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Visit actions
// ---------------------------------------------------------------------------------------------------------------------

export type VisitAction =
  | { action: 'done'; result?: string; notes?: string }
  | { action: 'skip'; reason: SkipReason; notes?: string }
  | { action: 'reopen' }
  | { action: 'move'; date: string }
  | { action: 'assign'; subId: string | null }

/** Which actions a crew phone link may take (never reopen / move / reassign — those are the office's). */
export const CREW_VISIT_ACTIONS: readonly VisitAction['action'][] = ['done', 'skip']

export function parseVisitAction(body: unknown): VisitAction | { error: string } {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {}
  const notes = typeof b.notes === 'string' ? b.notes.trim().slice(0, 2000) : undefined
  switch (b.action) {
    case 'done':
      if (b.result !== undefined && b.result !== null && (typeof b.result !== 'string' || !KEY_RE.test(b.result))) return { error: 'Pick a result' }
      return { action: 'done', result: typeof b.result === 'string' ? b.result : undefined, notes }
    case 'skip':
      if (!(SKIP_REASONS as readonly unknown[]).includes(b.reason)) return { error: 'Pick why it was skipped' }
      if (b.reason === 'other' && !notes) return { error: 'Say why it was skipped' }
      return { action: 'skip', reason: b.reason as SkipReason, notes }
    case 'reopen':
      return { action: 'reopen' }
    case 'move':
      if (!isYmd(b.date)) return { error: 'Pick a date' }
      return { action: 'move', date: b.date }
    case 'assign':
      return { action: 'assign', subId: typeof b.subId === 'string' && b.subId ? b.subId : null }
    default:
      return { error: 'Unknown action' }
  }
}

/** `results` = the result options of the visit's step (from the plan); empty / missing = no result asked for. */
export type VisitRowState = { status: string; scheduled_date: string | null; visit_step?: string | null; results?: readonly string[] }

/**
 * Pure: the column changes for an action on a visit, or why not. `by` = a staff user id (office) or a crew's sub id
 * (phone link). Only a scheduled visit can be done / skipped / moved / reassigned; only a done or skipped one reopened.
 */
export function visitPatch(
  row: VisitRowState,
  a: VisitAction,
  by: { userId: string | null; subId: string | null },
  now: Date
): Record<string, unknown> | { error: string } {
  const open = row.status === 'scheduled'
  const at = now.toISOString()
  switch (a.action) {
    case 'done':
      if (!open) return { error: 'This visit is already closed' }
      // A follow-on step with result options is only done with one of them; the plan's own visit never carries one.
      {
        const options = (row.visit_step ?? SERVICE_STEP) === SERVICE_STEP ? [] : row.results ?? []
        if (options.length && (!a.result || !options.includes(a.result))) return { error: 'Pick a result' }
      }
      return {
        status: 'completed',
        step_result: (row.visit_step ?? SERVICE_STEP) !== SERVICE_STEP && (row.results ?? []).length ? a.result : null,
        completed_at: at,
        completed_by: by.userId,
        completed_by_sub_id: by.userId ? null : by.subId,
        ...(a.notes !== undefined ? { completion_notes: a.notes || null } : {}),
      }
    case 'skip':
      if (!open) return { error: 'This visit is already closed' }
      return {
        status: 'skipped',
        skip_reason: a.reason,
        skipped_at: at,
        completed_by: by.userId,
        completed_by_sub_id: by.userId ? null : by.subId,
        ...(a.notes !== undefined ? { completion_notes: a.notes || null } : {}),
      }
    case 'reopen':
      if (row.status !== 'completed' && row.status !== 'skipped') return { error: 'This visit is not closed' }
      return { status: 'scheduled', completed_at: null, completed_by: null, completed_by_sub_id: null, skip_reason: null, skipped_at: null, step_result: null }
    case 'move':
      if (!open) return { error: 'Only a scheduled visit can be moved' }
      return { scheduled_date: a.date }
    case 'assign':
      if (!open) return { error: 'Only a scheduled visit can change crew' }
      return { assigned_sub_id: a.subId }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Bulk shift (the rain / hurricane button)
// ---------------------------------------------------------------------------------------------------------------------

export type BulkShift = { from: string; to: string; days: number; subId: string | null | 'all' }

export const MAX_SHIFT_DAYS = 30
export const MAX_SHIFT_RANGE_DAYS = 31

export function parseBulkShift(body: unknown): BulkShift | { error: string } {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {}
  if (!isYmd(b.from)) return { error: 'Pick the day to move' }
  const to = b.to === undefined || b.to === null || b.to === '' ? b.from : b.to
  if (!isYmd(to)) return { error: 'Pick the last day to move' }
  if (to < b.from) return { error: 'The last day is before the first' }
  if (daysBetweenYmd(b.from, to) >= MAX_SHIFT_RANGE_DAYS) return { error: `Move at most ${MAX_SHIFT_RANGE_DAYS} days of visits at once` }
  const days = typeof b.days === 'number' ? b.days : Number(b.days)
  if (!Number.isInteger(days) || days === 0 || Math.abs(days) > MAX_SHIFT_DAYS) return { error: `Move by 1 to ${MAX_SHIFT_DAYS} days` }
  const subId = b.subId === undefined || b.subId === 'all' ? 'all' : b.subId === null || b.subId === '' || b.subId === 'none' ? null : typeof b.subId === 'string' ? b.subId : 'all'
  return { from: b.from, to, days, subId }
}

// ---------------------------------------------------------------------------------------------------------------------
// Regeneration (a plan edit)
// ---------------------------------------------------------------------------------------------------------------------

export type ExistingVisit = {
  id: string
  visit_step?: string | null
  status: string
  service_planned_date: string
  scheduled_date: string | null
  assigned_sub_id: string | null
  completed_at: string | null
}

/**
 * Pure: after a plan edit, what happens to its visits. Only UNSTARTED FUTURE visits change — scheduled, planned AND
 * sitting after today, never completed. Done / skipped / cancelled visits and anything today or earlier are history and
 * are never touched. Of the future ones:
 *   - a slot the new schedule no longer has → removed (it has no history; one with photos is cancelled instead, by the caller);
 *   - a slot it keeps → refreshed (name, price, crew if the crew was the old default — a crew picked by hand stays);
 *   - new slots are created by the generator afterwards.
 */
export function regenerationPlan<T extends ExistingVisit>(
  visits: T[],
  newDates: Set<string>,
  todayYmd: string
): { remove: string[]; keep: T[] } {
  const remove: string[] = []
  const keep: T[] = []
  for (const v of visits) {
    // Follow-on steps belong to a visit that already happened: never regenerated.
    const future = (v.visit_step ?? SERVICE_STEP) === SERVICE_STEP && v.status === 'scheduled' && !v.completed_at && v.service_planned_date > todayYmd && (v.scheduled_date ?? v.service_planned_date) > todayYmd
    if (!future) continue
    if (newDates.has(v.service_planned_date)) keep.push(v)
    else remove.push(v.id)
  }
  return { remove, keep }
}

/** The crew a kept visit should have after an edit: the new default, unless someone picked a different crew by hand. */
export function crewAfterEdit(current: string | null, oldDefault: string | null, newDefault: string | null): string | null {
  return current === oldDefault ? newDefault : current
}

/** A plan as sent to someone who may not see prices (price blanked; `priceHidden` tells the screen why). */
export function redactPlanPrices<T extends Pick<ServicePlan, 'price'>>(p: T, prices: boolean): T & { priceHidden: boolean } {
  return prices ? { ...p, priceHidden: false } : { ...p, price: null, priceHidden: true }
}


// ---------------------------------------------------------------------------------------------------------------------
// Price rules (generic: the company decides what to ask about a home and which answers get which price)
// ---------------------------------------------------------------------------------------------------------------------

/** Lower-case key: letters, digits, underscore; starts with a letter. Used for pricing fields, tiers, steps, results. */
export const KEY_RE = /^[a-z][a-z0-9_]{0,39}$/

/** A question asked about the home when the plan is sold ("Stories", "Roof pitch (/12)", "Lawn size (sq ft)"). Numbers. */
export type PricingField = { key: string; label: string }
export const CONDITION_OPS = ['lte', 'lt', 'gte', 'gt', 'eq'] as const
export type ConditionOp = (typeof CONDITION_OPS)[number]
export const CONDITION_OP_LABELS: Record<ConditionOp, string> = { lte: 'at most', lt: 'under', gte: 'at least', gt: 'over', eq: 'exactly' }
export type PricingCondition = { field: string; op: ConditionOp; value: number }
/** A price a home gets when every condition holds (no conditions = everyone). First matching tier is offered first. */
export type PricingTier = { key: string; label: string; price: number; billingBasis: BillingBasis; conditions: PricingCondition[] }
export type PlanPricing = { fields: PricingField[]; tiers: PricingTier[]; allowCustom: boolean }
export const EMPTY_PRICING: PlanPricing = Object.freeze({ fields: [], tiers: [], allowCustom: true }) as PlanPricing

type R<T> = { ok: true; value: T } | { ok: false; error: string }
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const label = (v: unknown, max = 60): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)
const money = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v.replace(/[$,\s]/g, '')) : NaN
  return Number.isFinite(n) && n >= 0 && n <= 1_000_000 ? Math.round(n * 100) / 100 : null
}

/** Pure: price rules from a save → clean rules, or why not. */
export function cleanPricing(raw: unknown): R<PlanPricing> {
  const o = obj(raw)
  const fieldsRaw = Array.isArray(o.fields) ? o.fields : []
  const tiersRaw = Array.isArray(o.tiers) ? o.tiers : []
  if (fieldsRaw.length > 8) return { ok: false, error: 'At most 8 questions about the home' }
  if (tiersRaw.length > 10) return { ok: false, error: 'At most 10 price tiers' }
  const fields: PricingField[] = []
  for (const f of fieldsRaw) {
    const x = obj(f)
    const l = label(x.label)
    if (typeof x.key !== 'string' || !KEY_RE.test(x.key) || !l) return { ok: false, error: 'Each question needs a name' }
    if (fields.some((y) => y.key === x.key)) return { ok: false, error: `“${l}” is listed twice` }
    fields.push({ key: x.key, label: l })
  }
  const tiers: PricingTier[] = []
  for (const t of tiersRaw) {
    const x = obj(t)
    const l = label(x.label)
    const price = money(x.price)
    if (typeof x.key !== 'string' || !KEY_RE.test(x.key) || !l) return { ok: false, error: 'Each price tier needs a name' }
    if (tiers.some((y) => y.key === x.key)) return { ok: false, error: `Tier “${l}” is listed twice` }
    if (price === null) return { ok: false, error: `Enter a price for “${l}”` }
    const basis = (BILLING_BASES as readonly unknown[]).includes(x.billingBasis) ? (x.billingBasis as BillingBasis) : 'per_visit'
    const conditions: PricingCondition[] = []
    for (const c of Array.isArray(x.conditions) ? x.conditions : []) {
      const y = obj(c)
      const v = typeof y.value === 'number' ? y.value : Number(y.value)
      if (!fields.some((f) => f.key === y.field)) return { ok: false, error: `A rule in “${l}” asks about a question that isn’t listed` }
      if (!(CONDITION_OPS as readonly unknown[]).includes(y.op) || !Number.isFinite(v)) return { ok: false, error: `Finish the rules in “${l}”` }
      conditions.push({ field: String(y.field), op: y.op as ConditionOp, value: v })
    }
    if (conditions.length > 8) return { ok: false, error: `At most 8 rules in “${l}”` }
    tiers.push({ key: x.key, label: l, price, billingBasis: basis, conditions })
  }
  const allowCustom = o.allowCustom !== false
  if (!allowCustom && tiers.length === 0) return { ok: false, error: 'Add a price tier or allow a custom price' }
  return { ok: true, value: { fields, tiers, allowCustom } }
}

/** Lenient read of stored rules (a row written by an older version never crashes a screen). */
export function readPricing(raw: unknown): PlanPricing {
  const r = cleanPricing(raw)
  return r.ok ? r.value : { ...EMPTY_PRICING }
}

/** Pure: the answers about a home → numbers by question key. */
export function cleanPricingInputs(raw: unknown): R<Record<string, number>> {
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(obj(raw))) {
    if (!KEY_RE.test(k)) return { ok: false, error: 'Unknown question' }
    if (v === null || v === undefined || v === '') continue
    const n = typeof v === 'number' ? v : Number(v)
    if (!Number.isFinite(n) || Math.abs(n) > 1e9) return { ok: false, error: 'Answers about the home must be numbers' }
    out[k] = n
  }
  return { ok: true, value: out }
}

function conditionHolds(c: PricingCondition, inputs: Record<string, number>): boolean {
  const v = inputs[c.field]
  if (v === undefined) return false
  switch (c.op) {
    case 'lte': return v <= c.value
    case 'lt': return v < c.value
    case 'gte': return v >= c.value
    case 'gt': return v > c.value
    case 'eq': return v === c.value
  }
}

/** Pure: does this home qualify for a tier? Why not, in words (an unanswered question counts as "no"). */
export function tierCheck(pricing: PlanPricing, tier: PricingTier, inputs: Record<string, number>): { ok: true } | { ok: false; reason: string } {
  for (const c of tier.conditions) {
    const f = pricing.fields.find((x) => x.key === c.field)
    const name = f?.label ?? c.field
    if (inputs[c.field] === undefined) return { ok: false, reason: `Answer “${name}”` }
    if (!conditionHolds(c, inputs)) return { ok: false, reason: `${name} must be ${CONDITION_OP_LABELS[c.op]} ${c.value}` }
  }
  return { ok: true }
}

/** Pure: the tiers this home qualifies for (in the template's order). */
export function eligibleTiers(pricing: PlanPricing, inputs: Record<string, number>): PricingTier[] {
  return pricing.tiers.filter((t) => tierCheck(pricing, t, inputs).ok)
}

/**
 * Pure: the price a plan ends up with. A tier: its price and billing basis, only if the home qualifies (a typed price is
 * ignored). No tier (custom): the typed price — only if the rules allow a custom price.
 */
export function resolvePlanPricing(
  v: { tier_key: string | null; price: number | null; billing_basis: BillingBasis; pricing_inputs: Record<string, number> },
  pricing: PlanPricing
): { ok: true; price: number | null; billing_basis: BillingBasis; tier_key: string | null } | { ok: false; error: string } {
  if (!v.tier_key) {
    if (!pricing.allowCustom) return { ok: false, error: 'This plan only sells at its set prices — pick a price tier' }
    return { ok: true, price: v.price, billing_basis: v.billing_basis, tier_key: null }
  }
  const tier = pricing.tiers.find((t) => t.key === v.tier_key)
  if (!tier) return { ok: false, error: 'That price tier no longer exists — pick another' }
  const check = tierCheck(pricing, tier, v.pricing_inputs)
  if (!check.ok) return { ok: false, error: `${tier.label}: ${check.reason}` }
  return { ok: true, price: tier.price, billing_basis: tier.billingBasis, tier_key: tier.key }
}

// ---------------------------------------------------------------------------------------------------------------------
// Follow-on steps (cleaning → inspection → …), each with its own result options
// ---------------------------------------------------------------------------------------------------------------------

export const RESULT_TONES = ['good', 'watch', 'bad', 'neutral'] as const
export type ResultTone = (typeof RESULT_TONES)[number]
export type StepResultOption = { key: string; label: string; tone: ResultTone }
/** Who does a step: one staff person (an inspector) or a crew. Empty = pick on the visit. */
export type PlanStep = { key: string; label: string; daysAfter: number; assignTo: 'person' | 'crew'; userId: string | null; subId: string | null; results: StepResultOption[] }

/** The default result options for a new step: the shared green / yellow / red (lib/health-result.ts). Editable. */
export const DEFAULT_STEP_RESULTS: readonly StepResultOption[] = Object.freeze(
  HEALTH_RESULTS.map((r): StepResultOption => ({ key: r, label: HEALTH_RESULT_STYLE[r].label, tone: r === 'green' ? 'good' : r === 'yellow' ? 'watch' : 'bad' }))
)

/** Badge / button colors per tone (dark text on yellow; white on green / red / gray — WCAG AA). */
export const RESULT_TONE_CLASS: Record<ResultTone, string> = {
  good: HEALTH_RESULT_STYLE.green.cls,
  watch: HEALTH_RESULT_STYLE.yellow.cls,
  bad: HEALTH_RESULT_STYLE.red.cls,
  neutral: 'bg-[#2c2c2a] text-white',
}

export function cleanSteps(raw: unknown): R<PlanStep[]> {
  if (!Array.isArray(raw)) return { ok: false, error: 'Steps must be a list' }
  if (raw.length > 5) return { ok: false, error: 'At most 5 follow-on steps' }
  const out: PlanStep[] = []
  for (const s of raw) {
    const x = obj(s)
    const l = label(x.label)
    if (typeof x.key !== 'string' || !KEY_RE.test(x.key) || x.key === SERVICE_STEP || !l) return { ok: false, error: 'Each step needs a name' }
    if (out.some((y) => y.key === x.key)) return { ok: false, error: `Step “${l}” is listed twice` }
    const days = Number(x.daysAfter ?? 0)
    if (!Number.isInteger(days) || days < 0 || days > 60) return { ok: false, error: `“${l}”: 0 to 60 days after` }
    const results: StepResultOption[] = []
    for (const r of Array.isArray(x.results) ? x.results : []) {
      const y = obj(r)
      const rl = label(y.label)
      if (typeof y.key !== 'string' || !KEY_RE.test(y.key) || !rl) return { ok: false, error: `“${l}”: each result needs a name` }
      if (results.some((z) => z.key === y.key)) return { ok: false, error: `“${l}”: result “${rl}” is listed twice` }
      results.push({ key: y.key, label: rl, tone: (RESULT_TONES as readonly unknown[]).includes(y.tone) ? (y.tone as ResultTone) : 'neutral' })
    }
    if (results.length > 8) return { ok: false, error: `“${l}”: at most 8 results` }
    const assignTo = x.assignTo === 'crew' ? 'crew' : 'person'
    out.push({
      key: x.key,
      label: l,
      daysAfter: days,
      assignTo,
      userId: assignTo === 'person' && typeof x.userId === 'string' && x.userId ? x.userId : null,
      subId: assignTo === 'crew' && typeof x.subId === 'string' && x.subId ? x.subId : null,
      results,
    })
  }
  return { ok: true, value: out }
}

export function readSteps(raw: unknown): PlanStep[] {
  const r = cleanSteps(raw)
  return r.ok ? r.value : []
}

/** Pure: the step after `current` ('service' → the first step). Null = none. */
export function nextStep(steps: PlanStep[], current: string | null): PlanStep | null {
  const at = (current ?? SERVICE_STEP) === SERVICE_STEP ? -1 : steps.findIndex((s) => s.key === current)
  if (at === -1 && (current ?? SERVICE_STEP) !== SERVICE_STEP) return null
  return steps[at + 1] ?? null
}

/** The result options of a visit's step (none for the plan's own visit, or a step the plan no longer has). */
export function stepResultKeys(steps: PlanStep[], step: string | null): string[] {
  if ((step ?? SERVICE_STEP) === SERVICE_STEP) return []
  return (steps.find((s) => s.key === step)?.results ?? []).map((r) => r.key)
}

/** Pure: the follow-on visit a done visit starts (null when the plan has no next step). Planned on the parent's slot. */
export function followUpVisitFields(
  steps: PlanStep[],
  parent: { id: string; service_planned_date: string; visit_step: string | null },
  doneOnYmd: string
): { visit_step: string; parent_visit_id: string; service_planned_date: string; scheduled_date: string; assigned_user_id: string | null; assigned_sub_id: string | null; title_suffix: string } | null {
  const step = nextStep(steps, parent.visit_step)
  if (!step) return null
  return {
    visit_step: step.key,
    parent_visit_id: parent.id,
    service_planned_date: parent.service_planned_date,
    scheduled_date: addDaysYmd(doneOnYmd, step.daysAfter),
    assigned_user_id: step.assignTo === 'person' ? step.userId : null,
    assigned_sub_id: step.assignTo === 'crew' ? step.subId : null,
    title_suffix: step.label,
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Templates (what a company sells; owners edit them in Settings)
// ---------------------------------------------------------------------------------------------------------------------

export type ServicePlanTemplate = {
  id: string
  org_id: string
  name: string
  trade: string
  description: string | null
  seasons: Season[]
  billing_basis: BillingBasis
  taxable: boolean
  pricing: PlanPricing
  steps: PlanStep[]
  active: boolean
  version: number
  updated_at: string
}

export const TEMPLATE_COLUMNS = 'id, org_id, name, trade, description, seasons, billing_basis, taxable, pricing, steps, active, version, updated_at'

export type TemplateInput = Pick<ServicePlanTemplate, 'name' | 'trade' | 'description' | 'seasons' | 'billing_basis' | 'taxable' | 'pricing' | 'steps' | 'active'>

/** Pure: a template save → clean values, or why not. `partial` = edit. */
export function cleanTemplateInput(body: unknown, partial = false): R<Partial<TemplateInput>> {
  const b = obj(body)
  const has = (k: string) => !partial || k in b
  const out: Partial<TemplateInput> = {}
  if (has('name')) {
    const n = label(b.name, 120)
    if (!n) return { ok: false, error: 'Give the template a name' }
    out.name = n
  }
  if (has('trade')) {
    if (typeof b.trade !== 'string' || !/^[a-z0-9_]{1,40}$/.test(b.trade)) return { ok: false, error: 'Pick the service type' }
    out.trade = b.trade
  }
  if ('description' in b) out.description = label(b.description, 2000)
  if (has('seasons')) {
    const r = cleanSeasons(b.seasons)
    if (!r.ok) return r
    out.seasons = r.value
  }
  if (has('billing_basis')) {
    const bb = b.billing_basis ?? 'per_visit'
    if (!(BILLING_BASES as readonly unknown[]).includes(bb)) return { ok: false, error: 'Bill per visit, per month or per year' }
    out.billing_basis = bb as BillingBasis
  }
  if (has('taxable')) out.taxable = b.taxable === true
  if (has('pricing')) {
    const r = cleanPricing(b.pricing ?? {})
    if (!r.ok) return r
    out.pricing = r.value
  }
  if (has('steps')) {
    const r = cleanSteps(b.steps ?? [])
    if (!r.ok) return r
    out.steps = r.value
  }
  if ('active' in b) out.active = b.active !== false
  return { ok: true, value: out }
}

/** The parts of a template copied onto a plan at sale (and pushed later, on purpose). Seasons included. */
export const TEMPLATE_PLAN_FIELDS = ['trade', 'seasons', 'billing_basis', 'taxable', 'pricing', 'steps'] as const
export type TemplatePlanField = (typeof TEMPLATE_PLAN_FIELDS)[number]

// ---------------------------------------------------------------------------------------------------------------------
// History labels + "what will change" preview
// ---------------------------------------------------------------------------------------------------------------------

/** Plan fields people can change, with the words the history shows. */
export const PLAN_FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  description: 'Notes for the crew',
  property_id: 'Property',
  trade: 'Service type',
  start_date: 'Starts',
  end_date: 'Ends',
  preferred_weekday: 'Visit day',
  seasons: 'Seasons',
  price: 'Price',
  billing_basis: 'Billed',
  taxable: 'Sales tax',
  pricing: 'Price rules',
  pricing_inputs: 'Answers about the home',
  tier_key: 'Price tier',
  steps: 'Follow-on steps',
  default_sub_id: 'Crew',
  route_position: 'Stop #',
  status: 'Status',
  paused_until: 'Resumes',
  template_version: 'Template version',
}

export const TEMPLATE_FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  trade: 'Service type',
  description: 'Description',
  seasons: 'Seasons',
  billing_basis: 'Billed',
  taxable: 'Sales tax',
  pricing: 'Price rules',
  steps: 'Follow-on steps',
  active: 'Offered',
}

export type VisitEffect = { removed: number; added: number; updated: number }

/**
 * Pure: what saving a plan change would do to its visits, without doing it. Same rules as the save
 * (`regenerationPlan` + the generator): removed = future unstarted visits whose slot goes away; added = new slots in the
 * horizon with no visit yet; updated = kept future visits whose name / price / crew / property / tax would change.
 */
export function previewVisitEffect(
  visits: Array<ExistingVisit & { title?: string | null; service_price?: number | null; service_taxable?: boolean | null; property_id?: string | null }>,
  oldPlan: ServicePlanSchedule & Pick<ServicePlan, 'name' | 'price' | 'billing_basis' | 'taxable' | 'default_sub_id' | 'property_id'>,
  newPlan: ServicePlanSchedule & Pick<ServicePlan, 'name' | 'price' | 'billing_basis' | 'taxable' | 'default_sub_id' | 'property_id'>,
  todayYmd: string
): VisitEffect {
  const tomorrow = addDaysYmd(todayYmd, 1)
  const { to } = visitHorizon(todayYmd)
  const futureDates = new Set(planVisitDates(newPlan, tomorrow, addDaysYmd(todayYmd, 3650)))
  const { remove, keep } = regenerationPlan(visits, futureDates, todayYmd)
  const haveSlots = new Set(visits.filter((v) => (v.visit_step ?? SERVICE_STEP) === SERVICE_STEP && !remove.includes(v.id)).map((v) => v.service_planned_date))
  const added = planVisitDates(newPlan, todayYmd, to).filter((d) => !haveSlots.has(d)).length
  const newPrice = visitPrice(newPlan)
  const updated = keep.filter((v) => {
    const crew = crewAfterEdit(v.assigned_sub_id, oldPlan.default_sub_id, newPlan.default_sub_id)
    return (
      crew !== v.assigned_sub_id ||
      (v.title ?? oldPlan.name) !== newPlan.name ||
      (v.service_price ?? visitPrice(oldPlan)) !== newPrice ||
      (v.service_taxable ?? oldPlan.taxable) !== newPlan.taxable ||
      (v.property_id ?? oldPlan.property_id) !== newPlan.property_id
    )
  }).length
  return { removed: remove.length, added, updated }
}

/** "3 visits removed, 4 added, 2 updated" — or that nothing on the calendar changes. */
export function describeVisitEffect(e: VisitEffect): string {
  const parts = [
    e.removed ? `${e.removed} upcoming visit${e.removed === 1 ? '' : 's'} removed` : null,
    e.added ? `${e.added} added` : null,
    e.updated ? `${e.updated} updated` : null,
  ].filter(Boolean)
  return parts.length ? `${parts.join(', ')}. Done, skipped and today’s visits don’t change.` : 'No visits on the calendar change.'
}
