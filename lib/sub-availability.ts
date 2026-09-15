/**
 * Sub-contractor calendar availability — lets ops see when a sub is already
 * busy BEFORE booking an install, without adding any new credential store.
 *
 * PERMISSION MODEL: subs do not do a Google OAuth flow. Each sub opens their
 * own Google Calendar sharing settings once and shares their calendar with an
 * ARX Google account at "See only free/busy (hide details)". We then read
 * that availability using the REQUESTING OPS USER'S OWN Google token
 * (`user_google_tokens`, populated by `getValidAccessToken` in
 * `lib/appointment-calendar-sync.ts`). If the requesting user has no Google
 * token, availability is simply unavailable — that is NOT an error, it
 * degrades gracefully (see the route's `source: 'no_token'`).
 *
 * THE TIMEZONE RULE THIS FILE EXISTS TO ENFORCE: installs are all-day events
 * keyed by a bare SQL `DATE` (`production_jobs.scheduled_date`, `YYYY-MM-DD`,
 * no time or offset). Google's free/busy API returns busy ranges as RFC3339
 * instants WITH an offset (e.g. `2026-09-10T23:30:00-04:00`). Turning an
 * instant into "which bare calendar date does this touch" is genuinely
 * timezone-dependent — the same instant is 2026-09-10 in one timezone and
 * 2026-09-11 in another. `lib/install-calendar.ts`'s file header documents a
 * production double-timezone bug from exactly this class of mistake
 * (`new Date(str)` + `toISOString()` round-trips, or a hardcoded literal
 * timezone). `busyDatesFromSlots` below does the conversion explicitly
 * against `CALENDAR_BUSINESS_TZ` (`lib/calendar-business-tz.ts`) — reused,
 * never re-hardcoded — and is pinned by tests for a late-evening slot and a
 * slot that spans midnight.
 */
import { addDays, eachDayOfInterval, format } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'

import { CALENDAR_BUSINESS_TZ } from '@/lib/calendar-business-tz'
import type { FreeBusyCalendarResult, FreeBusySlot } from '@/lib/google-calendar'

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/

function assertDateOnly(value: string, label: string): void {
  if (!DATE_ONLY_RE.test(value)) {
    throw new Error(`${label} must be a bare YYYY-MM-DD date, got: ${value}`)
  }
}

/**
 * Build a local (non-UTC) `Date` from a bare `YYYY-MM-DD` string's own y/m/d
 * parts — never `new Date(str)`, which parses as UTC midnight. Mirrors
 * `dateOnlyFromParts` in `lib/install-calendar.ts` (kept file-local there,
 * so duplicated here rather than reaching into that file for a private
 * helper); same contract, same reasoning.
 */
function dateOnlyFromParts(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d, 0, 0, 0, 0)
}

/** Inclusive list of bare `YYYY-MM-DD` strings from `startYmd` to `endYmd`. */
function eachDateOnlyInclusive(startYmd: string, endYmd: string): string[] {
  if (endYmd < startYmd) return []
  const days = eachDayOfInterval({
    start: dateOnlyFromParts(startYmd),
    end: dateOnlyFromParts(endYmd),
  })
  return days.map((d) => format(d, 'yyyy-MM-dd'))
}

/** The bare business-timezone calendar date (`yyyy-MM-dd`) an instant falls on. */
function ymdInBusinessTz(d: Date): string {
  return formatInTimeZone(d, CALENDAR_BUSINESS_TZ, 'yyyy-MM-dd')
}

/** The business-timezone wall-clock time (`HH:mm:ss`) an instant falls on. */
function hmsInBusinessTz(d: Date): string {
  return formatInTimeZone(d, CALENDAR_BUSINESS_TZ, 'HH:mm:ss')
}

/** The subset of a `sub_contractors` row {@link resolveSubCalendarId} needs. */
export type SubCalendarSource = {
  scheduling_calendar_id?: string | null
  scheduling_email?: string | null
}

/**
 * Which calendar address to query for a sub's free/busy: the address they
 * explicitly shared (`scheduling_calendar_id`) when set, else the address
 * already on file for the install invite (`scheduling_email`) — most subs
 * share the same address they get invited on, so they never need the first
 * column set at all. `null` when the sub has given ARX no address of any
 * kind — availability is simply not configured for them.
 */
export function resolveSubCalendarId(sub: SubCalendarSource | null | undefined): string | null {
  if (!sub) return null
  const explicit = (sub.scheduling_calendar_id ?? '').trim()
  if (explicit) return explicit
  const fallback = (sub.scheduling_email ?? '').trim()
  return fallback || null
}

/**
 * Turn Google's busy time ranges into the set of bare `YYYY-MM-DD` dates they
 * touch, clipped to `[windowStart, windowEnd]` (both inclusive bare dates).
 *
 * Pure — no I/O, no wall-clock reads. A slot is included on every calendar
 * day (business timezone) it overlaps: a slot entirely within one day yields
 * one date; a slot crossing midnight yields BOTH days it touches. Google's
 * busy `end` is exclusive, mirroring the same convention `lib/install-
 * calendar.ts` documents for all-day event ends: a slot that ends exactly at
 * local midnight does not touch that following day (nothing after midnight is
 * actually busy), so the end boundary is backed off by 1ms before computing
 * which day it falls on.
 */
export function busyDatesFromSlots(
  slots: FreeBusySlot[],
  windowStart: string,
  windowEnd: string
): string[] {
  assertDateOnly(windowStart, 'windowStart')
  assertDateOnly(windowEnd, 'windowEnd')

  const dates = new Set<string>()

  for (const slot of slots) {
    const start = new Date(slot.start)
    const end = new Date(slot.end)
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue
    if (end.getTime() <= start.getTime()) continue // degenerate/empty range

    const startYmd = ymdInBusinessTz(start)
    const endIsExactMidnight = hmsInBusinessTz(end) === '00:00:00'
    const endBoundary = endIsExactMidnight ? new Date(end.getTime() - 1) : end
    const endYmd = ymdInBusinessTz(endBoundary)

    for (const day of eachDateOnlyInclusive(startYmd, endYmd)) {
      if (day >= windowStart && day <= windowEnd) dates.add(day)
    }
  }

  return Array.from(dates).sort()
}

/**
 * Per-sub availability-read outcome, surfaced by the availability route so
 * ops can tell "no data ever configured" apart from "was configured but the
 * share is broken" apart from "genuinely free."
 *
 *   ok             — free/busy read succeeded; `busyDates` is authoritative.
 *   not_configured — the sub has no `scheduling_calendar_id`/`scheduling_
 *                    email` on file at all; nothing to query.
 *   not_shared     — the sub has an address on file, but Google reported it
 *                    can't be read (`notFound`/`forbidden`) — never shared,
 *                    or the share was revoked.
 *   error          — the address is configured and it's not a known
 *                    not-shared reason, but the read still failed (Google
 *                    outage, malformed id, etc).
 *
 * CRITICAL: a sub landing in `not_shared` or `error` must never be reported
 * as `ok` with empty `busyDates` — that would read as "confirmed free" when
 * we actually have no idea. Callers must gate on `shareStatus`, not just on
 * whether `busyDates` is empty.
 */
export type SubShareStatus = 'ok' | 'not_configured' | 'not_shared' | 'error'

const NOT_SHARED_REASONS = new Set(['notFound', 'forbidden'])

/**
 * Decide a sub's {@link SubShareStatus} from the calendar id we resolved for
 * them and Google's per-calendar free/busy result (or `undefined` if that
 * calendar was never queried at all, e.g. the whole batch call threw).
 */
export function resolveSubShareStatus(
  calendarId: string | null,
  freeBusyResult: FreeBusyCalendarResult | undefined
): SubShareStatus {
  if (!calendarId) return 'not_configured'
  if (!freeBusyResult) return 'error'
  if ('error' in freeBusyResult) {
    return NOT_SHARED_REASONS.has(freeBusyResult.error) ? 'not_shared' : 'error'
  }
  return 'ok'
}
