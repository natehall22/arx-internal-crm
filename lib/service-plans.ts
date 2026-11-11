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
import { isHealthResult, type HealthResult } from '@/lib/health-result'

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

export const PRICE_TIERS = ['standard', 'custom'] as const
export type PriceTier = (typeof PRICE_TIERS)[number]

/** Follow-on step after each service visit (ARX Care: a sub cleans, then a staff inspector rates the roof). */
export const FOLLOW_UPS = ['inspection'] as const
export type FollowUp = (typeof FOLLOW_UPS)[number]
export const VISIT_STEPS = ['service', 'inspection'] as const
export type VisitStep = (typeof VISIT_STEPS)[number]

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
  price_tier: PriceTier
  taxable: boolean
  stories: number | null
  pitch_rise: number | null
  follow_up: FollowUp | null
  follow_up_days: number | null
  follow_up_user_id: string | null
  default_sub_id: string | null
  route_position: number | null
  created_by: string
  created_at: string
  updated_at: string
}

export const SERVICE_PLAN_COLUMNS =
  'id, org_id, customer_id, property_id, trade, name, description, price, billing_basis, price_tier, taxable, stories, pitch_rise, follow_up, follow_up_days, follow_up_user_id, status, start_date, end_date, paused_until, seasons, preferred_weekday, default_sub_id, route_position, created_by, created_at, updated_at'

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

/** A sensible starting schedule for lawn care in the US Southeast: weekly in season, every 2 weeks in the shoulders, monthly in winter. */
export const DEFAULT_LAWN_SEASONS: readonly Season[] = Object.freeze([
  { from: '03-01', to: '03-31', frequency: 'every_2_weeks' },
  { from: '04-01', to: '10-31', frequency: 'weekly' },
  { from: '11-01', to: '11-30', frequency: 'every_2_weeks' },
  { from: '12-01', to: '02-29', frequency: 'monthly' },
]) as readonly Season[]

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
  price_tier: PriceTier
  taxable: boolean
  stories: number | null
  pitch_rise: number | null
  follow_up: FollowUp | null
  follow_up_days: number | null
  follow_up_user_id: string | null
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
  if (has('price_tier')) {
    const t = b.price_tier ?? 'custom'
    if (!(PRICE_TIERS as readonly unknown[]).includes(t)) return { ok: false, error: 'Pick standard or custom price' }
    out.price_tier = t as PriceTier
  }
  if (has('taxable')) out.taxable = b.taxable === true
  if (has('stories')) {
    const n = b.stories === null || b.stories === undefined || b.stories === '' ? null : Number(b.stories)
    if (n !== null && (!Number.isInteger(n) || n < 1 || n > 10)) return { ok: false, error: 'Stories is 1 to 10' }
    out.stories = n
  }
  if (has('pitch_rise')) {
    const n = b.pitch_rise === null || b.pitch_rise === undefined || b.pitch_rise === '' ? null : Number(b.pitch_rise)
    if (n !== null && (!Number.isFinite(n) || n < 0 || n > 24)) return { ok: false, error: 'Pitch is 0/12 to 24/12' }
    out.pitch_rise = n === null ? null : Math.round(n * 10) / 10
  }
  if (has('follow_up')) {
    const f = b.follow_up === null || b.follow_up === undefined || b.follow_up === '' ? null : b.follow_up
    if (f !== null && !(FOLLOW_UPS as readonly unknown[]).includes(f)) return { ok: false, error: 'Unknown follow-up step' }
    out.follow_up = f as FollowUp | null
    if (f) {
      const d = Number(b.follow_up_days ?? 0)
      if (!Number.isInteger(d) || d < 0 || d > 30) return { ok: false, error: 'Follow-up is 0 to 30 days after the visit' }
      out.follow_up_days = d
      out.follow_up_user_id = typeof b.follow_up_user_id === 'string' && b.follow_up_user_id ? b.follow_up_user_id : null
    } else {
      out.follow_up_days = null
      out.follow_up_user_id = null
    }
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
  | { action: 'done'; result?: HealthResult; notes?: string }
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
      if (b.result !== undefined && b.result !== null && !isHealthResult(b.result)) return { error: 'Pick green, yellow or red' }
      return { action: 'done', result: isHealthResult(b.result) ? b.result : undefined, notes }
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

export type VisitRowState = { status: string; scheduled_date: string | null; visit_step?: string | null }

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
      // An inspection is only done with green / yellow / red; a service visit never carries one.
      if (row.visit_step === 'inspection' && !a.result) return { error: 'Pick how it looked: green, yellow or red' }
      return {
        status: 'completed',
        health_result: row.visit_step === 'inspection' ? a.result : null,
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
      return { status: 'scheduled', completed_at: null, completed_by: null, completed_by_sub_id: null, skip_reason: null, skipped_at: null, health_result: null }
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
export function regenerationPlan(
  visits: ExistingVisit[],
  newDates: Set<string>,
  todayYmd: string
): { remove: string[]; keep: ExistingVisit[] } {
  const remove: string[] = []
  const keep: ExistingVisit[] = []
  for (const v of visits) {
    // Follow-on inspections belong to a visit that already happened: never regenerated.
    const future = (v.visit_step ?? 'service') === 'service' && v.status === 'scheduled' && !v.completed_at && v.service_planned_date > todayYmd && (v.scheduled_date ?? v.service_planned_date) > todayYmd
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
// Standard price tier (company settings: orgs.settings.servicePlans.standardTier)
// ---------------------------------------------------------------------------------------------------------------------

/**
 * The company's standard plan price and which homes qualify (ARX Care: ≤ 3 stories and pitch ≤ 10/12). A home outside
 * the rule — or one whose stories / pitch nobody recorded — gets a custom price instead. Null = no standard tier: every
 * plan is priced by hand.
 */
export type StandardTierRule = { price: number; billingBasis: BillingBasis; maxStories: number | null; maxPitchRise: number | null }

export const SERVICE_PLAN_SETTINGS_KEY = 'servicePlans'

/** Pure: the rule out of `orgs.settings` (or the `servicePlans` object itself); anything malformed = no rule. */
export function readStandardTier(settings: unknown): StandardTierRule | null {
  const o = settings && typeof settings === 'object' && !Array.isArray(settings) ? (settings as Record<string, unknown>) : {}
  const sp = (SERVICE_PLAN_SETTINGS_KEY in o ? o[SERVICE_PLAN_SETTINGS_KEY] : o) as Record<string, unknown> | null
  const t = sp && typeof sp === 'object' ? (sp.standardTier as Record<string, unknown> | null | undefined) : null
  if (!t || typeof t !== 'object') return null
  const price = Number(t.price)
  if (!Number.isFinite(price) || price < 0) return null
  const basis = (BILLING_BASES as readonly unknown[]).includes(t.billingBasis) ? (t.billingBasis as BillingBasis) : 'per_month'
  const n = (v: unknown) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
  return { price: Math.round(price * 100) / 100, billingBasis: basis, maxStories: n(t.maxStories), maxPitchRise: n(t.maxPitchRise) }
}

/** Pure: a settings save → the rule to store (null = remove the standard tier), or why not. */
export function cleanStandardTier(body: unknown): { ok: true; value: StandardTierRule | null } | { ok: false; error: string } {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {}
  if (b.standardTier === null) return { ok: true, value: null }
  const rule = readStandardTier({ standardTier: b.standardTier })
  if (!rule) return { ok: false, error: 'Enter the standard price' }
  if (rule.maxStories !== null && (!Number.isInteger(rule.maxStories) || rule.maxStories < 1 || rule.maxStories > 10)) return { ok: false, error: 'Most stories is 1 to 10' }
  if (rule.maxPitchRise !== null && (rule.maxPitchRise < 0 || rule.maxPitchRise > 24)) return { ok: false, error: 'Steepest pitch is 0/12 to 24/12' }
  return { ok: true, value: rule }
}

/** Pure: may this home have the standard price? Unknown stories / pitch fail a rule that limits them. */
export function standardTierCheck(rule: StandardTierRule | null, home: { stories: number | null; pitch_rise: number | null }): { ok: true } | { ok: false; reason: string } {
  if (!rule) return { ok: false, reason: 'There is no standard price set up — use a custom price' }
  if (rule.maxStories !== null) {
    if (home.stories === null) return { ok: false, reason: 'Enter the number of stories' }
    if (home.stories > rule.maxStories) return { ok: false, reason: `More than ${rule.maxStories} stories — use a custom price` }
  }
  if (rule.maxPitchRise !== null) {
    if (home.pitch_rise === null) return { ok: false, reason: 'Enter the roof pitch' }
    if (home.pitch_rise > rule.maxPitchRise) return { ok: false, reason: `Steeper than ${rule.maxPitchRise}/12 — use a custom price` }
  }
  return { ok: true }
}

/**
 * Pure: the price a plan ends up with. Standard tier: the company's price and billing basis, only if the home
 * qualifies (the typed price is ignored). Custom: whatever was typed (the override).
 */
export function resolvePlanPricing(
  v: Pick<ServicePlanInput, 'price_tier' | 'price' | 'billing_basis' | 'stories' | 'pitch_rise'>,
  rule: StandardTierRule | null
): { ok: true; price: number | null; billing_basis: BillingBasis } | { ok: false; error: string } {
  if (v.price_tier !== 'standard') return { ok: true, price: v.price, billing_basis: v.billing_basis }
  const check = standardTierCheck(rule, v)
  if (!check.ok) return { ok: false, error: check.reason }
  return { ok: true, price: (rule as StandardTierRule).price, billing_basis: (rule as StandardTierRule).billingBasis }
}

// ---------------------------------------------------------------------------------------------------------------------
// Follow-on step
// ---------------------------------------------------------------------------------------------------------------------

/** Pure: the follow-on visit a done service visit starts (null when the plan has none). Planned on the parent's slot. */
export function followUpVisitFields(
  plan: Pick<ServicePlan, 'follow_up' | 'follow_up_days' | 'follow_up_user_id'>,
  parent: { id: string; service_planned_date: string; visit_step: string | null },
  doneOnYmd: string
): { visit_step: VisitStep; parent_visit_id: string; service_planned_date: string; scheduled_date: string; assigned_user_id: string | null } | null {
  if (!plan.follow_up || parent.visit_step === 'inspection') return null
  return {
    visit_step: plan.follow_up,
    parent_visit_id: parent.id,
    service_planned_date: parent.service_planned_date,
    scheduled_date: addDaysYmd(doneOnYmd, plan.follow_up_days ?? 0),
    assigned_user_id: plan.follow_up_user_id,
  }
}
