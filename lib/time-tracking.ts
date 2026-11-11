/**
 * Crew time clock — the rules (pure, client-safe). ONE writer is lib/time-tracking-db.ts; this file decides what a tap
 * means, what counts as paid time, how a week splits into regular / overtime, and which wage-law items to warn about.
 *
 * Paid time for one person = (work ∪ travel) − breaks, where travel is the gap between a work entry closed with "going
 * to the next stop" and that person's next work entry the SAME local day. Breaks never auto-deduct anything: a break
 * is only what someone tapped (Lunch) or the office typed. Wage-law items are warnings only.
 *
 * Every time is an instant (ms since epoch / ISO with offset). Local days come from the company's time zone, through
 * Intl / date-fns-tz, so a clock change never adds or loses an hour.
 */
import { fromZonedTime } from 'date-fns-tz'

export const TIME_KINDS = ['work', 'break', 'equipment'] as const
export type TimeKind = (typeof TIME_KINDS)[number]
export const TIME_SOURCES = ['lead_tap', 'self_tap', 'typed', 'auto_closed'] as const
export type TimeSource = (typeof TIME_SOURCES)[number]

export type TimeEntry = {
  id: string
  userId: string | null
  subId: string | null
  workOrderId: string | null
  jobId: string | null
  kind: TimeKind
  startedAt: string
  endedAt: string | null
  source: TimeSource
  endSource: TimeSource | null
  closedForTravel: boolean
  needsReview: boolean
  reviewNote: string | null
  pricebookItemId: string | null
  tappedBy: string | null
  endedBy: string | null
}

export function entryFromRow(r: Record<string, unknown>): TimeEntry {
  return {
    id: String(r.id),
    userId: (r.user_id as string | null) ?? null,
    subId: (r.sub_id as string | null) ?? null,
    workOrderId: (r.work_order_id as string | null) ?? null,
    jobId: (r.production_job_id as string | null) ?? null,
    kind: r.kind as TimeKind,
    startedAt: String(r.started_at),
    endedAt: (r.ended_at as string | null) ?? null,
    source: r.source as TimeSource,
    endSource: (r.end_source as TimeSource | null) ?? null,
    closedForTravel: r.closed_for_travel === true,
    needsReview: r.needs_review === true,
    reviewNote: (r.review_note as string | null) ?? null,
    pricebookItemId: (r.pricebook_item_id as string | null) ?? null,
    tappedBy: (r.tapped_by_user_id as string | null) ?? null,
    endedBy: (r.ended_by_user_id as string | null) ?? null,
  }
}

export const TIME_ENTRY_COLUMNS =
  'id, user_id, sub_id, work_order_id, production_job_id, kind, started_at, ended_at, source, end_source, closed_for_travel, needs_review, review_note, pricebook_item_id, tapped_by_user_id, ended_by_user_id'

// ---------------------------------------------------------------------------------------------------------------------
// Company settings (orgs.settings.timeTracking)
// ---------------------------------------------------------------------------------------------------------------------

export const TIME_TRACKING_SETTINGS_KEY = 'timeTracking'

export type TimeTrackingSettings = {
  /** A clock left running longer than this is stopped at the last tap and flagged (forgot to clock out). */
  autoCloseHours: number
  /** Save the phone's location at each tap (off unless the company turns it on). */
  captureLocation: boolean
  /** Weekly hours after which time is overtime (0 = never split). */
  overtimeAfterHours: number
  /** Warn when a day is longer than this with no break (0 = never). Warning only — nothing is deducted. */
  breakWarningAfterHours: number
}

export const DEFAULT_TIME_TRACKING_SETTINGS: Readonly<TimeTrackingSettings> = Object.freeze({
  autoCloseHours: 12,
  captureLocation: false,
  overtimeAfterHours: 40,
  breakWarningAfterHours: 6,
})

const LIMITS = {
  autoCloseHours: [2, 24],
  overtimeAfterHours: [0, 80],
  breakWarningAfterHours: [0, 16],
} as const

function numberIn(v: unknown, [lo, hi]: readonly [number, number]): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null
}

/** The settings from `orgs.settings` (or the `timeTracking` object itself). Anything missing or bad is the default. */
export function readTimeTrackingSettings(stored: unknown): TimeTrackingSettings {
  const obj = stored && typeof stored === 'object' && !Array.isArray(stored) ? (stored as Record<string, unknown>) : {}
  const t = TIME_TRACKING_SETTINGS_KEY in obj && obj[TIME_TRACKING_SETTINGS_KEY] && typeof obj[TIME_TRACKING_SETTINGS_KEY] === 'object' ? (obj[TIME_TRACKING_SETTINGS_KEY] as Record<string, unknown>) : obj
  return {
    autoCloseHours: numberIn(t.autoCloseHours, LIMITS.autoCloseHours) ?? DEFAULT_TIME_TRACKING_SETTINGS.autoCloseHours,
    captureLocation: typeof t.captureLocation === 'boolean' ? t.captureLocation : DEFAULT_TIME_TRACKING_SETTINGS.captureLocation,
    overtimeAfterHours: numberIn(t.overtimeAfterHours, LIMITS.overtimeAfterHours) ?? DEFAULT_TIME_TRACKING_SETTINGS.overtimeAfterHours,
    breakWarningAfterHours: numberIn(t.breakWarningAfterHours, LIMITS.breakWarningAfterHours) ?? DEFAULT_TIME_TRACKING_SETTINGS.breakWarningAfterHours,
  }
}

/** An owner's save: `{ timeTracking: { autoCloseHours: 10, … } }` → keys to merge, or why not. */
export function parseTimeTrackingSettingsPatch(body: unknown): { set: Partial<TimeTrackingSettings> } | { error: string } {
  const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  const patch = b.timeTracking && typeof b.timeTracking === 'object' ? (b.timeTracking as Record<string, unknown>) : {}
  const set: Partial<TimeTrackingSettings> = {}
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'captureLocation') {
      if (typeof v !== 'boolean') return { error: 'Location must be on or off' }
      set.captureLocation = v
    } else if (k in LIMITS) {
      const key = k as keyof typeof LIMITS
      const n = numberIn(v, LIMITS[key])
      if (n === null) return { error: `${SETTING_LABELS[key]} must be between ${LIMITS[key][0]} and ${LIMITS[key][1]}` }
      set[key] = n
    } else {
      return { error: `Unknown setting: ${k}` }
    }
  }
  if (Object.keys(set).length === 0) return { error: 'Nothing to save' }
  return { set }
}

const SETTING_LABELS: Record<keyof typeof LIMITS, string> = {
  autoCloseHours: 'Stop a forgotten clock after (hours)',
  overtimeAfterHours: 'Overtime after (hours a week)',
  breakWarningAfterHours: 'Warn about no break after (hours)',
}

// ---------------------------------------------------------------------------------------------------------------------
// Paid time
// ---------------------------------------------------------------------------------------------------------------------

export type Interval = { start: number; end: number }

const ms = (iso: string) => Date.parse(iso)

/** The local calendar date (YYYY-MM-DD) of an instant in a time zone. */
export function localYmd(instantMs: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(instantMs))
}

/** Local wall-clock HH:MM of an instant in a time zone. */
export function localHm(instantMs: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(instantMs))
}

/**
 * A wall-clock time on a local date → the instant (date-fns-tz, the time zone database). A time skipped by the spring
 * clock change resolves forward; an hour repeated in the fall resolves to its first occurrence.
 */
export function localTimeToInstant(ymd: string, hm: string, timeZone: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(hm)) return null
  const d = fromZonedTime(`${ymd}T${hm}:00`, timeZone)
  if (!Number.isFinite(d.getTime())) return null
  // A wall time that doesn't exist (the spring gap) comes back an hour early from date-fns-tz: move it past the gap.
  if (localHm(d.getTime(), timeZone) !== hm || localYmd(d.getTime(), timeZone) !== ymd) {
    const later = new Date(d.getTime() + 3_600_000)
    if (localYmd(later.getTime(), timeZone) === ymd) return later
  }
  return d
}

/** Sorted, merged (overlaps and touching joined). */
export function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = list.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start)
  const out: Interval[] = []
  for (const i of sorted) {
    const last = out[out.length - 1]
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end)
    else out.push({ ...i })
  }
  return out
}

/** a − b (both any list; result merged). */
export function subtractIntervals(a: Interval[], b: Interval[]): Interval[] {
  const cut = mergeIntervals(b)
  const out: Interval[] = []
  for (const i of mergeIntervals(a)) {
    let pieces: Interval[] = [i]
    for (const c of cut) {
      const next: Interval[] = []
      for (const p of pieces) {
        if (c.end <= p.start || c.start >= p.end) next.push(p)
        else {
          if (c.start > p.start) next.push({ start: p.start, end: c.start })
          if (c.end < p.end) next.push({ start: c.end, end: p.end })
        }
      }
      pieces = next
    }
    out.push(...pieces)
  }
  return out
}

export function clipIntervals(list: Interval[], from: number, to: number): Interval[] {
  return list.map((i) => ({ start: Math.max(i.start, from), end: Math.min(i.end, to) })).filter((i) => i.end > i.start)
}

export function totalSeconds(list: Interval[]): number {
  return Math.round(list.reduce((s, i) => s + (i.end - i.start), 0) / 1000)
}

export type PaidTime = {
  /** Work minus breaks (job time). */
  work: Interval[]
  /** Paid drive time between stops (minus any break taken on the way). */
  travel: Interval[]
  /** Work ∪ travel − breaks: what payroll pays. */
  paid: Interval[]
  breaks: Interval[]
}

/**
 * One person's paid time from their entries (any order, removed ones already left out). Open entries run to `now`
 * when given, else they don't count yet (payroll only takes closed time).
 */
export function paidTime(entries: TimeEntry[], opts: { timeZone: string; now?: number }): PaidTime {
  const end = (e: TimeEntry) => (e.endedAt ? ms(e.endedAt) : opts.now ?? null)
  const work: Interval[] = []
  const breaks: Interval[] = []
  for (const e of entries) {
    const stop = end(e)
    if (stop == null) continue
    if (e.kind === 'work') work.push({ start: ms(e.startedAt), end: stop })
    else if (e.kind === 'break') breaks.push({ start: ms(e.startedAt), end: stop })
  }
  const works = entries.filter((e) => e.kind === 'work' && end(e) != null).sort((a, b) => ms(a.startedAt) - ms(b.startedAt))
  const travel: Interval[] = []
  for (let i = 0; i < works.length - 1; i++) {
    const a = works[i]
    const b = works[i + 1]
    if (!a.closedForTravel || !a.endedAt) continue
    const from = ms(a.endedAt)
    const to = ms(b.startedAt)
    if (to <= from) continue
    if (localYmd(from, opts.timeZone) !== localYmd(to, opts.timeZone)) continue
    travel.push({ start: from, end: to })
  }
  const workNet = subtractIntervals(work, breaks)
  const travelNet = subtractIntervals(subtractIntervals(travel, work), breaks)
  return { work: workNet, travel: travelNet, paid: mergeIntervals([...workNet, ...travelNet]), breaks: mergeIntervals(breaks) }
}

/** Regular / overtime hours for a week's paid seconds. Exact (no rounding to quarter hours): hours = seconds / 3600. */
export function splitOvertime(paidSeconds: number, overtimeAfterHours: number): { regularHours: number; overtimeHours: number } {
  const hours = Math.max(0, paidSeconds) / 3600
  if (!overtimeAfterHours || hours <= overtimeAfterHours) return { regularHours: hours, overtimeHours: 0 }
  return { regularHours: overtimeAfterHours, overtimeHours: hours - overtimeAfterHours }
}

// ---------------------------------------------------------------------------------------------------------------------
// Wage-law warnings (warnings only — nothing is ever deducted or changed by them)
// ---------------------------------------------------------------------------------------------------------------------

export type TimeWarning = { code: 'no_break' | 'long_day' | 'overtime' | 'open_clock' | 'needs_review'; day: string | null; text: string }

/** Warnings for one person's week. `days` = the local dates in the week, oldest first. */
export function weekWarnings(entries: TimeEntry[], opts: { timeZone: string; settings: TimeTrackingSettings; weekFrom: number; weekTo: number; now: number }): TimeWarning[] {
  const out: TimeWarning[] = []
  const t = paidTime(entries, { timeZone: opts.timeZone })
  const byDay = new Map<string, { paid: number; breaks: number }>()
  for (const i of clipIntervals(t.paid, opts.weekFrom, opts.weekTo)) {
    const d = localYmd(i.start, opts.timeZone)
    const row = byDay.get(d) ?? { paid: 0, breaks: 0 }
    row.paid += (i.end - i.start) / 1000
    byDay.set(d, row)
  }
  for (const i of clipIntervals(t.breaks, opts.weekFrom, opts.weekTo)) {
    const d = localYmd(i.start, opts.timeZone)
    const row = byDay.get(d) ?? { paid: 0, breaks: 0 }
    row.breaks += (i.end - i.start) / 1000
    byDay.set(d, row)
  }
  for (const [day, r] of Array.from(byDay.entries()).sort()) {
    if (opts.settings.breakWarningAfterHours > 0 && r.paid > opts.settings.breakWarningAfterHours * 3600 && r.breaks === 0) {
      out.push({ code: 'no_break', day, text: `${formatDuration(r.paid)} with no break` })
    }
    if (r.paid > 12 * 3600) out.push({ code: 'long_day', day, text: `Long day: ${formatDuration(r.paid)}` })
  }
  const week = totalSeconds(clipIntervals(t.paid, opts.weekFrom, opts.weekTo))
  const split = splitOvertime(week, opts.settings.overtimeAfterHours)
  if (split.overtimeHours > 0) out.push({ code: 'overtime', day: null, text: `Overtime: ${formatDuration(split.overtimeHours * 3600)}` })
  for (const e of entries) {
    if (!e.endedAt && e.kind === 'work' && ms(e.startedAt) < opts.weekTo) out.push({ code: 'open_clock', day: localYmd(ms(e.startedAt), opts.timeZone), text: 'Still clocked in' })
    if (e.needsReview && ms(e.startedAt) >= opts.weekFrom && ms(e.startedAt) <= opts.weekTo) out.push({ code: 'needs_review', day: localYmd(ms(e.startedAt), opts.timeZone), text: e.reviewNote || 'Check this time' })
  }
  return out
}

/** "7 h 20 min", "45 min", "0 min". */
export function formatDuration(seconds: number): string {
  const mins = Math.round(Math.max(0, seconds) / 60)
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h === 0) return `${m} min`
  return m ? `${h} h ${m} min` : `${h} h`
}

// ---------------------------------------------------------------------------------------------------------------------
// Taps (from a phone, possibly queued offline)
// ---------------------------------------------------------------------------------------------------------------------

export const CLOCK_ACTIONS = ['clock_in', 'clock_out', 'break_start', 'break_end', 'equipment_start', 'equipment_stop', 'finish_answer'] as const
export type ClockAction = (typeof CLOCK_ACTIONS)[number]

export type ClockTap = {
  tapId: string
  action: ClockAction
  /** When it was tapped, by the phone's clock. */
  at: string
  /** The phone's clock when the tap was SENT (the server compares it with its own to catch a wrong phone clock). */
  deviceNow: string
  workOrderId: string | null
  jobId: string | null
  /** Who (crew members ticked). Empty = everyone the tap may act for. */
  userIds: string[]
  /** clock_out: leaving for the next stop (the drive is paid). */
  forTravel: boolean
  pricebookItemId: string | null
  /** equipment_stop / finish_answer. */
  entryId: string | null
  /** finish_answer: 'HH:MM' local. */
  finishTime: string | null
  lat: number | null
  lng: number | null
  /** Crew link: the lead the phone says is tapping. */
  tappedBy: string | null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuidLike = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v)
const optUuid = (v: unknown): string | null | false => (v == null || v === '' ? null : isUuidLike(v) ? v : false)
const isoOk = (v: unknown): v is string => typeof v === 'string' && v.length <= 40 && Number.isFinite(Date.parse(v))

export function parseClockTap(body: unknown): { tap: ClockTap } | { error: string } {
  const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : null
  if (!b) return { error: 'Bad request' }
  if (typeof b.tapId !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(b.tapId)) return { error: 'Bad tap id' }
  if (!(CLOCK_ACTIONS as readonly string[]).includes(String(b.action))) return { error: 'Unknown action' }
  if (!isoOk(b.at) || !isoOk(b.deviceNow)) return { error: 'Bad time' }
  const workOrderId = optUuid(b.workOrderId)
  const jobId = optUuid(b.jobId)
  const pricebookItemId = optUuid(b.pricebookItemId)
  const entryId = optUuid(b.entryId)
  const tappedBy = optUuid(b.tappedBy)
  if (workOrderId === false || jobId === false || pricebookItemId === false || entryId === false || tappedBy === false) return { error: 'Bad id' }
  const userIds = Array.isArray(b.userIds) ? b.userIds : []
  if (userIds.length > 50 || !userIds.every(isUuidLike)) return { error: 'Bad people list' }
  const num = (v: unknown, lim: number) => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= lim ? v : null)
  const finishTime = typeof b.finishTime === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(b.finishTime) ? b.finishTime : null
  const action = b.action as ClockAction
  if (action === 'clock_in' && !workOrderId && !jobId) return { error: 'Which stop or job?' }
  if (action === 'equipment_start' && !pricebookItemId) return { error: 'Which equipment?' }
  if ((action === 'equipment_stop' || action === 'finish_answer') && !entryId) return { error: 'Which entry?' }
  if (action === 'finish_answer' && !finishTime) return { error: 'What time did you finish?' }
  return {
    tap: {
      tapId: b.tapId,
      action,
      at: new Date(b.at).toISOString(),
      deviceNow: new Date(b.deviceNow).toISOString(),
      workOrderId,
      jobId,
      userIds: Array.from(new Set(userIds as string[])),
      forTravel: b.forTravel === true,
      pricebookItemId,
      entryId,
      finishTime,
      lat: num(b.lat, 90),
      lng: num(b.lng, 180),
      tappedBy,
    },
  }
}

/** A queued tap older than this is refused (a phone that sat offline over a week needs the office). */
export const MAX_TAP_AGE_DAYS = 7
/** The phone clock is trusted, but when it is this far off the server the entry is flagged for the office. */
export const CLOCK_SKEW_FLAG_SECONDS = 5 * 60

export type TapTime = { at: Date; skewSeconds: number; flag: string | null } | { error: string }

/**
 * When a tap happened. Phone time is used (the tap may have sat in the offline queue); when the phone's clock is more
 * than a couple of minutes off the server's at send time, the tap is moved by that difference and, past
 * CLOCK_SKEW_FLAG_SECONDS, flagged. A time still in the future is pulled back to now and flagged.
 */
export function resolveTapTime(tap: Pick<ClockTap, 'at' | 'deviceNow'>, serverNow: Date): TapTime {
  const skewMs = Date.parse(tap.deviceNow) - serverNow.getTime()
  const skewSeconds = Math.round(skewMs / 1000)
  let at = Date.parse(tap.at) - (Math.abs(skewMs) > 120_000 ? skewMs : 0)
  let flag: string | null = Math.abs(skewSeconds) >= CLOCK_SKEW_FLAG_SECONDS ? `Phone clock was ${formatDuration(Math.abs(skewSeconds))} ${skewSeconds > 0 ? 'fast' : 'slow'} — check this time` : null
  if (at > serverNow.getTime() + 120_000) {
    at = serverNow.getTime()
    flag = flag ?? 'Tapped time was in the future — check this time'
  }
  if (at < serverNow.getTime() - MAX_TAP_AGE_DAYS * 86_400_000) return { error: `That tap is more than ${MAX_TAP_AGE_DAYS} days old — ask the office to add the time.` }
  return { at: new Date(at), skewSeconds, flag }
}

// ---------------------------------------------------------------------------------------------------------------------
// Office edits
// ---------------------------------------------------------------------------------------------------------------------

export type EntryEdit = {
  startedAt?: string
  endedAt?: string | null
  kind?: TimeKind
  workOrderId?: string | null
  jobId?: string | null
  needsReview?: boolean
}

export const ENTRY_FIELD_LABELS: Record<string, string> = {
  started_at: 'Start',
  ended_at: 'End',
  kind: 'Type',
  work_order_id: 'Visit / crew',
  production_job_id: 'Job',
  needs_review: 'Needs a look',
  user_id: 'Person',
}

/** An office edit / add: the reason is required (min 3 characters); times are full ISO instants. */
export function parseEntryEdit(body: unknown, opts: { adding: boolean }): { edit: EntryEdit & { userId?: string }; reason: string } | { error: string } {
  const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : null
  if (!b) return { error: 'Bad request' }
  const reason = typeof b.reason === 'string' ? b.reason.trim() : ''
  if (reason.length < 3) return { error: 'Say why (a few words)' }
  if (reason.length > 500) return { error: 'Reason is too long' }
  const edit: EntryEdit & { userId?: string } = {}
  if ('startedAt' in b) {
    if (!isoOk(b.startedAt)) return { error: 'Bad start time' }
    edit.startedAt = new Date(b.startedAt).toISOString()
  }
  if ('endedAt' in b) {
    if (b.endedAt === null) edit.endedAt = null
    else if (!isoOk(b.endedAt)) return { error: 'Bad end time' }
    else edit.endedAt = new Date(b.endedAt).toISOString()
  }
  if ('kind' in b) {
    if (b.kind !== 'work' && b.kind !== 'break') return { error: 'Type must be work or break' }
    edit.kind = b.kind
  }
  for (const [k, key] of [['workOrderId', 'workOrderId'], ['jobId', 'jobId']] as const) {
    if (k in b) {
      const v = optUuid(b[k])
      if (v === false) return { error: 'Bad id' }
      edit[key] = v
    }
  }
  if ('needsReview' in b) {
    if (typeof b.needsReview !== 'boolean') return { error: 'Bad flag' }
    edit.needsReview = b.needsReview
  }
  if (opts.adding) {
    if (!isUuidLike(b.userId)) return { error: 'Whose time?' }
    edit.userId = b.userId
    if (!edit.startedAt || !edit.endedAt) return { error: 'Start and end are both needed' }
    edit.kind = edit.kind ?? 'work'
    if (edit.kind === 'work' && !edit.workOrderId && !edit.jobId) return { error: 'Which job or visit?' }
  }
  if (edit.startedAt && edit.endedAt && Date.parse(edit.endedAt) < Date.parse(edit.startedAt)) return { error: 'End is before start' }
  if (edit.startedAt && edit.endedAt && Date.parse(edit.endedAt) - Date.parse(edit.startedAt) > 24 * 3_600_000) return { error: 'One entry can’t be longer than 24 hours — split it' }
  if (!opts.adding && Object.keys(edit).length === 0) return { error: 'Nothing to change' }
  return { edit, reason }
}
