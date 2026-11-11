/**
 * THE pay week of a company: which day a week starts, when it closes (cutoff), when it is paid, and — optional — a
 * late-funding window (money that clears after the cutoff but by e.g. Wednesday night still pays on this week's check).
 *
 * Stored per company at `orgs.settings.payWeek` (written ONLY by `savePayWeekSchedule`, lib/payroll-week-schedule-server.ts,
 * through mergeOrgSettings path ['payWeek']; super admins only). The time zone is the company's own (`orgs.timezone`).
 * A company with nothing saved keeps the schedule the code always had (`LEGACY_PAY_WEEK`: Thursday–Wednesday, cutoff
 * Wednesday 11:59 PM, payday Friday), so nothing moves until an owner saves a schedule.
 *
 * Pure and client-safe. Time rules (CLAUDE.md): calendar days are worked on DATE strings (YYYY-MM-DD, noon-UTC anchor) and
 * instants are rebuilt from a local wall-clock time with the time zone database — never by adding 24-hour multiples, which is
 * an hour off in a clock-change week. The SQL twin (carry-over target in payroll_commit_week, migration 202611120010) reads
 * the same stored keys; lib/__tests__/payroll-week-schedule.test.ts keeps them equal.
 */
import { fromZonedTime } from 'date-fns-tz'

import { DEFAULT_TIMEZONE } from '@/lib/timezone'

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const

/** What is stored under `orgs.settings.payWeek`. */
export type StoredPayWeek = {
  /** First day of the pay week (0 = Sunday … 6 = Saturday). The week closes on the day before it. */
  weekStartDay: Weekday
  /** Local wall-clock time the week closes on its last day, 'HH:MM' (24 h). Closes at HH:MM:59.999. */
  cutoffTime: string
  /** Payday: the first such weekday AFTER the cutoff day. */
  paydayWeekday: Weekday
  /** Money that clears after the cutoff but by this weekday/time still pays on this week's check. null = no grace. */
  lateFunding: { weekday: Weekday; time: string } | null
}

export type PayWeekSchedule = StoredPayWeek & { timeZone: string }

/** What the code did before the setting existed (lib/weekly-payroll/cutoff.ts). Every company without a saved schedule. */
export const LEGACY_PAY_WEEK: StoredPayWeek = { weekStartDay: 4, cutoffTime: '23:59', paydayWeekday: 5, lateFunding: null }

export const PAY_WEEK_SETTINGS_KEY = 'payWeek'

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/
const YMD = /^\d{4}-\d{2}-\d{2}$/

const isWeekday = (v: unknown): v is Weekday => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 6

/** Validates a schedule from a request or from settings. Pure. */
export function parsePayWeek(raw: unknown): { ok: true; value: StoredPayWeek } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'Pick the pay week.' }
  const r = raw as Record<string, unknown>
  if (!isWeekday(r.weekStartDay)) return { ok: false, error: 'Pick the day the week starts.' }
  if (typeof r.cutoffTime !== 'string' || !HHMM.test(r.cutoffTime)) return { ok: false, error: 'Pick the time the week closes.' }
  if (!isWeekday(r.paydayWeekday)) return { ok: false, error: 'Pick payday.' }
  let lateFunding: StoredPayWeek['lateFunding'] = null
  if (r.lateFunding != null) {
    const lf = r.lateFunding as Record<string, unknown>
    if (typeof lf !== 'object' || !isWeekday(lf.weekday) || typeof lf.time !== 'string' || !HHMM.test(lf.time)) return { ok: false, error: 'Pick the late-money day and time.' }
    lateFunding = { weekday: lf.weekday, time: lf.time }
  }
  const value: StoredPayWeek = { weekStartDay: r.weekStartDay, cutoffTime: r.cutoffTime, paydayWeekday: r.paydayWeekday, lateFunding }
  if (lateFunding && lateFundingOffsetDays(value) >= paydayOffsetDays(value)) {
    return { ok: false, error: 'Late money has to be in before payday.' }
  }
  return { ok: true, value }
}

/** The company's schedule: the saved one if valid, else the legacy one. `timeZone` is the company's (validated by the caller). */
export function readPayWeekSchedule(settings: unknown, timeZone: string | null | undefined): PayWeekSchedule {
  const raw = settings && typeof settings === 'object' ? (settings as Record<string, unknown>)[PAY_WEEK_SETTINGS_KEY] : undefined
  const parsed = raw == null ? null : parsePayWeek(raw)
  return { ...(parsed?.ok ? parsed.value : LEGACY_PAY_WEEK), timeZone: timeZone || DEFAULT_TIMEZONE }
}

/** The last day of the week (the cutoff day). */
export const cutoffWeekday = (s: StoredPayWeek): Weekday => ((s.weekStartDay + 6) % 7) as Weekday

/** Days from the cutoff date to payday (1–7). */
export const paydayOffsetDays = (s: StoredPayWeek): number => ((s.paydayWeekday - cutoffWeekday(s) + 7) % 7) || 7

/** Days from the cutoff date to the end of the late-money window (1–7). */
export const lateFundingOffsetDays = (s: StoredPayWeek): number => (s.lateFunding ? ((s.lateFunding.weekday - cutoffWeekday(s) + 7) % 7) || 7 : 0)

// ── Calendar dates ─────────────────────────────────────────────────────────────────────────────────────────────────

/** The calendar date (YYYY-MM-DD) of an instant in a zone. */
export function ymdInZone(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

/** Calendar arithmetic on a DATE string: + n days (noon-UTC anchor, so no clock change can repeat or skip a date). */
export function addDaysYmd(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export const weekdayOfYmd = (ymd: string): Weekday => new Date(`${ymd}T12:00:00Z`).getUTCDay() as Weekday

/** Whole days from `a` to `b` (both DATE strings). */
export const daysBetweenYmd = (a: string, b: string): number => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000)

// ── Instants ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** HH:MM:59.999 local on a date, as an instant (time zone database; correct on both clock-change days). */
export function localInstant(ymd: string, hhmm: string, timeZone: string): Date {
  return fromZonedTime(`${ymd}T${hhmm}:59.999`, timeZone)
}

/** The cutoff instant of the week that closes on `ymd`. */
export const cutoffInstantForYmd = (ymd: string, s: PayWeekSchedule): Date => localInstant(ymd, s.cutoffTime, s.timeZone)

/** The cutoff's own calendar date, in the company's zone: the one date plans, sale dates and hours are looked up by. */
export const cutoffYmd = (cutoff: Date | string, s: Pick<PayWeekSchedule, 'timeZone'>): string => ymdInZone(typeof cutoff === 'string' ? new Date(cutoff) : cutoff, s.timeZone)

/** The most recent cutoff at or before `at`: the week that has ended and is ready to pay. */
export function lastCutoffAtOrBefore(at: Date, s: PayWeekSchedule): Date {
  const today = ymdInZone(at, s.timeZone)
  const day = cutoffWeekday(s)
  for (let i = 0; i <= 7; i++) {
    const ymd = addDaysYmd(today, -i)
    if (weekdayOfYmd(ymd) !== day) continue
    const c = cutoffInstantForYmd(ymd, s)
    if (c.getTime() <= at.getTime()) return c
  }
  throw new Error('Unable to compute the last pay-week cutoff')
}

/** The first cutoff strictly after `at`: the week that is still running. */
export function nextCutoffAfter(at: Date, s: PayWeekSchedule): Date {
  const today = ymdInZone(at, s.timeZone)
  const day = cutoffWeekday(s)
  for (let i = 0; i <= 7; i++) {
    const ymd = addDaysYmd(today, i)
    if (weekdayOfYmd(ymd) !== day) continue
    const c = cutoffInstantForYmd(ymd, s)
    if (c.getTime() > at.getTime()) return c
  }
  throw new Error('Unable to compute the next pay-week cutoff')
}

/** The cutoff `weeks` calendar weeks after (or before) another, at the same local time. */
export const addWeeks = (cutoff: Date | string, weeks: number, s: PayWeekSchedule): Date => cutoffInstantForYmd(addDaysYmd(cutoffYmd(cutoff, s), 7 * weeks), s)

/** Payday (YYYY-MM-DD) of the week closing at `cutoff`. */
export const payDateFor = (cutoff: Date | string, s: PayWeekSchedule): string => addDaysYmd(cutoffYmd(cutoff, s), paydayOffsetDays(s))

/** End of the late-money window for this week, or null when the company has none. */
export function lateFundingUntil(cutoff: Date | string, s: PayWeekSchedule): Date | null {
  if (!s.lateFunding) return null
  return localInstant(addDaysYmd(cutoffYmd(cutoff, s), lateFundingOffsetDays(s)), s.lateFunding.time, s.timeZone)
}

/**
 * The calendar days a week pays: from the day after the previous week's cutoff through the cutoff date. A normal week is 7 days;
 * the one week right after a schedule change can be shorter or longer (1–13 days). A previous cutoff further back than that is not
 * this week's neighbour (a gap in history, or a stale week), so the week is the normal 7 days.
 */
export function weekDays(cutoff: Date | string, s: Pick<PayWeekSchedule, 'timeZone'>, prevCutoff?: Date | string | null): { start: string; end: string; days: string[] } {
  const end = cutoffYmd(cutoff, s)
  let length = 7
  if (prevCutoff) {
    const gap = daysBetweenYmd(cutoffYmd(prevCutoff, s), end)
    if (gap >= 1 && gap <= 13) length = gap
  }
  const days: string[] = []
  for (let i = 0; i < length; i++) days.push(addDaysYmd(end, -i))
  return { start: days[days.length - 1], end, days }
}

/** "Week ending YYYY-MM-DD": the label every created week gets (unique per company with the label constraint). */
export const weekLabel = (cutoff: Date | string, s: Pick<PayWeekSchedule, 'timeZone'>) => `Week ending ${cutoffYmd(cutoff, s)}`

// ── Words ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export function clockWords(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
}

/** "Monday–Sunday · closes Sunday 11:59 PM · paid Friday". */
export function describePayWeek(s: StoredPayWeek): string {
  const parts = [
    `${WEEKDAY_NAMES[s.weekStartDay]}–${WEEKDAY_NAMES[cutoffWeekday(s)]}`,
    `closes ${WEEKDAY_NAMES[cutoffWeekday(s)]} ${clockWords(s.cutoffTime)}`,
    `paid ${WEEKDAY_NAMES[s.paydayWeekday]}`,
  ]
  if (s.lateFunding) parts.push(`money in by ${WEEKDAY_NAMES[s.lateFunding.weekday]} ${clockWords(s.lateFunding.time)} still pays that week`)
  return parts.join(' · ')
}

export const sameStoredPayWeek = (a: StoredPayWeek, b: StoredPayWeek) =>
  a.weekStartDay === b.weekStartDay && a.cutoffTime === b.cutoffTime && a.paydayWeekday === b.paydayWeekday &&
  (a.lateFunding?.weekday ?? null) === (b.lateFunding?.weekday ?? null) && (a.lateFunding?.time ?? null) === (b.lateFunding?.time ?? null)

// ── Changing the schedule ──────────────────────────────────────────────────────────────────────────────────────────

export type PayWeekChangePreview = {
  /** The first week on the new schedule: the one the Pay screen opens on once its cutoff passes. */
  firstWeek: { start: string; end: string; payDate: string; days: number }
  /** The normal weeks after it. */
  then: Array<{ start: string; end: string; payDate: string }>
}

/**
 * What changing the schedule does, shown to the owner BEFORE saving — computed with the same functions the Pay screen uses, so the
 * dates shown are the dates paid. The change takes effect at a week boundary: weeks that already exist keep their dates. The first
 * new week ends at `firstCutoff` and starts the day after `prevCutoff` (the last existing week) when that is 1–13 days earlier —
 * the one in-between week — otherwise it is a normal 7-day week.
 */
export function previewPayWeekChange(firstCutoff: Date | string, prevCutoff: Date | string | null, next: PayWeekSchedule): PayWeekChangePreview {
  const days = weekDays(firstCutoff, next, prevCutoff)
  const then = [1, 2].map((k) => {
    const c = addWeeks(firstCutoff, k, next)
    return { start: addDaysYmd(cutoffYmd(c, next), -6), end: cutoffYmd(c, next), payDate: payDateFor(c, next) }
  })
  return { firstWeek: { start: days.start, end: days.end, payDate: payDateFor(firstCutoff, next), days: days.days.length }, then }
}

export const isYmd = (v: unknown): v is string => typeof v === 'string' && YMD.test(v)
